import test from 'node:test';
import assert from 'node:assert/strict';

test('one-time link registers the browser without asking for a code', async () => {
  const values = new Map();
  const inviteToken = 'A'.repeat(48);
  let replacedUrl = '';
  let requestBody = null;

  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  globalThis.location = new URL(`https://reiki-ai-apps.github.io/AI-/board/?public=1&pair=${inviteToken}#approvals`);
  globalThis.history = {
    replaceState: (_state, _title, url) => { replacedUrl = url; },
  };
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /\/v1\/claim$/);
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ token: 'signed-device-token' }),
    };
  };

  const moduleUrl = new URL('../js/ui/publicApprovalGateway.js', import.meta.url);
  const approvalGateway = await import(`${moduleUrl.href}?test=${Date.now()}`);
  const result = await approvalGateway.claimApprovalDeviceFromLocation();

  assert.deepEqual(result, { claimed: true });
  assert.equal(requestBody.invite_token, inviteToken);
  assert.equal(values.get('reiki_board_approval_device_v1'), 'signed-device-token');
  assert.equal(values.get('reiki_board_approval_device_token_v1'), 'signed-device-token');
  assert.equal(replacedUrl, '/AI-/board/?public=1#approvals');
  assert.equal(approvalGateway.approvalDeviceReady(), true);
});
