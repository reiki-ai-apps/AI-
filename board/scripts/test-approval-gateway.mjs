import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../worker/approval-gateway.js';

class KvMock {
  constructor() { this.values = new Map(); }
  async put(key, value) { this.values.set(key, value); }
  async get(key, type) {
    const value = this.values.get(key);
    return type === 'json' && value ? JSON.parse(value) : value ?? null;
  }
  async delete(key) { this.values.delete(key); }
  async list(options = {}) {
    const prefix = options.prefix ?? '';
    return {
      keys: [...this.values.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
    };
  }
}

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

async function addInvite(kv, inviteToken) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(inviteToken));
  await kv.put(`invite:${base64url(new Uint8Array(digest))}`, JSON.stringify({
    purpose: 'OWNER_DEVICE_PAIRING',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }));
}

test('一度だけの招待リンクで端末登録し、Revision/Hash承認を送れる', async () => {
  const env = {
    APPROVALS: new KvMock(), TOKEN_SIGNING_SECRET: 'sign-secret', QUEUE_READ_SECRET: 'queue-secret',
    GITHUB_OWNER: 'reiki-ai-apps', GITHUB_REPO: 'AI-', GITHUB_DISPATCH_TOKEN: 'test-token',
  };
  const origin = 'https://reiki-ai-apps.github.io';
  const inviteToken = 'A'.repeat(48);
  await addInvite(env.APPROVALS, inviteToken);
  const pair = await worker.fetch(new Request('https://example.test/v1/claim', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ invite_token: inviteToken }),
  }), env);
  assert.equal(pair.status, 200);
  const { token } = await pair.json();
  assert.ok(token);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 204 });
  const approval = await worker.fetch(new Request('https://example.test/v1/approve', {
      method: 'POST',
      headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contract: 'REIKI_BOARD_GATEWAY_APPROVAL_V1', action: 'APPROVE_COMPONENT', component_scope: 'CONTENT',
        project_title: 'テスト', target: {
          channel_post_id: 'post-1', revision_id: 'revision-1', approval_component_hash: 'a'.repeat(64),
          allowed_retry_delay_minutes: 30,
        },
      }),
    }), env);
  globalThis.fetch = originalFetch;
  assert.equal(approval.status, 202);
  const queue = await worker.fetch(new Request('https://example.test/v1/approvals', {
    headers: { Authorization: 'Bearer queue-secret' },
  }), env);
  const body = await queue.json();
  assert.equal(body.approvals.length, 1);
  assert.equal(body.approvals[0].component_scope, 'CONTENT');
});

test('許可していないWebサイトからの端末登録を拒否する', async () => {
  const env = { APPROVALS: new KvMock(), TOKEN_SIGNING_SECRET: 'sign-secret', QUEUE_READ_SECRET: 'queue-secret' };
  const response = await worker.fetch(new Request('https://example.test/v1/claim', {
    method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ invite_token: 'A'.repeat(48) }),
  }), env);
  assert.equal(response.status, 403);
});

test('秘密鍵なしでは承認キューを読めない', async () => {
  const env = { APPROVALS: new KvMock(), PAIRING_SECRET: 'pair-secret', TOKEN_SIGNING_SECRET: 'sign-secret', QUEUE_READ_SECRET: 'queue-secret' };
  const response = await worker.fetch(new Request('https://example.test/v1/approvals'), env);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'QUEUE_TOKEN_INVALID');
});
