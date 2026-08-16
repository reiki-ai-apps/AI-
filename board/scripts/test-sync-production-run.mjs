import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CONDITIONS, evaluatePost } from '../js/domain/notify.js';
import { syncProductionRun } from './sync-production-run.mjs';

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('制作保留runを4媒体の下書きとして冪等同期する', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reiki-production-run-'));
  const runFile = join(dir, 'run.json');
  const gateFile = join(dir, 'gate.json');
  const dataFile = join(dir, 'board.json');
  const receipt = join(dir, 'receipt.json');
  const runId = 'ai-news-test-20260816-1615-jst';

  await writeJson(runFile, {
    run_id: runId,
    source_skill: 'ai_news_v1',
    started_at: '2026-08-16T16:15:08+09:00',
    stage: 'primary_source_verification',
    result: 'HOLD',
  });
  await writeJson(gateFile, {
    run_id: runId,
    status: 'HOLD',
    required: { verified_primary_sources: 3 },
    observed: { verified_primary_sources: 0 },
    reason: '一次情報が不足',
  });

  const first = await syncProductionRun({ runFile, gateFile, dataFile, receipt });
  assert.equal(first.status, 'IMPORTED');
  assert.equal(first.reservation_created, false);
  assert.equal(first.channel_post_ids.length, 4);
  assert.equal(first.production_updated, 4);
  assert.equal(first.tracking_marker_updated, 4);

  const second = await syncProductionRun({ runFile, gateFile, dataFile, receipt });
  assert.equal(second.status, 'REPLAYED');
  assert.equal(second.changed, false);
  assert.equal(second.production_updated, 0);
  assert.equal(second.tracking_marker_updated, 0);

  const board = JSON.parse(await readFile(dataFile, 'utf8'));
  assert.equal(board.stores.postGroups.length, 1);
  assert.equal(board.stores.channelPosts.length, 4);
  assert.deepEqual(
    board.stores.channelPosts.map((post) => post.platform).sort(),
    ['INSTAGRAM', 'NOTE', 'X', 'YOUTUBE'],
  );
  assert.ok(board.stores.channelPosts.every((post) => post.display_state === 'DRAFT'));
  assert.ok(board.stores.channelPosts.every((post) => post.production.steps[0].label === '一次情報3件の確認'));
  assert.ok(board.stores.channelPosts.every((post) => post.internal.tags.includes('production-run')));
});

test('制作runの記録を公開期限超過として警告しない', () => {
  const notices = evaluatePost({
    id: 'tracking-post',
    brandId: 'news',
    platform: 'YOUTUBE',
    title: '一次情報確認中',
    displayState: 'DRAFT',
    scheduledAtMs: Date.parse('2026-08-16T07:15:08.000Z'),
    hasAssets: false,
    rightsConfirmed: false,
    credentialExpired: false,
    trackingOnly: true,
    production: {
      steps: [{ id: 'primary_sources', label: '一次情報3件の確認', done: false }],
    },
  }, Date.parse('2026-08-16T08:00:00.000Z'));

  assert.deepEqual(notices.map((notice) => notice.condition), [CONDITIONS.PRODUCTION_HOLD]);
  assert.match(notices[0].cause, /品質保留中/);
});
