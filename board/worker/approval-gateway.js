const ALLOWED_ORIGIN = 'https://reiki-ai-apps.github.io';
const APPROVAL_CONTRACT = 'REIKI_BOARD_GATEWAY_APPROVAL_V1';
const TOKEN_TTL_SECONDS = 31_536_000;
const RECORD_TTL_SECONDS = 10_368_000;
const INVITE_TTL_SECONDS = 604_800;
const MAX_INVITE_CLAIMS = 5;
const MAX_BODY_BYTES = 16_384;

function cors(origin) {
  if (origin !== ALLOWED_ORIGIN) return {};
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(value, status = 200, origin = '') {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...cors(origin),
    },
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
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    version: 1,
    device_id: crypto.randomUUID(),
    issued_at: now,
    expires_at: now + TOKEN_TTL_SECONDS,
  };
  const encoded = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${encoded}.${base64url(await hmac(secret, encoded))}`;
}

async function verifyDeviceToken(secret, token) {
  const [encoded, signature, extra] = String(token ?? '').split('.');
  if (!encoded || !signature || extra) return null;
  const received = decodeBase64url(signature);
  if (!await verifyHmac(secret, encoded, received)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64url(encoded)));
    if (payload.version !== 1 || !payload.device_id) return null;
    if (Number(payload.expires_at) <= Math.floor(Date.now() / 1000)) return null;
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
  if (!target || typeof target.channel_post_id !== 'string' || target.channel_post_id.length > 80) {
    throw new Error('INVALID_TARGET');
  }
  if (typeof target.revision_id !== 'string' || target.revision_id.length > 80) throw new Error('INVALID_REVISION');
  if (!isHexHash(target.approval_component_hash)) throw new Error('INVALID_HASH');
  const retryDelayMinutes = Number(target.allowed_retry_delay_minutes);
  if (!Number.isInteger(retryDelayMinutes) || retryDelayMinutes < 0 || retryDelayMinutes > 1440) {
    throw new Error('INVALID_RETRY_WINDOW');
  }
  return {
    contract: APPROVAL_CONTRACT,
    action: 'APPROVE_COMPONENT',
    component_scope: payload.component_scope,
    project_title: String(payload.project_title ?? '').slice(0, 240),
    target: {
      channel_post_id: target.channel_post_id,
      revision_id: target.revision_id,
      approval_component_hash: target.approval_component_hash,
      allowed_retry_delay_minutes: retryDelayMinutes,
    },
  };
}

async function claimInvite(request, env, origin) {
  if (origin !== ALLOWED_ORIGIN) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403, origin);
  const body = await readJson(request);
  const inviteToken = String(body?.invite_token ?? '');
  if (inviteToken.length < 32 || inviteToken.length > 160) return json({ error: 'INVITE_INVALID' }, 401, origin);
  const inviteKey = `invite:${base64url(await sha256(inviteToken))}`;
  const invitation = await env.APPROVALS.get(inviteKey, 'json');
  if (!invitation || invitation.purpose !== 'OWNER_DEVICE_PAIRING') {
    return json({ error: 'INVITE_INVALID' }, 401, origin);
  }
  if (Date.parse(invitation.expires_at) <= Date.now()) {
    await env.APPROVALS.delete(inviteKey);
    return json({ error: 'INVITE_EXPIRED' }, 401, origin);
  }
  const maxClaims = Number.isInteger(invitation.max_claims) ? invitation.max_claims : 1;
  const claimedCount = Number.isInteger(invitation.claimed_count) ? invitation.claimed_count : 0;
  if (claimedCount >= maxClaims) {
    await env.APPROVALS.delete(inviteKey);
    return json({ error: 'INVITE_DEVICE_LIMIT_REACHED' }, 401, origin);
  }
  const nextClaimedCount = claimedCount + 1;
  if (nextClaimedCount >= maxClaims) {
    await env.APPROVALS.delete(inviteKey);
  } else {
    const remainingTtl = Math.max(60, Math.ceil((Date.parse(invitation.expires_at) - Date.now()) / 1000));
    await env.APPROVALS.put(inviteKey, JSON.stringify({
      ...invitation,
      max_claims: maxClaims,
      claimed_count: nextClaimedCount,
    }), { expirationTtl: remainingTtl });
  }
  const token = await issueDeviceToken(env.TOKEN_SIGNING_SECRET);
  const pairedAt = new Date().toISOString();
  await env.APPROVALS.put(`pairing:${pairedAt}:${crypto.randomUUID()}`, JSON.stringify({
    paired_at: pairedAt,
    method: 'REUSABLE_OWNER_INVITE',
  }), { expirationTtl: RECORD_TTL_SECONDS });
  console.log(JSON.stringify({ event: 'owner_device_paired', at: pairedAt }));
  return json({
    token,
    expires_in: TOKEN_TTL_SECONDS,
    claims_remaining: Math.max(0, maxClaims - nextClaimedCount),
  }, 200, origin);
}

async function submitApproval(request, env, origin) {
  if (origin !== ALLOWED_ORIGIN) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403, origin);
  const bearer = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const device = await verifyDeviceToken(env.TOKEN_SIGNING_SECRET, bearer);
  if (!device) return json({ error: 'DEVICE_TOKEN_INVALID' }, 401, origin);
  const payload = validateApprovalPayload(await readJson(request));
  const idempotencyValue = [
    payload.target.channel_post_id,
    payload.target.revision_id,
    payload.component_scope,
    payload.target.approval_component_hash,
  ].join(':');
  const idempotencyKey = base64url(await sha256(idempotencyValue));
  const storageKey = `approval:${idempotencyKey}`;
  const existing = await env.APPROVALS.get(storageKey, 'json');
  if (existing?.delivery_status === 'DELIVERED') {
    return json({
      status: 'ACCEPTED',
      duplicate: true,
      request_id: existing.request_id,
      received_at: existing.received_at,
    }, 200, origin);
  }

  const requestId = existing?.request_id ?? crypto.randomUUID();
  const receivedAt = new Date().toISOString();
  const record = {
    ...payload,
    request_id: requestId,
    received_at: receivedAt,
    device_fingerprint: base64url(await sha256(device.device_id)).slice(0, 16),
    idempotency_key: idempotencyKey,
    delivery_status: 'PENDING',
  };
  await env.APPROVALS.put(storageKey, JSON.stringify(record), {
    expirationTtl: RECORD_TTL_SECONDS,
  });
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/dispatches`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'reiki-board-approval-gateway',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        event_type: 'reiki_board_approval',
        client_payload: { approval: record },
      }),
    },
  );
  if (response.status !== 204) {
    await env.APPROVALS.put(storageKey, JSON.stringify({ ...record, delivery_status: 'FAILED' }), {
      expirationTtl: RECORD_TTL_SECONDS,
    });
    console.log(JSON.stringify({ event: 'approval_dispatch_failed', request_id: requestId, status: response.status }));
    return json({ error: 'APPROVAL_DELIVERY_FAILED' }, 502, origin);
  }
  await env.APPROVALS.put(storageKey, JSON.stringify({ ...record, delivery_status: 'DELIVERED' }), {
    expirationTtl: RECORD_TTL_SECONDS,
  });
  console.log(JSON.stringify({ event: 'approval_received', request_id: requestId, scope: payload.component_scope }));
  return json({ status: 'ACCEPTED', request_id: requestId, received_at: receivedAt }, 202, origin);
}

async function issuePairingInvite(env, createdBy = 'ADMIN') {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const inviteToken = base64url(bytes);
  const expiresAt = new Date(Date.now() + INVITE_TTL_SECONDS * 1000).toISOString();
  const inviteKey = `invite:${base64url(await sha256(inviteToken))}`;
  await env.APPROVALS.put(inviteKey, JSON.stringify({
    purpose: 'OWNER_DEVICE_PAIRING',
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
    max_claims: MAX_INVITE_CLAIMS,
    claimed_count: 0,
    created_by: createdBy,
  }), { expirationTtl: INVITE_TTL_SECONDS });
  return { invite_token: inviteToken, expires_at: expiresAt, max_claims: MAX_INVITE_CLAIMS };
}

async function createAdminInvite(request, env) {
  const bearer = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer || !await constantTimeTextEqual(bearer, env.ADMIN_INVITE_SECRET)) {
    return json({ error: 'ADMIN_TOKEN_INVALID' }, 401);
  }
  return json(await issuePairingInvite(env, 'ADMIN'), 201);
}

async function createDeviceInvite(request, env, origin) {
  if (origin !== ALLOWED_ORIGIN) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403, origin);
  const bearer = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const device = await verifyDeviceToken(env.TOKEN_SIGNING_SECRET, bearer);
  if (!device) return json({ error: 'DEVICE_TOKEN_INVALID' }, 401, origin);
  const fingerprint = base64url(await sha256(device.device_id)).slice(0, 16);
  return json(await issuePairingInvite(env, `DEVICE:${fingerprint}`), 201, origin);
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
      return origin === ALLOWED_ORIGIN
        ? new Response(null, { status: 204, headers: cors(origin) })
        : new Response(null, { status: 403 });
    }
    try {
      if (request.method === 'GET' && url.pathname === '/health') return json({ status: 'ok' }, 200, origin);
      if (request.method === 'POST' && url.pathname === '/v1/claim') return await claimInvite(request, env, origin);
      if (request.method === 'POST' && url.pathname === '/v1/approve') return await submitApproval(request, env, origin);
      if (request.method === 'POST' && url.pathname === '/v1/device/invite') return await createDeviceInvite(request, env, origin);
      if (request.method === 'POST' && url.pathname === '/v1/admin/invite') return await createAdminInvite(request, env);
      if (request.method === 'GET' && url.pathname === '/v1/approvals') return await listApprovals(request, env);
      return json({ error: 'NOT_FOUND' }, 404, origin);
    } catch (error) {
      const status = error?.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
      console.log(JSON.stringify({ event: 'request_rejected', error: error?.message ?? 'INVALID_REQUEST' }));
      return json({ error: error?.message ?? 'INVALID_REQUEST' }, status, origin);
    }
  },
};
