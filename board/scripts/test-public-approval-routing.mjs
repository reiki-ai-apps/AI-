import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('public approval always stays on the Board and uses the gateway', async () => {
  const source = await readFile(new URL('../js/ui/approvalsView.js', import.meta.url), 'utf8');
  assert.match(source, /submitGatewayComponentApproval/);
  assert.doesNotMatch(source, /github\.com\/reiki-ai-apps\/AI-/i);
  assert.doesNotMatch(source, /publicApprovalRoute/);
});
