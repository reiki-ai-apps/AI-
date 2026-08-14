// §15 予約 / §16 取消
//
// 日時の変更は承認根拠の変更そのものなので、必ず新しい版として登録し承認を無効化する (§14)。
// ここで独自に scheduled_at だけ書き換える経路は作らない。

import { domainDigest } from '../core/digest.js';
import { assertCan } from '../domain/rbac.js';
import { InvariantError } from '../domain/invariants.js';
import { publishMode } from '../domain/capabilities.js';
import { ValidationError } from './posts.js';
import { reviseChannelPost } from './posts.js';

const SNAPSHOT_DOMAIN = 'REIKI-AUDIT-SNAPSHOT-V1';

async function snapshotHash(value) {
  return value == null ? null : domainDigest(SNAPSHOT_DOMAIN, value);
}

/**
 * 予約時刻の変更。承認済みだった場合は承認が外れ、承認待ちへ戻る (§14)。
 */
export async function reschedule(ctx, channelPostId, { scheduledAtIso, timeZone } = {}) {
  assertCan(ctx.actor.role, 'schedule.set');
  if (!Number.isFinite(Date.parse(scheduledAtIso ?? ''))) {
    throw new ValidationError('公開予定日時を入力してください。', 'scheduledAt');
  }
  return reviseChannelPost(ctx, channelPostId, { scheduledAtIso, timeZone }, { reason: '公開予定日時を変更' });
}

/**
 * 予約の取消 (§16「送信前は取消可能」)。
 * 取消は進行状態へ混ぜず、履歴として別に持つ (§11)。
 */
export async function cancelSchedule(ctx, channelPostId, { reason } = {}) {
  assertCan(ctx.actor.role, 'schedule.cancel');
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!text) throw new ValidationError('取消の理由を入力してください。', 'reason');

  const post = await ctx.repo.getPost(channelPostId);
  if (!post) throw new ValidationError('対象の投稿が見つかりません。');
  if (post.cancelled_at) throw new InvariantError('STATE_CONFLICT', 'すでに取消済みです。');
  if (post.display_state === 'PUBLISHED') {
    throw new InvariantError(
      'ALREADY_PUBLISHED',
      'すでに公開されています。SNS側で取消できない場合は、公開先の削除手順を確認してください。',
    );
  }
  if (post.display_state === 'PUBLISHING') {
    throw new InvariantError('IN_FLIGHT', '送信中のため取消できません。結果の確認を待ってください。');
  }

  const now = ctx.clock.nowIso();
  const updated = { ...post, cancelled_at: now, updated_at: now };
  const beforeHash = await snapshotHash(post);
  const afterHash = await snapshotHash(updated);

  await ctx.repo.change(['channelPosts', 'schedules', 'approvals'], async (tx, audit) => {
    const schedules = await tx.getAllBy('schedules', 'channel_post_id', channelPostId);
    for (const s of schedules) {
      if (s.cancelled_at) continue;
      // active_key を外すと一意インデックスから抜け、次の予約を作れるようになる。
      const { active_key: _drop, ...rest } = s;
      await tx.put('schedules', { ...rest, cancelled_at: now, cancel_reason: text });
    }
    if (post.approval_id) {
      const approval = await tx.get('approvals', post.approval_id);
      if (approval && !approval.revoked_at) {
        await tx.put('approvals', { ...approval, revoked_at: now, revoked_reason: `予約取消: ${text}` });
      }
    }
    await tx.put('channelPosts', updated);
    await audit({
      actor: ctx.actor.userId,
      target_id: channelPostId,
      action: 'schedule.cancel',
      before_hash: beforeHash,
      after_hash: afterHash,
      reason: text,
      revision_id: post.current_revision_id,
    });
  });

  return { cancelledAt: now };
}

/**
 * §15 実行手順の1〜2「時刻到来した予約を取得し、承認・停止・接続・期限を再検査」。
 * 今フェーズでは自動実行は行わず、実行できる状態かどうかの判定だけを返す。
 */
export async function inspectDueSchedules(ctx, { nowMs = ctx.clock.nowMs() } = {}) {
  const posts = await ctx.repo.listUpcomingPosts(0, 500);
  const stops = await ctx.repo.activeEmergencyStops();
  const due = [];
  for (const post of posts) {
    if (post.cancelled_at || post.deleted_at) continue;
    if (post.display_state !== 'SCHEDULED') continue;
    if (Date.parse(post.scheduled_at) > nowMs) continue;
    const stopped = stops.find(
      (s) =>
        s.scope === 'ALL' ||
        (s.scope === 'BRAND' && s.scope_id === post.brand_id) ||
        (s.scope === 'ACCOUNT' && s.scope_id === post.social_account_id),
    );
    due.push({
      channelPostId: post.channel_post_id,
      platform: post.platform,
      blockedBy: stopped ? `緊急停止中（${stopped.scope_label}）` : null,
      mode: publishMode(post.platform),
    });
  }
  return due;
}
