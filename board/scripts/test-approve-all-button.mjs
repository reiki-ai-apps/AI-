import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isPublicApprovalActionable } from '../js/ui/publicApproval.js';

test('一括承認は予定時刻を過ぎても承認待ちを表示する', () => {
  const now = Date.parse('2026-08-22T00:00:00.000Z');
  assert.equal(isPublicApprovalActionable({ scheduled_at: '2026-08-21T23:45:00.000Z' }, now), true);
  assert.equal(isPublicApprovalActionable({ scheduled_at: '2026-08-21T23:29:59.000Z' }, now), true);
  assert.equal(isPublicApprovalActionable({ scheduled_at: '不明' }, now), false);
  assert.equal(isPublicApprovalActionable({ scheduled_at: '2026-08-21T23:45:00.000Z', cancelled_at: '2026-08-22T00:00:00.000Z' }, now), false);
});

test('承認ページは全件ボタン・Revision固定・Shortsサムネイル除外を備える', async () => {
  const source = await readFile(new URL('../js/ui/approvalsView.js', import.meta.url), 'utf8');
  assert.match(source, /すべて承認（\$\{postCount\}投稿）/);
  assert.match(source, /collectPublicApprovalTasks/);
  assert.match(source, /componentKey\(post, componentScope\)/);
  assert.match(source, /post\.platform === 'YOUTUBE_SHORTS' \? \['CONTENT'\]/);
  assert.match(source, /予定時刻を過ぎた\$\{overdueCount\}件も表示しています/);
});

test('公開承認画面はGitHub Issueへ遷移しない', async () => {
  const source = await readFile(new URL('../js/ui/approvalsView.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /GitHubで承認/);
  assert.doesNotMatch(source, /buildPublicApprovalRequest/);
  assert.match(source, /submitGatewayComponentApproval/);
});
