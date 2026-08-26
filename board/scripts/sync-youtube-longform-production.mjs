#!/usr/bin/env node

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { systemClock } from '../js/core/clock.js';
import { openFileDatabase } from '../js/store/filedb.js';
import { Repo } from '../js/store/repo.js';
import { updateProduction } from '../js/services/production.js';
import { updateInternal } from '../js/services/posts.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || !value) throw new Error('引数は --data-file、--post-id、--receipt を指定してください。');
    out[key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.dataFile || !args.postId || !args.receipt) throw new Error('--data-file、--post-id、--receipt は必須です。');
const imagesComplete = Number.parseInt(args.imagesComplete ?? '0', 10);
if (!Number.isInteger(imagesComplete) || imagesComplete < 0 || imagesComplete > 15) {
  throw new Error('--images-complete は0〜15の整数で指定してください。');
}
const narrationComplete = args.narrationComplete === 'true';
const renderComplete = args.renderComplete === 'true';
const qcComplete = args.qcComplete === 'true';
const externalComplete = args.externalComplete === 'true';

const db = await openFileDatabase(resolve(args.dataFile));
const clock = systemClock('Asia/Tokyo');
const repo = new Repo(db, clock);
const ctx = {
  repo,
  db,
  clock,
  mode: 'SOLO',
  actor: { userId: 'youtube-longform-production-sync', role: 'ADMIN' },
};

const progress = await updateProduction(ctx, args.postId, {
  kind: 'VIDEO',
  reason: '水曜YouTube本編Revision 2の一次情報・台本・画像・音声・動画進捗を同期',
  steps: [
    { id: 'sources', label: '公式一次情報', done: true, note: 'OpenAI 2026-08-25発表を48時間枠で採用' },
    { id: 'script', label: '4分台本Revision 2・TTS読み', done: true, note: '1,273字・実測257.32秒' },
    { id: 'visual_plan', label: '15枚の画像設計', done: true, note: '主題・場所・行動を分離' },
    { id: 'visuals', label: imagesComplete === 15 ? '固有画像 15/15完了' : `残りの固有画像（${imagesComplete}/15完了）`, done: imagesComplete === 15, note: imagesComplete === 15 ? '15枚完成' : `完成 ${imagesComplete}枚・残り ${15 - imagesComplete}枚` },
    { id: 'narration', label: narrationComplete ? '発音確認・本編音声 完了' : '発音確認・本編音声', done: narrationComplete, note: narrationComplete ? 'まお／おちつき・257.32秒' : 'まお／おちつき' },
    { id: 'render', label: renderComplete ? '字幕・本編MP4 完了' : '字幕・本編MP4', done: renderComplete, note: '1920×1080・30fps・CRF17' },
    { id: 'qc', label: qcComplete ? '三周品質検査 完了' : '三周品質検査', done: qcComplete, note: '事実・理解・公開運用' },
    { id: 'external', label: externalComplete ? '外部照合・投稿receipt 取得済み' : '外部照合・投稿receipt', done: externalComplete, note: externalComplete ? '外部receiptを検証済み' : '重複確認後に1回だけ実行' }
  ],
});

await updateInternal(ctx, args.postId, {
  memo: `水曜YouTube本編を制作中。固有画像${imagesComplete}/15、音声${narrationComplete ? '完了（257.32秒）' : '制作中'}、動画${renderComplete ? '完了' : '制作中'}、三周検査${qcComplete ? '完了' : '未完了'}。内部予定は2026-08-26 21:00 JST。${externalComplete ? '外部処理済み。' : '外部予約ID・公開IDはまだありません。'}`,
  tags: ['youtube-longform', 'production-run', 'in-progress', 'ai-radar-funnel'],
}, { reason: '内部予定と外部receipt未取得を分けて表示' });

const post = await repo.getPost(args.postId);
const receipt = {
  status: 'SYNCED',
  changed: true,
  run_id: 'kizashi-20260825',
  subrun_id: 'youtube-longform-20260826-r1',
  channel_post_id: args.postId,
  display_state: post.display_state,
  scheduled_at: post.scheduled_at,
  external_receipt: null,
  production: progress,
  synced_at: clock.nowIso(),
};
const receiptPath = resolve(args.receipt);
await mkdir(dirname(receiptPath), { recursive: true });
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
