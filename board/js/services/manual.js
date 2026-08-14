// §16 手動投稿Fallback
//
// §38 の一次情報どおり、4SNSとも直接投稿は現時点で有効にならない
// (TikTokは内部用途で不適合、YouTube/Instagram/Xは未確認=無効)。
// したがって、これがいまの実際の公開経路になる。
//
//   1. claimManualExecution  … 同じ実行キーを押さえ、自動実行を止める
//   2. getApprovedContent    … 承認された版の本文と素材Hashを取り出す
//   3. (人がSNSで投稿する)
//   4. confirmManualPublish  … 公開URL/外部IDを登録し、照合できた場合だけ投稿済みにする
//
// 外部IDも公開URLも無いまま「投稿済み」にはできない (§13 / G04)。

import { uuid } from '../core/ids.js';
import { dateKey } from '../core/tz.js';
import { sha256Hex, domainDigest } from '../core/digest.js';
import { assertCan } from '../domain/rbac.js';
import { assertTransition, assertExecutionTransition } from '../domain/state.js';
import { assertExternalEvidence, externalPostKey, InvariantError } from '../domain/invariants.js';
import { platformName } from '../domain/platforms.js';
import { publishMode } from '../domain/capabilities.js';
import { ValidationError } from './posts.js';
import { verifyApprovalStillValid } from './approvals.js';

const SNAPSHOT_DOMAIN = 'REIKI-AUDIT-SNAPSHOT-V1';

async function snapshotHash(value) {
  return value == null ? null : domainDigest(SNAPSHOT_DOMAIN, value);
}

/**
 * §15 idempotency_key = SHA256(channel_post_id + revision_id + scheduled_at + operation_type)
 * 設計書の式をそのまま実装する。
 */
export function computeIdempotencyKey({ channelPostId, revisionId, scheduledAt, operationType }) {
  return sha256Hex(`${channelPostId}${revisionId}${scheduledAt}${operationType}`);
}

/** 手動での取得を拒否すべき実行状態 (§16)。先に外部照合が必要。 */
const BLOCKING_STATES = new Set(['LEASED', 'SENT', 'UNKNOWN_OUTCOME', 'RECONCILING']);

/**
 * 手動実行の取得。同じ実行キーを押さえ、自動予約を止める。
 * すでに外部へ送信された可能性がある状態では取得できない。
 */
export async function claimManualExecution(ctx, channelPostId, { reason = '手動投稿のため取得' } = {}) {
  assertCan(ctx.actor.role, 'execution.manual');

  const post = await ctx.repo.getPost(channelPostId);
  if (!post) throw new ValidationError('対象の投稿が見つかりません。');
  if (post.cancelled_at || post.deleted_at) {
    throw new InvariantError('STATE_CONFLICT', '取消または削除済みの投稿は実行できません。');
  }

  // 緊急停止中は新規実行を開始しない (§16)。
  const stops = await ctx.repo.activeEmergencyStops();
  const stopped = stops.find(
    (s) =>
      s.scope === 'ALL' ||
      (s.scope === 'BRAND' && s.scope_id === post.brand_id) ||
      (s.scope === 'ACCOUNT' && s.scope_id === post.social_account_id),
  );
  if (stopped) {
    throw new InvariantError('EMERGENCY_STOPPED', `緊急停止中のため実行できません（${stopped.scope_label}）。`);
  }

  // 承認・版Hash・期限を実行の直前にもう一度検査する (§14 二重検査 / §15 実行手順2)。
  const verdict = await verifyApprovalStillValid(ctx, channelPostId);
  if (!verdict.valid) throw new InvariantError(verdict.reason, verdict.message);

  const existing = await ctx.repo.listExecutions(channelPostId);
  const blocking = existing.find((e) => BLOCKING_STATES.has(e.state));
  if (blocking) {
    throw new InvariantError(
      'RECONCILE_FIRST',
      `この投稿はすでに送信された可能性があります（${blocking.state}）。先にSNS側の投稿有無を確認してください。`,
    );
  }
  const confirmed = existing.find((e) => e.state === 'CONFIRMED');
  if (confirmed) {
    throw new InvariantError('ALREADY_CONFIRMED', 'すでに公開が確認されています。');
  }

  const idempotencyKey = await computeIdempotencyKey({
    channelPostId,
    revisionId: post.current_revision_id,
    scheduledAt: post.scheduled_at,
    operationType: 'PUBLISH',
  });

  const now = ctx.clock.nowIso();
  const reusable = existing.find((e) => e.idempotency_key === idempotencyKey);

  const attempt = {
    execution_id: reusable?.execution_id ?? uuid(),
    channel_post_id: channelPostId,
    revision_id: post.current_revision_id,
    approval_id: post.approval_id,
    platform: post.platform,
    social_account_id: post.social_account_id,
    idempotency_key: idempotencyKey,
    state: 'MANUAL_LEASED',
    mode: 'MANUAL',
    lease_owner: ctx.actor.userId,
    // 次フェーズで自動Workerと競合させるときに、この番号がfencing tokenになる。
    lease_epoch: (reusable?.lease_epoch ?? 0) + 1,
    external_post_id: null,
    public_url: null,
    failure_kind: null,
    created_at: reusable?.created_at ?? now,
    updated_at: now,
    confirmed_at: null,
  };
  if (reusable) assertExecutionTransition(reusable.state, 'MANUAL_LEASED');

  const updatedPost = { ...post, display_state: 'PUBLISHING', execution_id: attempt.execution_id, updated_at: now };
  assertTransition(post.display_state, 'PUBLISHING');

  const beforeHash = await snapshotHash(post);
  const afterHash = await snapshotHash(updatedPost);

  await ctx.repo.change(['channelPosts', 'executionAttempts', 'schedules'], async (tx, audit) => {
    const live = await tx.get('channelPosts', channelPostId);
    assertTransition(live.display_state, 'PUBLISHING');
    // idempotency_key の一意インデックスが、同じ実行キーの2件目を構造的に拒否する。
    await tx.put('executionAttempts', attempt);
    await tx.put('channelPosts', updatedPost);
    await audit({
      actor: ctx.actor.userId,
      target_id: channelPostId,
      action: 'execution.manual.claim',
      before_hash: beforeHash,
      after_hash: afterHash,
      reason,
      revision_id: post.current_revision_id,
      execution_id: attempt.execution_id,
    });
  });

  return {
    executionId: attempt.execution_id,
    idempotencyKey,
    leaseEpoch: attempt.lease_epoch,
    mode: publishMode(post.platform),
  };
}

/**
 * 承認された版の本文と素材Hashを取り出す (§16 手順2)。
 * 人はここに出た内容をそのままSNSへ貼る。
 */
export async function getApprovedContent(ctx, channelPostId) {
  const post = await ctx.repo.getPost(channelPostId);
  if (!post) throw new ValidationError('対象の投稿が見つかりません。');
  const approval = await ctx.repo.getApproval(post.approval_id);
  if (!approval || approval.decision !== 'APPROVED' || approval.revoked_at) {
    throw new InvariantError('NO_APPROVAL', '有効な承認がありません。承認された内容だけを投稿できます。');
  }
  const revision = await ctx.repo.getRevision(approval.revision_id);
  return {
    platform: post.platform,
    platformName: platformName(post.platform),
    socialAccountId: post.social_account_id,
    scheduledAt: post.scheduled_at,
    timeZone: post.time_zone,
    approvalId: approval.approval_id,
    approvalBasisHash: approval.approval_basis_hash,
    revisionId: revision.revision_id,
    revisionNo: revision.revision_no,
    title: revision.title,
    body: revision.body,
    hashtags: revision.hashtags,
    cta: revision.cta,
    visibility: revision.visibility,
    assets: revision.assets.map((a) => ({
      asset_id: a.asset_id,
      file_name: a.file_name,
      sha256: a.sha256,
      order: a.order,
      alt_text: a.alt_text,
      mime: a.mime,
    })),
    rights: revision.rights,
  };
}

/**
 * 手動投稿の結果を登録する (§16 手順3-4)。
 *
 * 「投稿済み」に確定できるのは、外部ID/公開URLがあり、かつ
 * アカウント・内容・公開時刻を人が照合できたと明示した場合だけ。
 */
export async function confirmManualPublish(ctx, channelPostId, input) {
  assertCan(ctx.actor.role, 'execution.manual');

  const post = await ctx.repo.getPost(channelPostId);
  if (!post) throw new ValidationError('対象の投稿が見つかりません。');

  const evidence = {
    external_post_id: (input.externalPostId ?? '').trim() || null,
    public_url: (input.publicUrl ?? '').trim() || null,
  };
  // G04: 外部証拠なしに投稿済みへ進ませない。
  assertExternalEvidence(evidence);

  if (evidence.public_url && !/^https?:\/\//i.test(evidence.public_url)) {
    throw new ValidationError('公開URLは http(s) から始まる形式で入力してください。', 'publicUrl');
  }

  // §16「アカウント・内容・公開時刻を照合できた場合だけ投稿済みに確定する」
  const checks = {
    account: input.accountMatches === true,
    content: input.contentMatches === true,
    publishedAt: input.publishedAtMatches === true,
  };
  const unchecked = Object.entries(checks)
    .filter(([, v]) => !v)
    .map(([k]) => ({ account: 'アカウント', content: '内容', publishedAt: '公開時刻' })[k]);
  if (unchecked.length) {
    throw new InvariantError(
      'RECONCILE_INCOMPLETE',
      `${unchecked.join('・')}の照合が完了していません。確認できた項目だけにチェックしてください。`,
    );
  }

  const executions = await ctx.repo.listExecutions(channelPostId);
  const attempt = executions.find((e) => e.execution_id === post.execution_id) ?? executions.at(-1);
  if (!attempt) {
    throw new InvariantError('NO_EXECUTION', '手動投稿の取得が行われていません。先に「手動で投稿する」を実行してください。');
  }
  // §28B 人の解決: 結果不明は照合(RECONCILING)を経由してからCONFIRMEDへ進む。
  // 「結果不明からいきなり成功にする」経路は作らない。
  const path = attempt.state === 'UNKNOWN_OUTCOME' ? ['RECONCILING', 'CONFIRMED'] : ['CONFIRMED'];
  let cursor = attempt.state;
  for (const next of path) {
    assertExecutionTransition(cursor, next);
    cursor = next;
  }

  const publishedAt = input.publishedAtIso ?? ctx.clock.nowIso();
  if (!Number.isFinite(Date.parse(publishedAt))) {
    throw new ValidationError('公開時刻が不正です。', 'publishedAt');
  }

  const now = ctx.clock.nowIso();
  const updatedAttempt = {
    ...attempt,
    state: 'CONFIRMED',
    external_post_id: evidence.external_post_id,
    public_url: evidence.public_url,
    // §13 platform + account + external_post_id は一意
    external_key: evidence.external_post_id
      ? externalPostKey({
          platform: post.platform,
          social_account_id: post.social_account_id,
          external_post_id: evidence.external_post_id,
        })
      : undefined,
    confirmed_at: now,
    updated_at: now,
    reconciliation: {
      ...checks,
      // 結果不明からの復帰だったかどうかを証拠として残す (§28B ReconciliationAttempt)。
      via_reconciliation: attempt.state === 'UNKNOWN_OUTCOME',
      resolution: 'HUMAN_URL_MATCH',
      confirmed_by: ctx.actor.userId,
      confirmed_at: now,
    },
  };

  const updatedPost = {
    ...post,
    display_state: 'PUBLISHED',
    published_at: publishedAt,
    public_url: evidence.public_url,
    external_post_id: evidence.external_post_id,
    failure_kind: null,
    updated_at: now,
  };
  // 公開日が予定日とずれた場合、カレンダー上は実際に公開された日へ移す。
  updatedPost.calendar_date_key = dateKey(Date.parse(publishedAt), post.time_zone);

  assertTransition(post.display_state, 'PUBLISHED');

  const beforeHash = await snapshotHash(post);
  const afterHash = await snapshotHash(updatedPost);

  await ctx.repo.change(['channelPosts', 'executionAttempts'], async (tx, audit) => {
    const live = await tx.get('channelPosts', channelPostId);
    assertTransition(live.display_state, 'PUBLISHED');
    // external_key の一意インデックスが、同じ外部投稿の二重登録を拒否する。
    await tx.put('executionAttempts', updatedAttempt);
    await tx.put('channelPosts', updatedPost);
    await audit({
      actor: ctx.actor.userId,
      target_id: channelPostId,
      action: 'execution.manual.confirm',
      before_hash: beforeHash,
      after_hash: afterHash,
      reason: `手動投稿を確認（${evidence.public_url ?? evidence.external_post_id}）`,
      revision_id: post.current_revision_id,
      execution_id: attempt.execution_id,
    });
  });

  return { displayState: 'PUBLISHED', publishedAt, ...evidence };
}

/** 手動投稿をやめる。実行キーを手放し、予約状態へ戻す。 */
export async function releaseManualClaim(ctx, channelPostId, { reason } = {}) {
  assertCan(ctx.actor.role, 'execution.manual');
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!text) throw new ValidationError('手動投稿を取りやめる理由を入力してください。', 'reason');

  const post = await ctx.repo.getPost(channelPostId);
  if (!post) throw new ValidationError('対象の投稿が見つかりません。');
  const executions = await ctx.repo.listExecutions(channelPostId);
  const attempt = executions.find((e) => e.execution_id === post.execution_id);
  if (!attempt || attempt.state !== 'MANUAL_LEASED') {
    throw new InvariantError('STATE_CONFLICT', '手動投稿中ではありません。');
  }

  const now = ctx.clock.nowIso();
  const updatedAttempt = { ...attempt, state: 'PENDING', lease_owner: null, updated_at: now };
  const updatedPost = { ...post, display_state: 'SCHEDULED', execution_id: null, updated_at: now };

  const beforeHash = await snapshotHash(post);
  const afterHash = await snapshotHash(updatedPost);

  await ctx.repo.change(['channelPosts', 'executionAttempts'], async (tx, audit) => {
    await tx.put('executionAttempts', updatedAttempt);
    await tx.put('channelPosts', updatedPost);
    await audit({
      actor: ctx.actor.userId,
      target_id: channelPostId,
      action: 'execution.manual.release',
      before_hash: beforeHash,
      after_hash: afterHash,
      reason: text,
      execution_id: attempt.execution_id,
    });
  });
  return { displayState: 'SCHEDULED' };
}

/**
 * 結果不明として記録する (§09 / §15)。
 * 自動再送は行わず、人の確認導線だけを示す。
 */
export async function markOutcomeUnknown(ctx, channelPostId, { reason = '送信後に結果を確認できなかった' } = {}) {
  assertCan(ctx.actor.role, 'execution.manual');
  const post = await ctx.repo.getPost(channelPostId);
  if (!post) throw new ValidationError('対象の投稿が見つかりません。');
  const executions = await ctx.repo.listExecutions(channelPostId);
  const attempt = executions.find((e) => e.execution_id === post.execution_id) ?? executions.at(-1);
  if (!attempt) throw new InvariantError('NO_EXECUTION', '対象の実行がありません。');
  assertExecutionTransition(attempt.state, 'UNKNOWN_OUTCOME');

  const now = ctx.clock.nowIso();
  const updatedAttempt = { ...attempt, state: 'UNKNOWN_OUTCOME', updated_at: now };
  const updatedPost = {
    ...post,
    display_state: 'ACTION_REQUIRED',
    failure_kind: 'UNKNOWN_OUTCOME',
    updated_at: now,
  };
  const beforeHash = await snapshotHash(post);
  const afterHash = await snapshotHash(updatedPost);

  await ctx.repo.change(['channelPosts', 'executionAttempts'], async (tx, audit) => {
    await tx.put('executionAttempts', updatedAttempt);
    await tx.put('channelPosts', updatedPost);
    await audit({
      actor: ctx.actor.userId,
      target_id: channelPostId,
      action: 'execution.outcome_unknown',
      before_hash: beforeHash,
      after_hash: afterHash,
      reason,
      execution_id: attempt.execution_id,
    });
  });
  return { displayState: 'ACTION_REQUIRED', failureKind: 'UNKNOWN_OUTCOME' };
}
