// GitHub Pages版の承認導線。
//
// 初回だけ一度限りの専用リンクで端末を登録し、以後はCloudflare Workerへ
// Revision/Hash固定の承認証跡を送る。GitHubログインや認証コードは不要。

import { domainDigest } from '../core/digest.js';
import { DEFAULT_RETRY_DELAY_MINUTES } from '../services/approvals.js';

export const PUBLIC_APPROVAL_GATEWAY = 'https://reiki-board-approval-gateway.hinata246246.workers.dev';
export const PUBLIC_APPROVAL_CONTRACT = 'REIKI_BOARD_GATEWAY_APPROVAL_V1';
export const PUBLIC_APPROVAL_COMPONENT_DOMAIN = 'REIKI-APPROVAL-COMPONENT-V1';

const DEVICE_TOKEN_KEY = 'reiki_board_approval_device_v1';
const LOCAL_RECEIPT_PREFIX = 'reiki_board_approval_sent_v1:';

/**
 * 承認待ちは予定時刻を過ぎても画面から消さない。
 * 実投稿時刻の繰り下げと重複確認は外部実行側で行う。
 */
export function isPublicApprovalActionable(post, nowMs = Date.now()) {
  const scheduledMs = Date.parse(post?.scheduled_at ?? '');
  if (!Number.isFinite(scheduledMs)) return false;
  return Boolean(post && !post.deleted_at && !post.cancelled_at);
}

function imageAsset(asset) {
  return String(asset?.mime ?? '').startsWith('image/');
}

function normalizeAsset(asset) {
  return {
    asset_id: asset.asset_id,
    sha256: asset.sha256,
    order: asset.order,
    alt_text: asset.alt_text ?? '',
    file_name: asset.file_name ?? '',
  };
}

function componentProjection({ post, revision, scope }) {
  const assets = [...(revision.assets ?? [])]
    .filter((asset) => scope === 'THUMBNAIL' ? imageAsset(asset) : !imageAsset(asset))
    .map(normalizeAsset)
    .sort((left, right) => left.order - right.order);
  const common = {
    component_scope: scope,
    channel_post_id: post.channel_post_id,
    revision_id: revision.revision_id,
    platform: post.platform,
    social_account_id: post.social_account_id,
    scheduled_at: post.scheduled_at,
    time_zone: post.time_zone,
    assets,
  };
  if (scope === 'THUMBNAIL') return common;
  return {
    ...common,
    title: revision.title ?? '',
    body: revision.body ?? '',
    hashtags: [...(revision.hashtags ?? [])],
    cta: revision.cta ?? '',
    visibility: revision.visibility ?? 'PUBLIC',
    rights: revision.rights ?? null,
  };
}

export async function buildPublicComponentApproval({ group, post, revision, scope }) {
  const projection = componentProjection({ post, revision, scope });
  return {
    contract: PUBLIC_APPROVAL_CONTRACT,
    action: 'APPROVE_COMPONENT',
    component_scope: scope,
    project_title: String(group?.project_title ?? '（企画名なし）').slice(0, 240),
    target: {
      channel_post_id: post.channel_post_id,
      revision_id: revision.revision_id,
      approval_component_hash: await domainDigest(PUBLIC_APPROVAL_COMPONENT_DOMAIN, projection),
      allowed_retry_delay_minutes: DEFAULT_RETRY_DELAY_MINUTES,
    },
  };
}

function receiptKey(payload) {
  return `${LOCAL_RECEIPT_PREFIX}${payload.target.channel_post_id}:${payload.target.revision_id}:${payload.component_scope}`;
}

export function publicApprovalDeviceReady() {
  return Boolean(localStorage.getItem(DEVICE_TOKEN_KEY));
}

export function localApprovalSent(payload) {
  return Boolean(localStorage.getItem(receiptKey(payload)));
}

export async function claimPublicApprovalDeviceFromLocation(url = new URL(location.href)) {
  const queryToken = url.searchParams.get('pair');
  const hashMatch = String(url.hash).match(/^#pair:([A-Za-z0-9_-]{32,160})$/);
  const inviteToken = queryToken ?? hashMatch?.[1] ?? null;
  if (!inviteToken || !/^[A-Za-z0-9_-]{32,160}$/.test(inviteToken)) return { claimed: false };
  const response = await fetch(`${PUBLIC_APPROVAL_GATEWAY}/v1/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invite_token: inviteToken }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.token) {
    throw new Error(result.error === 'INVITE_INVALID_OR_USED'
      ? 'この初回設定リンクは使用済みです。新しいリンクを発行してください。'
      : 'この端末を承認用として登録できませんでした。');
  }
  localStorage.setItem(DEVICE_TOKEN_KEY, result.token);
  const clean = new URL(location.href);
  clean.searchParams.delete('pair');
  clean.hash = '#approvals';
  history.replaceState(null, '', `${clean.pathname}${clean.search}${clean.hash}`);
  return { claimed: true };
}

export async function submitPublicComponentApproval(payload) {
  const token = localStorage.getItem(DEVICE_TOKEN_KEY);
  if (!token) throw new Error('この端末はまだ承認用に登録されていません。初回設定リンクを開いてください。');
  const response = await fetch(`${PUBLIC_APPROVAL_GATEWAY}/v1/approve`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) localStorage.removeItem(DEVICE_TOKEN_KEY);
    throw new Error(response.status === 401
      ? '承認用の端末登録が切れました。新しい初回設定リンクを開いてください。'
      : '承認証跡を保存できませんでした。もう一度押してください。');
  }
  localStorage.setItem(receiptKey(payload), JSON.stringify(result));
  return result;
}
