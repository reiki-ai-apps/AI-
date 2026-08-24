import { buildPublicApprovalPayload } from './publicApproval.js';

export const APPROVAL_GATEWAY_URL = 'https://reiki-board-approval-gateway.hinata246246.workers.dev';
const DEVICE_TOKEN_KEYS = [
  'reiki_board_approval_device_v1',
  'reiki_board_approval_device_token_v1',
];
const DEVICE_DB_NAME = 'reiki_board_device_v1';
const DEVICE_STORE_NAME = 'credentials';
const DEVICE_RECORD_KEY = 'approval_device_token';

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

function storageValue(storage, key) {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}

function deviceDatabase() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = globalThis.indexedDB.open(DEVICE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DEVICE_STORE_NAME)) {
        request.result.createObjectStore(DEVICE_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function indexedDeviceToken() {
  const db = await deviceDatabase();
  if (!db) return null;
  return new Promise((resolve) => {
    const request = db.transaction(DEVICE_STORE_NAME, 'readonly').objectStore(DEVICE_STORE_NAME).get(DEVICE_RECORD_KEY);
    request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
    request.onerror = () => resolve(null);
  }).finally(() => db.close());
}

async function writeIndexedDeviceToken(token) {
  const db = await deviceDatabase();
  if (!db) return;
  await new Promise((resolve) => {
    const transaction = db.transaction(DEVICE_STORE_NAME, 'readwrite');
    transaction.objectStore(DEVICE_STORE_NAME).put(token, DEVICE_RECORD_KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = resolve;
    transaction.onabort = resolve;
  });
  db.close();
}

async function clearIndexedDeviceToken() {
  const db = await deviceDatabase();
  if (!db) return;
  await new Promise((resolve) => {
    const transaction = db.transaction(DEVICE_STORE_NAME, 'readwrite');
    transaction.objectStore(DEVICE_STORE_NAME).delete(DEVICE_RECORD_KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = resolve;
    transaction.onabort = resolve;
  });
  db.close();
}

export function storedDeviceToken() {
  for (const key of DEVICE_TOKEN_KEYS) {
    const token = storageValue(globalThis.localStorage, key);
    if (token) return token;
  }
  return null;
}

async function saveDeviceToken(token) {
  for (const key of DEVICE_TOKEN_KEYS) {
    try { globalThis.localStorage?.setItem(key, token); } catch {}
  }
  await writeIndexedDeviceToken(token);
}

async function clearDeviceToken() {
  for (const key of DEVICE_TOKEN_KEYS) {
    try { globalThis.localStorage?.removeItem(key); } catch {}
  }
  await clearIndexedDeviceToken();
}

export async function restoreApprovalDeviceToken() {
  const localToken = storedDeviceToken();
  if (localToken) {
    await writeIndexedDeviceToken(localToken);
    return localToken;
  }
  const indexedToken = await indexedDeviceToken();
  if (indexedToken) await saveDeviceToken(indexedToken);
  return indexedToken;
}

export function approvalDeviceReady() {
  return Boolean(storedDeviceToken());
}

export async function claimApprovalDeviceFromLocation(url = new URL(location.href)) {
  const queryToken = url.searchParams.get('pair');
  const hashMatch = String(url.hash).match(/^#pair:([A-Za-z0-9_-]{32,160})$/);
  const inviteToken = queryToken ?? hashMatch?.[1] ?? null;
  if (!inviteToken || !/^[A-Za-z0-9_-]{32,160}$/.test(inviteToken)) return { claimed: false };
  const result = await request('/v1/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invite_token: inviteToken }),
  });
  if (!result.token) throw new Error('この端末を承認用として登録できませんでした。');
  await saveDeviceToken(result.token);
  const clean = new URL(location.href);
  clean.searchParams.delete('pair');
  clean.hash = '#approvals';
  history.replaceState(null, '', `${clean.pathname}${clean.search}${clean.hash}`);
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

  const token = await restoreApprovalDeviceToken();
  if (!token) {
    throw new Error('このブラウザに承認鍵がありません。前回と同じブラウザで開くか、新しい端末登録リンクを一度開いてください。');
  }
  try {
    return await request('/v1/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(gatewayPayload),
    });
  } catch (error) {
    if (error.status !== 401) throw error;
    await clearDeviceToken();
    throw new Error('承認用の端末登録が切れました。新しい初回設定リンクを一度開いてください。');
  }
}
