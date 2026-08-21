import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isPublicApprovalActionable } from '../js/ui/publicApproval.js';

test('一括承認は予定時刻と許可遅延を過ぎた投稿を除外する', () => {
  const now = Date.parse('2026-08-22T00:00:00.000Z');
  assert.equal(isPublicApprovalActionable({ scheduled_at: '2026-08-21T23:45:00.000Z' }, now), true);
  assert.equal(isPublicApprovalActionable({ scheduled_at: '2026-08-21T23:29:59.000Z' }, now), false);
  assert.equal(isPublicApprovalActionable({ scheduled_at: '不明' }, now), false);
});

test('承認ページは全件ボタン・Revision固定・Shortsサムネイル除外を備える', async () => {
  const source = await readFile(new URL('../js/ui/approvalsView.js', import.meta.url), 'utf8');
  assert.match(source, /すべて承認（\$\{postCount\}投稿）/);
  assert.match(source, /collectPublicApprovalTasks/);
  assert.match(source, /componentKey\(post, componentScope\)/);
  assert.match(source, /post\.platform === 'YOUTUBE_SHORTS' \? \['CONTENT'\]/);
  assert.match(source, /期限切れの\$\{expiredCount\}件/);
});
