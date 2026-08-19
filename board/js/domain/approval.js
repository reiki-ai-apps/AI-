// §14 承認の完全性
//
// 承認は投稿IDではなく「その版・その日時・その投稿先」へ固定する。
// approval_basis_hash に入る項目だけが承認の対象であり、
// それが1文字でも変われば承認は即時無効化される。
//
// 逆に、社内メモ・内部タグ・担当者・監査コメントは basis に構造的に入らないため、
// いくら書き換えても承認は維持される (G07)。

import { canonicalize } from '../core/jcs.js';
import { domainDigest } from '../core/digest.js';

export const APPROVAL_BASIS_DOMAIN = 'REIKI-APPROVAL-BASIS-V1';
export const APPROVAL_COMPONENT_DOMAIN = 'REIKI-APPROVAL-COMPONENT-V1';
export const APPROVAL_COMPONENTS = Object.freeze(['CONTENT', 'THUMBNAIL']);

/**
 * 承認根拠に含まれる項目と、その日本語名。
 * §14「approval_basis_hashに含めるもの」の全項目がここに対応する。
 */
export const BASIS_FIELDS = Object.freeze({
  body: '本文',
  title: 'タイトル',
  hashtags: 'ハッシュタグ',
  cta: 'CTA',
  visibility: '公開範囲',
  article_url: '記事・動画リンク',
  assets: '素材',
  platform: '投稿先SNS',
  social_account_id: '投稿先アカウント',
  scheduled_at: '公開予定日時',
  time_zone: 'タイムゾーン',
  rights: '権利・出典確認',
  allowed_retry_delay_minutes: '許可した遅延再試行時間',
});

/**
 * 承認根拠に「入らない」項目と日本語名。
 * これらの変更では承認を維持する (§14 変更時の扱い)。
 */
export const NON_BASIS_FIELDS = Object.freeze({
  memo: '社内メモ',
  tags: '内部タグ',
  owner_user_id: '担当者',
  audit_comment: '監査コメント',
});

function normalizeAsset(asset) {
  // 素材Hash・順番・切り抜き・サムネイル・字幕・代替テキストが承認対象 (§14)。
  return {
    asset_id: asset.asset_id,
    sha256: asset.sha256,
    order: asset.order,
    crop: asset.crop ?? null,
    thumbnail_sha256: asset.thumbnail_sha256 ?? null,
    subtitle_sha256: asset.subtitle_sha256 ?? null,
    alt_text: asset.alt_text ?? '',
    asset_role: asset.asset_role ?? 'ATTACHMENT',
  };
}

function isThumbnailAsset(asset) {
  return String(asset?.asset_role ?? '').toUpperCase() === 'THUMBNAIL';
}

function normalizeRights(rights) {
  const sources = [...(rights?.sources ?? [])]
    .map((s) => ({
      claim_id: s.claim_id,
      source_url: s.source_url,
      verified_at: s.verified_at ?? null,
      epistemic_status: s.epistemic_status ?? null,
    }))
    .sort((a, b) => (a.claim_id < b.claim_id ? -1 : a.claim_id > b.claim_id ? 1 : 0));
  return {
    confirmed: rights?.confirmed === true,
    rights_status: rights?.rights_status ?? 'UNKNOWN',
    sources,
  };
}

/**
 * 承認根拠オブジェクトを組み立てる。
 * ここに現れないフィールドは、どれだけ変更されても承認へ影響しない。
 *
 * @param {object} input
 * @param {object} input.channelPost {platform, social_account_id}
 * @param {object} input.revision PostRevision
 * @param {object} input.schedule {scheduled_at (ISO UTC), time_zone (IANA)}
 * @param {number} [input.allowedRetryDelayMinutes] 承認時に許可した遅延再試行時間
 */
export function buildApprovalBasis({ channelPost, revision, schedule, allowedRetryDelayMinutes = 0 }) {
  return {
    body: revision.body ?? '',
    title: revision.title ?? '',
    hashtags: [...(revision.hashtags ?? [])],
    cta: revision.cta ?? '',
    visibility: revision.visibility ?? 'PUBLIC',
    article_url: revision.article_url ?? null,
    assets: [...(revision.assets ?? [])]
      .map(normalizeAsset)
      .sort((a, b) => a.order - b.order),
    platform: channelPost.platform,
    social_account_id: channelPost.social_account_id,
    scheduled_at: schedule.scheduled_at,
    time_zone: schedule.time_zone,
    rights: normalizeRights(revision.rights),
    allowed_retry_delay_minutes: allowedRetryDelayMinutes,
  };
}

/** approval_basis_hash を計算する。 */
export function approvalBasisHash(basis) {
  return domainDigest(APPROVAL_BASIS_DOMAIN, basis);
}

/** 引数から直接ハッシュを求める便利版。 */
export function computeApprovalBasisHash(input) {
  return approvalBasisHash(buildApprovalBasis(input));
}

/**
 * 本文・動画とサムネイルを独立して承認するための根拠。
 * CONTENTには本文とサムネイル以外の素材、THUMBNAILには採用サムネイルだけを含める。
 */
export function buildApprovalComponentBasis({
  channelPost,
  revision,
  schedule,
  componentScope,
  allowedRetryDelayMinutes = 0,
}) {
  if (!APPROVAL_COMPONENTS.includes(componentScope)) {
    throw new RangeError(`未知の承認区分です: ${componentScope}`);
  }
  const assets = [...(revision.assets ?? [])]
    .filter((asset) => componentScope === 'THUMBNAIL' ? isThumbnailAsset(asset) : !isThumbnailAsset(asset))
    .map(normalizeAsset)
    .sort((a, b) => a.order - b.order);
  const shared = {
    component_scope: componentScope,
    revision_id: revision.revision_id,
    platform: channelPost.platform,
    social_account_id: channelPost.social_account_id,
    scheduled_at: schedule.scheduled_at,
    time_zone: schedule.time_zone,
    allowed_retry_delay_minutes: allowedRetryDelayMinutes,
  };
  if (componentScope === 'THUMBNAIL') return { ...shared, assets };
  return {
    ...shared,
    body: revision.body ?? '',
    title: revision.title ?? '',
    hashtags: [...(revision.hashtags ?? [])],
    cta: revision.cta ?? '',
    visibility: revision.visibility ?? 'PUBLIC',
    article_url: revision.article_url ?? null,
    assets,
    rights: normalizeRights(revision.rights),
  };
}

export function approvalComponentHash(basis) {
  return domainDigest(APPROVAL_COMPONENT_DOMAIN, basis);
}

export function computeApprovalComponentHash(input) {
  return approvalComponentHash(buildApprovalComponentBasis(input));
}

function sameValue(a, b) {
  return canonicalize(a ?? null) === canonicalize(b ?? null);
}

/**
 * 2つの承認根拠を比べ、承認を無効化すべきかと、何が変わったかを返す。
 * 承認待ち画面はこの結果をそのまま日本語で表示する (§08「変更差分」)。
 *
 * @returns {{ invalidates: boolean, changes: Array<{field:string,label:string}> }}
 */
export function diffApprovalBasis(before, after) {
  const changes = [];
  for (const [field, label] of Object.entries(BASIS_FIELDS)) {
    if (!sameValue(before?.[field], after?.[field])) {
      changes.push({ field, label });
    }
  }
  return { invalidates: changes.length > 0, changes };
}

/** 「本文・素材が変更されました」のような一文にする。 */
export function describeChanges(changes) {
  if (!changes.length) return '承認対象の項目に変更はありません。';
  return `${changes.map((c) => c.label).join('・')}が変更されました。再承認が必要です。`;
}

/**
 * 承認がいまも有効か。
 * 画面制御だけに頼らず、実行の直前にも必ずこれを通す (§14 二重検査)。
 *
 * @param {object} approval {approval_basis_hash, revision_id, decision, revoked_at, expires_at}
 * @param {object} current {approvalBasisHash, revisionId}
 * @param {number} nowMs
 */
export function checkApprovalValid(approval, current, nowMs) {
  if (!approval) {
    return { valid: false, reason: 'NO_APPROVAL', message: '有効な承認がありません。' };
  }
  if (approval.decision !== 'APPROVED') {
    return { valid: false, reason: 'NOT_APPROVED', message: '承認されていません。' };
  }
  if (approval.revoked_at) {
    return { valid: false, reason: 'REVOKED', message: '承認は無効化されています。再承認が必要です。' };
  }
  if (approval.revision_id !== current.revisionId) {
    return { valid: false, reason: 'STALE_REVISION', message: '承認した版とは別の版です。再承認が必要です。' };
  }
  if (approval.approval_basis_hash !== current.approvalBasisHash) {
    return { valid: false, reason: 'BASIS_MISMATCH', message: '承認後に公開内容が変更されています。再承認が必要です。' };
  }
  if (approval.expires_at && Date.parse(approval.expires_at) <= nowMs) {
    return { valid: false, reason: 'EXPIRED', message: '承認の有効期限が切れています。再承認が必要です。' };
  }
  return { valid: true, reason: 'VALID', message: '有効な承認があります。' };
}

/** 単独運用でも記録は省かない (§17 責任ルール)。 */
export function isSelfApproval(approval, authorUserId) {
  return Boolean(approval && authorUserId && approval.approver_user_id === authorUserId);
}
