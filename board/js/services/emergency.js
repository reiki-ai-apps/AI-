// §16 安全装置 — 緊急停止 / 論理削除 / 30日復元
//
// 緊急停止は「新規実行を開始しない」ためのもの。既存データの閲覧・編集・承認は止めない
// (§32「故障しても読める」)。

import { uuid } from '../core/ids.js';
import { domainDigest } from '../core/digest.js';
import { assertCan } from '../domain/rbac.js';
import { brandName } from '../domain/brands.js';
import { isRestorable, RESTORE_WINDOW_DAYS, InvariantError } from '../domain/invariants.js';
import { ValidationError } from './posts.js';

const SNAPSHOT_DOMAIN = 'REIKI-AUDIT-SNAPSHOT-V1';

async function snapshotHash(value) {
  return value == null ? null : domainDigest(SNAPSHOT_DOMAIN, value);
}

export const STOP_SCOPES = Object.freeze({
  ALL: 'ALL',
  BRAND: 'BRAND',
  ACCOUNT: 'ACCOUNT',
});

function scopeLabel(scope, scopeId) {
  if (scope === 'ALL') return '全体';
  if (scope === 'BRAND') return `系統：${brandName(scopeId)}`;
  return `アカウント：${scopeId}`;
}

/** 緊急停止。停止後は新規実行を開始しない (§16)。 */
export async function createEmergencyStop(ctx, { scope, scopeId = null, reason }) {
  assertCan(ctx.actor.role, 'emergency.stop');
  if (!Object.hasOwn(STOP_SCOPES, scope)) throw new ValidationError('停止範囲が不正です。', 'scope');
  if (scope !== 'ALL' && !scopeId) throw new ValidationError('停止対象を指定してください。', 'scopeId');
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!text) throw new ValidationError('停止の理由を入力してください。', 'reason');

  const now = ctx.clock.nowIso();
  const label = scopeLabel(scope, scopeId);
  const stop = {
    stop_id: uuid(),
    scope,
    scope_id: scopeId,
    scope_label: label,
    // 有効な間だけキーを持つ。同じ範囲の二重停止を一意インデックスが拒否する。
    active_scope: `${scope}:${scopeId ?? '*'}`,
    reason: text,
    created_by: ctx.actor.userId,
    created_at: now,
    released_at: null,
  };

  await ctx.repo.change(['emergencyStops'], async (tx, audit) => {
    await tx.add('emergencyStops', stop);
    await audit({
      actor: ctx.actor.userId,
      target_type: 'emergencyStop',
      target_id: stop.stop_id,
      action: 'emergency.stop',
      before_hash: null,
      after_hash: await snapshotHash(stop),
      reason: `${label} を緊急停止：${text}`,
    });
  });

  return { stopId: stop.stop_id, scopeLabel: label };
}

/** 停止の解除。 */
export async function releaseEmergencyStop(ctx, stopId, { reason } = {}) {
  assertCan(ctx.actor.role, 'emergency.stop');
  const stops = await ctx.repo.activeEmergencyStops();
  const stop = stops.find((s) => s.stop_id === stopId);
  if (!stop) throw new InvariantError('NOT_FOUND', '有効な緊急停止が見つかりません。');

  const now = ctx.clock.nowIso();
  const { active_scope: _drop, ...rest } = stop;
  const updated = { ...rest, released_at: now, released_by: ctx.actor.userId, release_reason: reason ?? null };

  await ctx.repo.change(['emergencyStops'], async (tx, audit) => {
    await tx.put('emergencyStops', updated);
    await audit({
      actor: ctx.actor.userId,
      target_type: 'emergencyStop',
      target_id: stopId,
      action: 'emergency.release',
      before_hash: await snapshotHash(stop),
      after_hash: await snapshotHash(updated),
      reason: reason ?? `${stop.scope_label} の停止を解除`,
    });
  });
  return { released: true };
}

/**
 * 論理削除 (§16)。データは残す。30日間は管理者が監査履歴付きで復元できる。
 */
export async function softDeletePost(ctx, channelPostId, { reason } = {}) {
  assertCan(ctx.actor.role, 'post.delete');
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!text) throw new ValidationError('削除の理由を入力してください。', 'reason');

  const post = await ctx.repo.getPost(channelPostId);
  if (!post) throw new ValidationError('対象の投稿が見つかりません。');
  if (post.deleted_at) throw new InvariantError('STATE_CONFLICT', 'すでに削除済みです。');

  const now = ctx.clock.nowIso();
  const updated = { ...post, deleted_at: now, deleted_by: ctx.actor.userId, delete_reason: text, updated_at: now };
  const beforeHash = await snapshotHash(post);
  const afterHash = await snapshotHash(updated);

  await ctx.repo.change(['channelPosts', 'schedules'], async (tx, audit) => {
    const schedules = await tx.getAllBy('schedules', 'channel_post_id', channelPostId);
    for (const s of schedules) {
      if (s.cancelled_at) continue;
      const { active_key: _drop, ...rest } = s;
      await tx.put('schedules', { ...rest, cancelled_at: now, cancel_reason: `削除: ${text}` });
    }
    await tx.put('channelPosts', updated);
    await audit({
      actor: ctx.actor.userId,
      target_id: channelPostId,
      action: 'post.delete',
      before_hash: beforeHash,
      after_hash: afterHash,
      reason: text,
      revision_id: post.current_revision_id,
    });
  });

  return { deletedAt: now, restorableUntilDays: RESTORE_WINDOW_DAYS };
}

/** 復元。30日を過ぎたものは復元できない (§16)。 */
export async function restorePost(ctx, channelPostId, { reason = '誤削除の復元' } = {}) {
  assertCan(ctx.actor.role, 'post.restore');

  const post = await ctx.repo.getPost(channelPostId);
  if (!post) throw new ValidationError('対象の投稿が見つかりません。');
  if (!post.deleted_at) throw new InvariantError('STATE_CONFLICT', '削除されていません。');
  if (!isRestorable(post.deleted_at, ctx.clock.nowMs())) {
    throw new InvariantError(
      'RESTORE_WINDOW_EXPIRED',
      `削除から${RESTORE_WINDOW_DAYS}日を過ぎているため復元できません。`,
    );
  }

  const now = ctx.clock.nowIso();
  const updated = {
    ...post,
    deleted_at: null,
    deleted_by: null,
    delete_reason: null,
    restored_at: now,
    restored_by: ctx.actor.userId,
    updated_at: now,
  };
  const beforeHash = await snapshotHash(post);
  const afterHash = await snapshotHash(updated);

  await ctx.repo.change(['channelPosts'], async (tx, audit) => {
    await tx.put('channelPosts', updated);
    await audit({
      actor: ctx.actor.userId,
      target_id: channelPostId,
      action: 'post.restore',
      before_hash: beforeHash,
      after_hash: afterHash,
      reason,
      revision_id: post.current_revision_id,
    });
  });

  return { restoredAt: now };
}
