import { buildPublicApprovalPayload } from './publicApproval.js';

export const APPROVAL_GATEWAY_URL = 'https://reiki-board-approval-gateway.hinata246246.workers.dev';
const DEVICE_TOKEN_KEYS = [
  'reiki_board_approval_device_v1',
  'reiki_board_approval_device_token_v1',
];

async function request(path, options = {}) {
  const response = await fetch(`${APPROVAL_GATEWAY_URL}${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `HTTP_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function storedDeviceToken() {
  for (const key of DEVICE_TOKEN_KEYS) {
    const token = localStorage.getItem(key);
    if (token) return token;
  }
  return null;
}

function saveDeviceToken(token) {
  for (const key of DEVICE_TOKEN_KEYS) localStorage.setItem(key, token);
}

function clearDeviceToken() {
  for (const key of DEVICE_TOKEN_KEYS) localStorage.removeItem(key);
}

export function approvalDeviceReady() {
  return Boolean(storedDeviceToken());
}

export async function claimApprovalDeviceFromHash(hash = location.hash) {
  const match = String(hash).match(/^#pair:([A-Za-z0-9_-]{32,160})$/);
  if (!match) return { claimed: false };
  const result = await request('/v1/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invite_token: match[1] }),
  });
  if (!result.token) throw new Error('この端末を承認用として登録できませんでした。');
  saveDeviceToken(result.token);
  history.replaceState(null, '', `${location.pathname}${location.search}#approvals`);
  return { claimed: true };
}

export async function submitGatewayComponentApproval({ group, post, revision, componentScope }) {
  const payload = await buildPublicApprovalPayload({
    group,
    posts: [post],
    revisions: new Map([[revision.revision_id, revision]]),
    componentScope,
  });
  const gatewayPayload = {
    contract: 'REIKI_BOARD_GATEWAY_APPROVAL_V1',
    action: 'APPROVE_COMPONENT',
    component_scope: componentScope,
    project_title: payload.project_title,
    target: payload.targets[0],
  };

  const token = storedDeviceToken();
  if (!token) {
    throw new Error('この端末はまだ承認用に登録されていません。初回設定リンクを一度開いてください。');
  }
  try {
    return await request('/v1/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(gatewayPayload),
    });
  } catch (error) {
    if (error.status !== 401) throw error;
    clearDeviceToken();
    throw new Error('承認用の端末登録が切れました。新しい初回設定リンクを一度開いてください。');
  }
}
