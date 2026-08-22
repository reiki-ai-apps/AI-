// §08 承認待ち / §14 承認の完全性 / §17 責任ルール
//
// 承認は「その版・その日時・その投稿先」へ固定する。
// 承認が成立した時点で予約(Schedule)を1件だけ作る。
// 有効な予約が同時に2件できないことは、ストアの一意インデックスが保証する (§13)。

import { uuid } from '../core/ids.js';
import { domainDigest } from '../core/digest.js';
import { assertCan, checkSelfApproval, checkBulkApprovalScope } from '../domain/rbac.js';
import { assertTransition } from '../domain/state.js';
import {
  APPROVAL_COMPONENTS,
  buildApprovalBasis,
  approvalBasisHash,
  computeApprovalComponentHash,
  diffApprovalBasis,
  checkApprovalValid,
} from '../domain/approval.js';
import { InvariantError } from '../domain/invariants.js';
import { ValidationError } from './posts.js';

const SNAPSHOT_DOMAIN = 'REIKI-AUDIT-SNAPSHOT-V1';

/** 承認は「予定時刻＋許可した遅延再試行時間」まで有効。それを過ぎたら再承認 (§36)。 */
export const DEFAULT_RETRY_DELAY_MINUTES = 30;

async function snapshotHash(value) {
  return value == null ? null : domainDigest(SNAPSHOT_DOMAIN, value);
}

async function loadForDecision(ctx, channelPostId) {
  const post = await ctx.repo.getPost(channelPostId);
  if (!post) throw new ValidationError('対象の投稿が見つかりません。');
  if (post.deleted_at) throw new InvariantError('DELETED', '削除済みの投稿は操作できません。');
  const revision = await ctx.repo.getRevision(post.current_revision_id);
  if (!revision) throw new InvariantError('NO_REVISION', '対象の版が見つかりません。');
  return { post, revision };
}

/**
 * Shortsは専用サムネイルを必須にしない。画面側と同じく、現在Revisionに
 * THUMBNAIL素材がないShortsは動画・本文(CONTENT)だけを承認対象にする。
 */
export function requiredApprovalComponents(channelPost, revision) {
  if (!channelPost?.requires_component_approvals) return [];
  const hasThumbnail = (revision?.assets ?? []).some(
    (asset) => String(asset?.asset_role ?? '').toUpperCase() === APPROVAL_COMPONENTS.THUMBNAIL,
  );
  if (channelPost.platform === 'YOUTUBE_SHORTS' && !hasThumbnail) {
    return ['CONTENT'];
  }
  return [...APPROVAL_COMPONENTS];
}

/** 確認依頼 — 下書き／品質確認中 から承認待ちへ。 */
export async function submitForApproval(ctx, channelPostId, { reason = '確認を依頼' } = {}) {
  assertCan(ctx.actor.role, 'approval.submit');
  const { post } = await loadForDecision(ctx, channelPostId);
  assertTransition(post.display_state, 'PENDING_APPROVAL');

  const updated = { ...post, display_state: 'PENDING_APPROVAL', updated_at: ctx.clock.nowIso() };
  const beforeHash = await snapshotHash(post);
  const afterHash = await snapshotHash(updated);

  await ctx.repo.change(['channelPosts'], async (tx, audit) => {
    const live = await tx.get('channelPosts', channelPostId);
    assertTransition(live.display_state, 'PENDING_APPROVAL');
    await tx.put('channelPosts', updated);
    await audit({
      actor: ctx.actor.userId,
      target_id: channelPostId,
      action: 'approval.submit',
      before_hash: beforeHash,
      after_hash: afterHash,
      reason,
      revision_id: post.current_revision_id,
    });
  });
  return { displayState: 'PENDING_APPROVAL' };
}

/**
 * 公開承認。承認と同時に予約を1件作る。
 *
 * @param {object} ctx
 * @param {string} channelPostId
 * @param {{comment?:string, allowedRetryDelayMinutes?:number, correlationId?:string, evidence?:object}} [options]
 */
export async function approve(ctx, channelPostId, options = {}) {
  assertCan(ctx.actor.role, 'approval.approve');

  const { post, revision } = await loadForDecision(ctx, channelPostId);
  assertTransition(post.display_state, 'SCHEDULED');

  // 最終承認や内部APIからの操作でも、記事・動画とサムネイルの
  // Revision/Hash一致承認を回避できないようにサービス層で強制する。
  if (post.requires_component_approvals) {
    const componentVerdict = await verifyComponentApprovals(ctx, channelPostId, {
      allowedRetryDelayMinutes: options.allowedRetryDelayMinutes ?? DEFAULT_RETRY_DELAY_MINUTES,
    });
    if (!componentVerdict.valid) {
      const missing = Object.entries(componentVerdict.components ?? {})
        .filter(([, result]) => !result.valid)
        .map(([scope]) => scope === 'CONTENT' ? '記事・動画' : 'サムネイル');
      throw new InvariantError(
        'COMPONENT_APPROVAL_REQUIRED',
        `${missing.join('・')}の現在Revision/Hashに対する承認が必要です。`,
      );
    }
  }

  const group = await ctx.repo.getPostGroup(post.post_group_id);
  const selfCheck = checkSelfApproval({
    mode: ctx.mode ?? 'SOLO',
    authorUserId: group?.owner_user_id ?? revision.created_by,
    approverUserId: ctx.actor.userId,
  });
  if (!selfCheck.allowed) {
    throw new InvariantError('SELF_APPROVAL_FORBIDDEN', selfCheck.note);
  }

  const allowedRetryDelayMinutes = options.allowedRetryDelayMinutes ?? DEFAULT_RETRY_DELAY_MINUTES;
  const basis = buildApprovalBasis({
    channelPost: post,
    revision,
    schedule: { scheduled_at: post.scheduled_at, time_zone: post.time_zone },
    allowedRetryDelayMinutes,
  });
  const basisHash = await approvalBasisHash(basis);
  const now = ctx.clock.nowIso();
  const correlationId = options.correlationId ?? uuid();

  const approval = {
    approval_id: uuid(),
    channel_post_id: channelPostId,
    post_group_id: post.post_group_id,
    revision_id: revision.revision_id,
    decision: 'APPROVED',
    approver_user_id: ctx.actor.userId,
    approval_basis_hash: basisHash,
    allowed_retry_delay_minutes: allowedRetryDelayMinutes,
    decided_at: now,
    // 予定時刻 + 許可した遅延再試行時間 を過ぎたら再承認が必要 (§36)
    expires_at: new Date(Date.parse(post.scheduled_at) + allowedRetryDelayMinutes * 60_000).toISOString(),
    revoked_at: null,
    revoked_reason: null,
    self_approval: selfCheck.selfApproval,
    comment: options.comment ?? null,
    evidence: options.evidence ?? null,
  };

  const schedule = {
    schedule_id: uuid(),
    channel_post_id: channelPostId,
    scheduled_at: post.scheduled_at,
    time_zone: post.time_zone,
    approval_id: approval.approval_id,
    // 有効なときだけキーを持つ。取消すると外れて一意制約から抜ける (§13)。
    active_key: channelPostId,
    cancelled_at: null,
    created_at: now,
  };

  const updated = {
    ...post,
    display_state: 'SCHEDULED',
    approval_id: approval.approval_id,
    // 画面が「いま承認が有効か」を1件の読み出しで判定できるように持たせる。
    // 正本は approvals ストア側で、実行直前には必ず verifyApprovalStillValid() を通す。
    approval_expires_at: approval.expires_at,
    updated_at: now,
  };

  const beforeHash = await snapshotHash(post);
  const afterHash = await snapshotHash(updated);

  await ctx.repo.change(['channelPosts', 'approvals', 'schedules'], async (tx, audit) => {
    const live = await tx.get('channelPosts', channelPostId);
    if (!live || live.updated_at !== post.updated_at) {
      throw new InvariantError('STALE_REVISION', 'ほかで更新されています。最新の内容を読み直してください。');
    }
    if (live.current_revision_id !== revision.revision_id) {
      throw new InvariantError('STALE_REVISION', '承認しようとした版は最新ではありません。');
    }
    assertTransition(live.display_state, 'SCHEDULED');
    await tx.add('approvals', approval);
    // ここで一意制約に触れたら、その投稿にはすでに有効な予約がある。
    await tx.add('schedules', schedule);
    await tx.put('channelPosts', updated);
    await audit({
      actor: ctx.actor.userId,
      target_id: channelPostId,
      action: selfCheck.selfApproval ? 'approval.approve.self' : 'approval.approve',
      before_hash: beforeHash,
      after_hash: afterHash,
      reason: selfCheck.note ?? options.comment ?? '公開を承認',
      correlation_id: correlationId,
      revision_id: revision.revision_id,
    });
  });

  return {
    approvalId: approval.approval_id,
    approvalBasisHash: basisHash,
    scheduleId: schedule.schedule_id,
    selfApproval: selfCheck.selfApproval,
    note: selfCheck.note,
  };
}

/**
 * 記事・動画(CONTENT)とサムネイル(THUMBNAIL)を別々に承認する。
 * 承認日時・Revision・component Hashはapprovalsストアへ保存され、Boardの正本になる。
 */
export async function recordComponentApproval(ctx, channelPostId, options = {}) {
  assertCan(ctx.actor.role, 'approval.approve');
  const componentScope = String(options.componentScope ?? '').toUpperCase();
  if (!APPROVAL_COMPONENTS.includes(componentScope)) {
    throw new ValidationError('承認対象はCONTENTまたはTHUMBNAILです。', 'componentScope');
  }
  const { post, revision } = await loadForDecision(ctx, channelPostId);
  if (post.display_state !== 'PENDING_APPROVAL') {
    throw new InvariantError('NOT_PENDING_APPROVAL', '承認待ちの投稿だけを承認できます。');
  }
  const group = await ctx.repo.getPostGroup(post.post_group_id);
  const selfCheck = checkSelfApproval({
    mode: ctx.mode ?? 'SOLO',
    authorUserId: group?.owner_user_id ?? revision.created_by,
    approverUserId: ctx.actor.userId,
  });
  if (!selfCheck.allowed) throw new InvariantError('SELF_APPROVAL_FORBIDDEN', selfCheck.note);

  const allowedRetryDelayMinutes = options.allowedRetryDelayMinutes ?? DEFAULT_RETRY_DELAY_MINUTES;
  const currentHash = await computeApprovalComponentHash({
    channelPost: post,
    revision,
    schedule: { scheduled_at: post.scheduled_at, time_zone: post.time_zone },
    componentScope,
    allowedRetryDelayMinutes,
  });
  if (options.expectedHash && options.expectedHash !== currentHash) {
    throw new InvariantError('BASIS_MISMATCH', '承認対象Hashが現在の内容と一致しません。再確認してください。');
  }

  const existing = (await ctx.repo.listApprovalsFor(channelPostId)).find((item) =>
    item.decision === 'COMPONENT_APPROVED'
    && item.component_scope === componentScope
    && item.revision_id === revision.revision_id
    && item.approval_basis_hash === currentHash
    && !item.revoked_at
    && (!item.expires_at || Date.parse(item.expires_at) > ctx.clock.nowMs()));
  if (existing) {
    return { approvalId: existing.approval_id, approvalBasisHash: currentHash, componentScope, reused: true };
  }

  const now = ctx.clock.nowIso();
  const approval = {
    approval_id: uuid(),
    channel_post_id: channelPostId,
    post_group_id: post.post_group_id,
    revision_id: revision.revision_id,
    decision: 'COMPONENT_APPROVED',
    component_scope: componentScope,
    approver_user_id: ctx.actor.userId,
    approval_basis_hash: currentHash,
    allowed_retry_delay_minutes: allowedRetryDelayMinutes,
    decided_at: now,
    expires_at: new Date(Date.parse(post.scheduled_at) + allowedRetryDelayMinutes * 60_000).toISOString(),
    revoked_at: null,
    revoked_reason: null,
    self_approval: selfCheck.selfApproval,
    comment: options.comment ?? null,
    evidence: options.evidence ?? null,
  };
  const updated = {
    ...post,
    component_approval_ids: { ...(post.component_approval_ids ?? {}), [componentScope]: approval.approval_id },
    updated_at: now,
  };
  const beforeHash = await snapshotHash(post);
  const afterHash = await snapshotHash(updated);
  await ctx.repo.change(['channelPosts', 'approvals'], async (tx, audit) => {
    const live = await tx.get('channelPosts', channelPostId);
    if (!live || live.current_revision_id !== revision.revision_id) {
      throw new InvariantError('STALE_REVISION', '承認しようとした版は最新ではありません。');
    }
    await tx.add('approvals', approval);
    await tx.put('channelPosts', updated);
    await audit({
      actor: ctx.actor.userId,
      target_id: channelPostId,
      action: `approval.component.${componentScope.toLowerCase()}`,
      before_hash: beforeHash,
      after_hash: afterHash,
      reason: options.comment ?? `${componentScope}を承認`,
      revision_id: revision.revision_id,
    });
  });
  return { approvalId: approval.approval_id, approvalBasisHash: currentHash, componentScope, reused: false };
}

/** 現在のRevision/Hashに一致する2つの承認証拠を検査する。 */
export async function verifyComponentApprovals(ctx, channelPostId) {
  const { post, revision } = await loadForDecision(ctx, channelPostId);
  const approvals = await ctx.repo.listApprovalsFor(channelPostId);
  const components = {};
  const requiredComponents = requiredApprovalComponents(post, revision);
  for (const componentScope of requiredComponents) {
    const currentHash = await computeApprovalComponentHash({
      channelPost: post,
      revision,
      schedule: { scheduled_at: post.scheduled_at, time_zone: post.time_zone },
      componentScope,
      allowedRetryDelayMinutes: DEFAULT_RETRY_DELAY_MINUTES,
    });
    const approval = approvals.find((item) => item.decision === 'COMPONENT_APPROVED'
      && item.component_scope === componentScope
      && item.revision_id === revision.revision_id
      && item.approval_basis_hash === currentHash
      && !item.revoked_at
      && (!item.expires_at || Date.parse(item.expires_at) > ctx.clock.nowMs()));
    components[componentScope] = {
      valid: Boolean(approval),
      approval: approval ?? null,
      currentHash,
      revisionId: revision.revision_id,
      reason: approval ? 'VALID' : 'MISSING_OR_STALE',
    };
  }
  return { valid: requiredComponents.every((scope) => components[scope].valid), components };
}

/** 差し戻し。理由を必須にする (§08 承認／差し戻し／コメント)。 */
export async function reject(ctx, channelPostId, { comment } = {}) {
  assertCan(ctx.actor.role, 'approval.reject');
  const text = typeof comment === 'string' ? comment.trim() : '';
  if (!text) throw new ValidationError('差し戻しの理由を入力してください。', 'comment');

  const { post, revision } = await loadForDecision(ctx, channelPostId);
  assertTransition(post.display_state, 'DRAFT');

  const now = ctx.clock.nowIso();
  const record = {
    approval_id: uuid(),
    channel_post_id: channelPostId,
    post_group_id: post.post_group_id,
    revision_id: revision.revision_id,
    decision: 'REJECTED',
    approver_user_id: ctx.actor.userId,
    approval_basis_hash: null,
    decided_at: now,
    expires_at: null,
    revoked_at: null,
    revoked_reason: null,
    self_approval: false,
    comment: text,
  };
  const updated = { ...post, display_state: 'DRAFT', approval_id: null, approval_expires_at: null, updated_at: now };
  const beforeHash = await snapshotHash(post);
  const afterHash = await snapshotHash(updated);

  await ctx.repo.change(['channelPosts', 'approvals'], async (tx, audit) => {
    assertTransition((await tx.get('channelPosts', channelPostId)).display_state, 'DRAFT');
    await tx.add('approvals', record);
    await tx.put('channelPosts', updated);
    await audit({
      actor: ctx.actor.userId,
      target_id: channelPostId,
      action: 'approval.reject',
      before_hash: beforeHash,
      after_hash: afterHash,
      reason: text,
      revision_id: revision.revision_id,
    });
  });

  return { displayState: 'DRAFT', comment: text };
}

/**
 * §17「異なるPost Groupをまとめて承認しない。同一企画の4SNSだけを一括対象にできる。」
 */
export async function approveGroup(ctx, channelPostIds, options = {}) {
  const posts = [];
  for (const id of channelPostIds) {
    const p = await ctx.repo.getPost(id);
    if (!p) throw new ValidationError(`対象の投稿が見つかりません: ${id}`);
    posts.push(p);
  }
  const scope = checkBulkApprovalScope(posts);
  if (!scope.allowed) throw new InvariantError('BULK_SCOPE', scope.message);

  const correlationId = options.correlationId ?? uuid();
  const results = [];
  for (const id of channelPostIds) {
    results.push(await approve(ctx, id, { ...options, correlationId }));
  }
  return { correlationId, results };
}

/**
 * 承認待ち画面が出す「何が変わったか」。
 * 直近の承認(無効化されたものを含む)と現在の内容を比べる。
 */
export async function describePendingChange(ctx, channelPostId) {
  const post = await ctx.repo.getPost(channelPostId);
  if (!post) return null;
  const revision = await ctx.repo.getRevision(post.current_revision_id);
  const approvals = await ctx.repo.listApprovalsFor(channelPostId);
  const lastApproved = approvals.find((a) => a.decision === 'APPROVED');
  if (!lastApproved) return { firstApproval: true, changes: [] };

  const previousRevision = await ctx.repo.getRevision(lastApproved.revision_id);
  if (!previousRevision) return { firstApproval: true, changes: [] };

  const before = buildApprovalBasis({
    channelPost: post,
    revision: previousRevision,
    schedule: { scheduled_at: post.scheduled_at, time_zone: post.time_zone },
    allowedRetryDelayMinutes: lastApproved.allowed_retry_delay_minutes ?? DEFAULT_RETRY_DELAY_MINUTES,
  });
  const after = buildApprovalBasis({
    channelPost: post,
    revision,
    schedule: { scheduled_at: post.scheduled_at, time_zone: post.time_zone },
    allowedRetryDelayMinutes: lastApproved.allowed_retry_delay_minutes ?? DEFAULT_RETRY_DELAY_MINUTES,
  });
  const diff = diffApprovalBasis(before, after);
  return {
    firstApproval: false,
    revokedReason: lastApproved.revoked_reason,
    previousRevisionNo: previousRevision.revision_no,
    changes: diff.changes,
  };
}

/** 実行直前の再検査 (§14 二重検査)。画面制御に依存しない。 */
export async function verifyApprovalStillValid(ctx, channelPostId) {
  const post = await ctx.repo.getPost(channelPostId);
  if (!post) throw new ValidationError('対象の投稿が見つかりません。');
  const revision = await ctx.repo.getRevision(post.current_revision_id);
  const approval = await ctx.repo.getApproval(post.approval_id);
  const basis = buildApprovalBasis({
    channelPost: post,
    revision,
    schedule: { scheduled_at: post.scheduled_at, time_zone: post.time_zone },
    allowedRetryDelayMinutes: approval?.allowed_retry_delay_minutes ?? DEFAULT_RETRY_DELAY_MINUTES,
  });
  const currentHash = await approvalBasisHash(basis);
  const finalVerdict = {
    ...checkApprovalValid(approval, { approvalBasisHash: currentHash, revisionId: revision?.revision_id }, ctx.clock.nowMs()),
    approval,
    currentHash,
  };
  const componentVerdict = post.requires_component_approvals
    ? await verifyComponentApprovals(ctx, channelPostId)
    : { valid: true, components: {} };
  if (!componentVerdict.valid) {
    return {
      ...finalVerdict,
      valid: false,
      reason: 'COMPONENT_APPROVAL_MISSING',
      message: '記事・動画とサムネイルの両方の承認が必要です。',
      components: componentVerdict.components,
    };
  }
  return { ...finalVerdict, components: componentVerdict.components };
}
