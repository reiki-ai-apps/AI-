const ALLOWED_ORIGIN = 'https://reiki-ai-apps.github.io';
const APPROVAL_CONTRACT = 'REIKI_BOARD_GATEWAY_APPROVAL_V1';
const TOKEN_TTL_SECONDS = 31_536_000;
const RECORD_TTL_SECONDS = 10_368_000;
const MAX_BODY_BYTES = 16_384;

function cors(origin) {
  return origin === ALLOWED_ORIGIN ? {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  } : {};
}

function json(value, status = 200, origin = '') {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(origin) },
  });
}

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

async function verifyHmac(secret, value, signature) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(value));
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function constantTimeTextEqual(left, right) {
  const comparisonValue = 'REIKI_BOARD_CONSTANT_TIME_SECRET_CHECK_V1';
  const candidateSignature = await hmac(String(left), comparisonValue);
  return verifyHmac(String(right), comparisonValue, candidateSignature);
}

async function issueDeviceToken(secret) {
  const payload = {
    version: 1,
    device_id: crypto.randomUUID(),
    issued_at: Math.floor(Date.now() / 1000),
    expires_at: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const encoded = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${encoded}.${base64url(await hmac(secret, encoded))}`;
}

async function verifyDeviceToken(secret, token) {
  const [encoded, signature, extra] = String(token ?? '').split('.');
  if (!encoded || !signature || extra) return null;
  const expected = await hmac(secret, encoded);
  const received = decodeBase64url(signature);
  if (received.length !== expected.length || !await verifyHmac(secret, encoded, received)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64url(encoded)));
    if (payload.version !== 1 || !payload.device_id || Number(payload.expires_at) <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function readJson(request) {
  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (length > MAX_BODY_BYTES) throw new Error('PAYLOAD_TOO_LARGE');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error('PAYLOAD_TOO_LARGE');
  return JSON.parse(text);
}

function isHexHash(value) {
  return /^[a-f0-9]{64}$/.test(String(value ?? ''));
}

function validateApprovalPayload(payload) {
  if (payload?.contract !== APPROVAL_CONTRACT || payload?.action !== 'APPROVE_COMPONENT') {
    throw new Error('INVALID_CONTRACT');
  }
  if (!['CONTENT', 'THUMBNAIL'].includes(payload.component_scope)) throw new Error('INVALID_COMPONENT');
  const target = payload.target;
  if (!target || typeof target.channel_post_id !== 'string' || target.channel_post_id.length > 80) throw new Error('INVALID_TARGET');
  if (typeof target.revision_id !== 'string' || target.revision_id.length > 80) throw new Error('INVALID_REVISION');
  if (!isHexHash(target.approval_component_hash)) throw new Error('INVALID_HASH');
  if (target.allowed_retry_delay_minutes !== 30) throw new Error('INVALID_RETRY_WINDOW');
  return {
    contract: APPROVAL_CONTRACT,
    action: 'APPROVE_COMPONENT',
    component_scope: payload.component_scope,
    project_title: String(payload.project_title ?? '').slice(0, 240),
    target: {
      channel_post_id: target.channel_post_id,
      revision_id: target.revision_id,
      approval_component_hash: target.approval_component_hash,
      allowed_retry_delay_minutes: 30,
    },
  };
}

async function pair(request, env, origin) {
  if (origin !== ALLOWED_ORIGIN) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403, origin);
  const body = await readJson(request);
  if (!await constantTimeTextEqual(body?.pairing_code, env.PAIRING_SECRET)) {
    return json({ error: 'PAIRING_CODE_INVALID' }, 401, origin);
  }
  return json({ token: await issueDeviceToken(env.TOKEN_SIGNING_SECRET), expires_in: TOKEN_TTL_SECONDS }, 200, origin);
}

async function submitApproval(request, env, origin) {
  if (origin !== ALLOWED_ORIGIN) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403, origin);
  const bearer = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const device = await verifyDeviceToken(env.TOKEN_SIGNING_SECRET, bearer);
  if (!device) return json({ error: 'DEVICE_TOKEN_INVALID' }, 401, origin);
  const payload = validateApprovalPayload(await readJson(request));
  const requestId = crypto.randomUUID();
  const receivedAt = new Date().toISOString();
  const record = {
    ...payload,
    request_id: requestId,
    received_at: receivedAt,
    device_fingerprint: base64url(await sha256(device.device_id)).slice(0, 16),
  };
  await env.APPROVALS.put(`approval:${receivedAt}:${requestId}`, JSON.stringify(record), {
    expirationTtl: RECORD_TTL_SECONDS,
  });
  return json({ status: 'ACCEPTED', request_id: requestId, received_at: receivedAt }, 202, origin);
}

async function listApprovals(request, env) {
  const bearer = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer || !await constantTimeTextEqual(bearer, env.QUEUE_READ_SECRET)) {
    return json({ error: 'QUEUE_TOKEN_INVALID' }, 401);
  }
  const records = [];
  let cursor;
  do {
    const page = await env.APPROVALS.list({ prefix: 'approval:', limit: 100, cursor });
    for (const key of page.keys) {
      const value = await env.APPROVALS.get(key.name, 'json');
      if (value) records.push(value);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && records.length < 500);
  records.sort((left, right) => String(left.received_at).localeCompare(String(right.received_at)));
  return json({ contract: 'REIKI_BOARD_GATEWAY_QUEUE_V1', approvals: records.slice(-500) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') ?? '';
    if (request.method === 'OPTIONS') {
      return origin === ALLOWED_ORIGIN ? new Response(null, { status: 204, headers: cors(origin) }) : new Response(null, { status: 403 });
    }
    try {
      if (request.method === 'GET' && url.pathname === '/health') return json({ status: 'ok' }, 200, origin);
      if (request.method === 'POST' && url.pathname === '/v1/pair') return await pair(request, env, origin);
      if (request.method === 'POST' && url.pathname === '/v1/approve') return await submitApproval(request, env, origin);
      if (request.method === 'GET' && url.pathname === '/v1/approvals') return await listApprovals(request, env);
      return json({ error: 'NOT_FOUND' }, 404, origin);
    } catch (error) {
      const status = error?.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
      return json({ error: error?.message ?? 'INVALID_REQUEST' }, status, origin);
    }
  },
};
