import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const [boardPathArg, dateKey] = process.argv.slice(2);
if (!boardPathArg || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey ?? '')) {
  throw new Error('Usage: node apply-news-cadence-policy.mjs <board.json> <YYYY-MM-DD>');
}

const weekday = new Date(`${dateKey}T12:00:00+09:00`).getUTCDay();
const mainVideoDay = weekday === 1 || weekday === 3 || weekday === 5;
if (!mainVideoDay) {
  console.log(JSON.stringify({ dateKey, changed: 0, reason: 'SHORTS_DAY' }));
  process.exit(0);
}

const boardPath = path.resolve(boardPathArg);
const board = JSON.parse(await fs.readFile(boardPath, 'utf8'));
const stores = board.stores ?? {};
const now = new Date().toISOString();
const changedIds = [];

for (const post of stores.channelPosts ?? []) {
  if (post.brand_id !== 'news' || post.platform !== 'YOUTUBE_SHORTS') continue;
  if (post.calendar_date_key !== dateKey || post.deleted_at || post.cancelled_at) continue;
  if (post.external_post_id || post.public_url || post.external_schedule_receipt || post.external_schedule_id) continue;
  post.cancelled_at = now;
  post.updated_at = now;
  post.internal = {
    ...(post.internal ?? {}),
    memo: `Asia/Tokyoの月・水・金はYouTube本編日。${dateKey}のShorts枠を外部送信前に取消。`,
    tags: [...new Set([...(post.internal?.tags ?? []), 'cadence-policy-cancelled'])],
  };
  changedIds.push(post.channel_post_id);
}

for (const schedule of stores.schedules ?? []) {
  if (!changedIds.includes(schedule.channel_post_id) || schedule.cancelled_at) continue;
  schedule.cancelled_at = now;
  schedule.active_key = null;
}

for (const channelPostId of changedIds) {
  stores.auditEvents ??= [];
  stores.auditEvents.push({
    audit_id: randomUUID(),
    actor: 'cadence-policy',
    target_type: 'channelPost',
    target_id: channelPostId,
    action: 'schedule.cancel.weekday_policy',
    occurred_at: now,
    before_hash: null,
    after_hash: null,
    reason: `${dateKey}はYouTube本編日（月・水・金）のためShortsを取消`,
    correlation_id: randomUUID(),
    revision_id: null,
    execution_id: null,
    seq: ++board.autoSeq.auditEvents,
  });
}

await fs.writeFile(boardPath, JSON.stringify(board), 'utf8');
console.log(JSON.stringify({ dateKey, changed: changedIds.length, channelPostIds: changedIds }));
