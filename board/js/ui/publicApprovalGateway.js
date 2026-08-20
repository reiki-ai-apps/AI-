import { buildPublicApprovalPayload } from './publicApproval.js';

export const APPROVAL_GATEWAY_URL = 'https://reiki-board-approval-gateway.hinata246246.workers.dev';
const DEVICE_TOKEN_KEY = 'reiki_board_approval_device_token_v1';

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

async function pairDevice() {
  const code = window.prompt('この端末を承認用に登録します。\n発行された登録コードを入力してください。');
  if (!code) throw new Error('端末登録を中止しました。');
  const result = await request('/v1/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairing_code: code.trim() }),
  });
  localStorage.setItem(DEVICE_TOKEN_KEY, result.token);
  return result.token;
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

  let token = localStorage.getItem(DEVICE_TOKEN_KEY) || await pairDevice();
  try {
    return await request('/v1/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(gatewayPayload),
    });
  } catch (error) {
    if (error.status !== 401) throw error;
    localStorage.removeItem(DEVICE_TOKEN_KEY);
    token = await pairDevice();
    return request('/v1/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(gatewayPayload),
    });
  }
}
