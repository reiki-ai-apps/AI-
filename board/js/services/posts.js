// 投稿の登録・編集 (§08 登録ドロワー / §12 / §25「不変化のタイミング」)
//
// 編集は上書きしない。必ず新しいPostRevisionを追加する。
// 承認根拠に触れる編集(本文・素材・日時・投稿先など)は承認を即時無効化し、
// 社内メモ・内部タグ・担当者・監査コメントの編集では承認を維持する (§14 / G07)。

import { uuid } from '../core/ids.js';
import { dateKey } from '../core/tz.js';
import { domainDigest } from '../core/digest.js';
import { assertCan } from '../domain/rbac.js';
import { isBrandId } from '../domain/brands.js';
import { isPlatformId, sortPlatforms } from '../domain/platforms.js';
import { assertTransition } from '../domain/state.js';
import { buildApprovalBasis, approvalBasisHash, diffApprovalBasis } from '../domain/approval.js';
import { InvariantError } from '../domain/invariants.js';

const SNAPSHOT_DOMAIN = 'REIKI-AUDIT-SNAPSHOT-V1';

export class ValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = 'ValidationError';
    this.code = 'VALIDATION_FAILED';
    this.status = 422;
    this.field = field;
  }
}

function requireText(value, label, field) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) throw new ValidationError(`${label}を入力してください。`, field);
  return s;
}

async function snapshotHash(value) {
  return value == null ? null : domainDigest(SNAPSHOT_DOMAIN, value);
}

function normalizeAssets(assets = []) {
  return assets.map((a, i) => ({
    asset_id: a.asset_id ?? uuid(),
    sha256: a.sha256 ?? null,
    mime: a.mime ?? null,
    bytes: a.bytes ?? null,
    order: Number.isFinite(a.order) ? a.order : i,
    crop: a.crop ?? null,
    thumbnail_sha256: a.thumbnail_sha256 ?? null,
    subtitle_sha256: a.subtitle_sha256 ?? null,
    alt_text: a.alt_text ?? '',
    rights_status: a.rights_status ?? 'UNKNOWN',
    file_name: a.file_name ?? null,
    asset_role: a.asset_role ?? null,
    public_url: a.public_url ?? null,
    thumbnail_url: a.thumbnail_url ?? null,
    preview_url: a.preview_url ?? null,
  }));
}

function normalizeRights(rights) {
  return {
    confirmed: rights?.confirmed === true,
    rights_status: rights?.rights_status ?? 'UNKNOWN',
    sources: (rights?.sources ?? []).map((s) => ({
      claim_id: s.claim_id ?? uuid(),
      source_url: s.source_url,
      verified_at: s.verified_at ?? null,
      epistemic_status: s.epistemic_status ?? null,
    })),
  };
}

/** 1つのSNS向けの版オブジェクトを作る。作った瞬間から不変として扱う。 */
function makeRevision({ channelPostId, revisionNo, payload, assets, rights, createdAt, createdBy }) {
  return {
    revision_id: uuid(),
    channel_post_id: channelPostId,
    revision_no: revisionNo,
    body: payload.body ?? '',
    title: payload.title ?? '',
    hashtags: [...(payload.hashtags ?? [])],
    cta: payload.cta ?? '',
    visibility: payload.visibility ?? 'PUBLIC',
    assets: normalizeAssets(assets),
    rights: normalizeRights(rights),
    created_at: createdAt,
    created_by: createdBy,
  };
}

/**
 * 企画1件と、そのSNS別投稿を作る (§12 PostGroup が親、ChannelPost が子)。
 *
 * @param {{repo:object, clock:object, actor:{userId:string,role:string}}} ctx
 */
export async function createPostGroup(ctx, input) {
  assertCan(ctx.actor.role, 'post.create');

  const brandId = input.brandId;
  if (!isBrandId(brandId)) throw new ValidationError('系統を選んでください。', 'brandId');

  const projectTitle = requireText(input.projectTitle, '企画名', 'projectTitle');

  const platforms = sortPlatforms(input.platforms ?? []);
  if (!platforms.length) throw new ValidationError('投稿先SNSを1つ以上選んでください。', 'platforms');
  for (const p of platforms) {
    if (!isPlatformId(p)) throw new ValidationError(`未知のSNSです: ${p}`, 'platforms');
  }

  const scheduledAt = input.scheduledAtIso;
  if (!Number.isFinite(Date.parse(scheduledAt ?? ''))) {
    throw new ValidationError('公開予定日時を入力してください。', 'scheduledAt');
  }
  const timeZone = input.timeZone ?? ctx.clock.timeZone;
  const now = ctx.clock.nowIso();
  const correlationId = uuid();

  const postGroupId = uuid();
  const group = {
    post_group_id: postGroupId,
    brand_id: brandId,
    project_title: projectTitle,
    owner_user_id: input.ownerUserId ?? ctx.actor.userId,
    approver_user_id: input.approverUserId ?? ctx.actor.userId,
    source_skill: input.sourceSkill ?? 'manual',
    source_run_id: input.sourceRunId ?? null,
    package_id: input.packageId ?? null,
    internal: { memo: input.memo ?? '', tags: input.tags ?? [], audit_comment: '' },
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };

  // トランザクションの外でハッシュまで作り切る。
  const built = [];
  for (const platform of platforms) {
    const channelPostId = uuid();
    const payload = input.payloads?.[platform] ?? input.payloads?.default ?? {};
    const revision = makeRevision({
      channelPostId,
      revisionNo: 1,
      payload,
      assets: input.assets ?? [],
      rights: input.rights,
      createdAt: now,
      createdBy: ctx.actor.userId,
    });
    const socialAccountId = input.socialAccountIds?.[platform] ?? `${platform.toLowerCase()}-default`;
    const channelPost = {
      channel_post_id: channelPostId,
      post_group_id: postGroupId,
      brand_id: brandId,
      platform,
      social_account_id: socialAccountId,
      title: payload.title || projectTitle,
      display_state: 'DRAFT',
      current_revision_id: revision.revision_id,
      approval_id: null,
      scheduled_at: scheduledAt,
      time_zone: timeZone,
      published_at: null,
      calendar_date_key: dateKey(Date.parse(scheduledAt), timeZone),
      public_url: null,
      external_post_id: null,
      failure_kind: null,
      execution_id: null,
      has_assets: (input.assets ?? []).length > 0,
      rights_confirmed: input.rights?.confirmed === true,
      credential_expired: false,
      internal: { memo: '', tags: [], audit_comment: '' },
      created_at: now,
      updated_at: now,
      cancelled_at: null,
      deleted_at: null,
    };
    const basis = buildApprovalBasis({
      channelPost,
      revision,
      schedule: { scheduled_at: scheduledAt, time_zone: timeZone },
    });
    revision.approval_basis_hash = await approvalBasisHash(basis);
    built.push({ channelPost, revision, afterHash: await snapshotHash(channelPost) });
  }

  const assets = normalizeAssets(input.assets ?? []).map((a) => ({ ...a, post_group_id: postGroupId }));

  await ctx.repo.change(['postGroups', 'channelPosts', 'postRevisions', 'mediaAssets'], async (tx, audit) => {
    await tx.add('postGroups', group);
    for (const a of assets) await tx.put('mediaAssets', a);
    for (const { channelPost, revision, afterHash } of built) {
      await tx.add('postRevisions', revision);
      await tx.add('channelPosts', channelPost);
      await audit({
        actor: ctx.actor.userId,
        target_type: 'channelPost',
        target_id: channelPost.channel_post_id,
        action: 'post.create',
        before_hash: null,
        after_hash: afterHash,
        reason: `企画「${projectTitle}」を登録`,
        correlation_id: correlationId,
        revision_id: revision.revision_id,
      });
    }
  });

  return {
    postGroupId,
    channelPostIds: built.map((b) => b.channelPost.channel_post_id),
    correlationId,
  };
}

/**
 * 承認根拠に触れる編集。新しいRevisionを追加し、既存の承認を無効化する (§14)。
 * @returns {{revisionId:string, revisionNo:number, invalidatedApproval:boolean, changes:Array}}
 */
export async function reviseChannelPost(ctx, channelPostId, changes, { reason = '内容を修正' } = {}) {
  assertCan(ctx.actor.role, 'post.edit');

  const post = await ctx.repo.getPost(channelPostId);
  if (!post) throw new ValidationError('対象の投稿が見つかりません。');
  if (post.deleted_at) throw new InvariantError('DELETED', '削除済みの投稿は編集できません。');
  if (post.display_state === 'PUBLISHED') {
    throw new InvariantError('STATE_CONFLICT', '投稿済みの内容は編集できません。');
  }

  const revisions = await ctx.repo.listRevisions(channelPostId);
  const current = revisions.find((r) => r.revision_id === post.current_revision_id) ?? revisions.at(-1);
  const nextNo = (revisions.at(-1)?.revision_no ?? 0) + 1;
  const now = ctx.clock.nowIso();

  const scheduledAt = changes.scheduledAtIso ?? post.scheduled_at;
  const timeZone = changes.timeZone ?? post.time_zone;
  const socialAccountId = changes.socialAccountId ?? post.social_account_id;

  const revision = makeRevision({
    channelPostId,
    revisionNo: nextNo,
    payload: {
      body: changes.body ?? current.body,
      title: changes.title ?? current.title,
      hashtags: changes.hashtags ?? current.hashtags,
      cta: changes.cta ?? current.cta,
      visibility: changes.visibility ?? current.visibility,
    },
    assets: changes.assets ?? current.assets,
    rights: changes.rights ?? current.rights,
    createdAt: now,
    createdBy: ctx.actor.userId,
  });

  const beforeBasis = buildApprovalBasis({
    channelPost: post,
    revision: current,
    schedule: { scheduled_at: post.scheduled_at, time_zone: post.time_zone },
  });
  const afterChannelPost = { ...post, social_account_id: socialAccountId };
  const afterBasis = buildApprovalBasis({
    channelPost: afterChannelPost,
    revision,
    schedule: { scheduled_at: scheduledAt, time_zone: timeZone },
  });
  revision.approval_basis_hash = await approvalBasisHash(afterBasis);

  const diff = diffApprovalBasis(beforeBasis, afterBasis);

  const updated = {
    ...post,
    social_account_id: socialAccountId,
    title: revision.title || post.title,
    current_revision_id: revision.revision_id,
    scheduled_at: scheduledAt,
    time_zone: timeZone,
    calendar_date_key: dateKey(Date.parse(scheduledAt), timeZone),
    has_assets: revision.assets.length > 0,
    rights_confirmed: revision.rights.confirmed === true,
    updated_at: now,
  };

  // 承認根拠が変わったなら、承認を失わせて承認待ちへ戻す (§14 変更時の扱い)。
  const hadApproval = Boolean(post.approval_id);
  const invalidate = hadApproval && diff.invalidates;
  if (invalidate) {
    updated.approval_id = null;
    updated.approval_expires_at = null;
    if (post.display_state === 'SCHEDULED') updated.display_state = 'PENDING_APPROVAL';
  }

  const beforeHash = await snapshotHash(post);
  const afterHash = await snapshotHash(updated);
  const correlationId = uuid();

  await ctx.repo.change(['channelPosts', 'postRevisions', 'approvals'], async (tx, audit) => {
    const live = await tx.get('channelPosts', channelPostId);
    if (!live || live.updated_at !== post.updated_at) {
      throw new InvariantError('STALE_REVISION', 'ほかで更新されています。最新の内容を読み直してください。');
    }
    await tx.add('postRevisions', revision);
    if (invalidate) {
      const approval = await tx.get('approvals', post.approval_id);
      if (approval && !approval.revoked_at) {
        await tx.put('approvals', {
          ...approval,
          revoked_at: now,
          revoked_reason: `承認対象項目の変更: ${diff.changes.map((c) => c.label).join('・')}`,
        });
      }
    }
    if (invalidate && live.display_state === 'SCHEDULED') {
      assertTransition('SCHEDULED', 'PENDING_APPROVAL');
    }
    await tx.put('channelPosts', updated);
    await audit({
      actor: ctx.actor.userId,
      target_id: channelPostId,
      action: invalidate ? 'post.edit.invalidated_approval' : 'post.edit',
      before_hash: beforeHash,
      after_hash: afterHash,
      reason: invalidate
        ? `${reason}（${diff.changes.map((c) => c.label).join('・')}の変更により承認を無効化）`
        : reason,
      correlation_id: correlationId,
      revision_id: revision.revision_id,
    });
  });

  return {
    revisionId: revision.revision_id,
    revisionNo: nextNo,
    invalidatedApproval: invalidate,
    changes: diff.changes,
  };
}

/**
 * 社内メモ・内部タグ・担当者・監査コメントの編集 (§14「承認は維持」)。
 * 新しいRevisionを作らず、承認にも一切触れない。
 */
export async function updateInternal(ctx, channelPostId, internal, { reason = '内部情報を更新' } = {}) {
  assertCan(ctx.actor.role, 'post.edit.internal');

  const post = await ctx.repo.getPost(channelPostId);
  if (!post) throw new ValidationError('対象の投稿が見つかりません。');

  const updated = {
    ...post,
    internal: {
      memo: internal.memo ?? post.internal?.memo ?? '',
      tags: internal.tags ?? post.internal?.tags ?? [],
      audit_comment: internal.auditComment ?? post.internal?.audit_comment ?? '',
    },
    owner_user_id: internal.ownerUserId ?? post.owner_user_id ?? null,
    updated_at: ctx.clock.nowIso(),
  };

  const beforeHash = await snapshotHash(post);
  const afterHash = await snapshotHash(updated);

  await ctx.repo.change(['channelPosts'], async (tx, audit) => {
    await tx.put('channelPosts', updated);
    await audit({
      actor: ctx.actor.userId,
      target_id: channelPostId,
      action: 'post.edit.internal',
      before_hash: beforeHash,
      after_hash: afterHash,
      reason,
      revision_id: post.current_revision_id,
    });
  });

  // 承認IDも承認根拠ハッシュも触っていないことを呼び出し側が確認できるようにする。
  return { approvalId: post.approval_id, currentRevisionId: post.current_revision_id };
}
