#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { systemClock } from '../js/core/clock.js';
import { openFileDatabase } from '../js/store/filedb.js';
import { Repo } from '../js/store/repo.js';
import { reviseChannelPost, updateInternal } from '../js/services/posts.js';
import { submitForApproval } from '../js/services/approvals.js';
import { updateProduction } from '../js/services/production.js';

const TIME_ZONE = 'Asia/Tokyo';

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!name.startsWith('--')) throw new Error(`不明な引数です: ${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} の値がありません。`);
    out[name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  return out;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

async function writeJson(path, value) {
  if (!path) return;
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function publicAsset({ id, role, hash, mime, bytes, fileName, publicBase, altText, order }) {
  const publicUrl = `${publicBase.replace(/\/$/, '')}/${fileName}`;
  return {
    asset_id: id,
    asset_role: role,
    sha256: hash,
    mime,
    bytes,
    order,
    alt_text: altText,
    rights_status: 'VERIFIED',
    file_name: fileName,
    public_url: publicUrl,
    preview_url: publicUrl,
    thumbnail_url: mime.startsWith('image/') ? publicUrl : null,
  };
}

function currentMatches(revision, run) {
  const wanted = run.component_hashes ?? {};
  const hashes = new Set((revision?.assets ?? []).map((asset) => asset.sha256));
  return revision?.title === 'OpenAI新チーム発足｜AI導入前に決めたい3つの権限'
    && hashes.has(wanted.CONTENT)
    && hashes.has(wanted.THUMBNAIL_A);
}

export async function syncYoutubeFinalRun(options) {
  for (const required of ['runFile', 'gateFile', 'descriptionFile', 'dataFile', 'publicBase']) {
    if (!options[required]) throw new Error(`--${required.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)} は必須です。`);
  }

  const [run, gate, description] = await Promise.all([
    readJson(options.runFile),
    readJson(options.gateFile),
    readFile(resolve(options.descriptionFile), 'utf8'),
  ]);
  if (run.run_id !== gate.run_id) throw new Error('run_id が一致しません。');

  const clock = systemClock(TIME_ZONE);
  const db = await openFileDatabase(resolve(options.dataFile));
  const repo = new Repo(db, clock);
  const ctx = {
    repo,
    db,
    clock,
    mode: 'SOLO',
    actor: { userId: 'youtube-final-sync', role: 'ADMIN' },
  };

  const group = await repo.read(['postGroups'], async (tx) =>
    (await tx.getAll('postGroups')).find((row) => row.source_run_id === run.run_id && !row.deleted_at),
  );
  if (!group) throw new Error(`制作run ${run.run_id} のPostGroupがありません。`);
  const posts = await repo.listChannelPostsOfGroup(group.post_group_id);
  const post = posts.find((item) => item.platform === 'YOUTUBE' && !item.deleted_at && !item.cancelled_at);
  if (!post) throw new Error('対象のYouTube投稿枠がありません。');

  const current = await repo.getRevision(post.current_revision_id);
  const videoBytes = Number(options.videoBytes);
  const thumbBytes = Number(options.thumbnailBytes);
  if (!Number.isFinite(videoBytes) || !Number.isFinite(thumbBytes)) {
    throw new Error('--video-bytes と --thumbnail-bytes は数値で指定してください。');
  }

  const assets = [
    publicAsset({
      id: 'a2400000-0000-4000-8000-000000000001',
      role: 'VIDEO',
      hash: run.component_hashes.CONTENT,
      mime: 'video/mp4',
      bytes: videoBytes,
      fileName: 'kizashi-ai-news-20260824-r2.mp4',
      publicBase: options.publicBase,
      altText: 'OpenAI新チーム発足とAI導入前の3つの権限を解説する4分02秒の動画',
      order: 0,
    }),
    publicAsset({
      id: 'a2400000-0000-4000-8000-000000000002',
      role: 'THUMBNAIL',
      hash: run.component_hashes.THUMBNAIL_A,
      mime: 'image/jpeg',
      bytes: thumbBytes,
      fileName: 'kizashi-ai-news-20260824-thumbnail-a.jpg',
      publicBase: options.publicBase,
      altText: '決定権は誰に？ AI導入前に決めたい3つの権限',
      order: 1,
    }),
  ];

  let revisionChanged = false;
  if (!currentMatches(current, run)) {
    const body = [
      '【公開直前確認】',
      '投稿先: YouTube / AI進化レーダー',
      `公開予定: ${run.target_publish_at}`,
      '価格: 無料公開',
      '費用: Aivis Cloud実利用あり（請求額は取得不能）／有料画像生成なし／YouTube API未実行',
      '外部状態: 接続・認証待ち（YouTube OAuth client secret未配置）',
      '',
      description.trim(),
    ].join('\n');
    await reviseChannelPost(ctx, post.channel_post_id, {
      title: 'OpenAI新チーム発足｜AI導入前に決めたい3つの権限',
      body,
      hashtags: ['AIニュース', 'OpenAI', 'AIガバナンス'],
      cta: 'AIに任せる前に、提案・承認・実行の権限を分けて確認してください。',
      visibility: 'PUBLIC',
      scheduledAtIso: new Date(Date.parse(run.target_publish_at)).toISOString(),
      timeZone: TIME_ZONE,
      assets,
      rights: {
        confirmed: true,
        rights_status: 'VERIFIED',
        sources: [{
          claim_id: 'openai-ai-futures-20260820',
          source_url: 'https://openai.com/index/introducing-ai-futures/',
          verified_at: '2026-08-24T01:00:00+09:00',
          epistemic_status: 'VERIFIED',
        }],
      },
    }, { reason: `完成成果物Revision ${run.revision}・動画・サムネイルA・説明文・日時・費用・接続状態を同期` });
    revisionChanged = true;
  }

  const latestPost = await repo.getPost(post.channel_post_id);
  if (latestPost.display_state !== 'PENDING_APPROVAL') {
    await submitForApproval(ctx, post.channel_post_id, {
      reason: '完成動画とサムネイルAを同じ画面で最終確認',
    });
  }
  await updateProduction(ctx, post.channel_post_id, {
    kind: 'VIDEO',
    steps: gate.platform_steps.YOUTUBE,
    reason: `制作run ${run.run_id} Revision ${run.revision} の完成状態を同期`,
  });
  await updateInternal(ctx, post.channel_post_id, {
    memo: '完成成果物を確認可能。外部予約receiptは未取得。',
    tags: ['production-run', 'media-complete', 'owner-approval-pending', 'youtube-oauth-pending'],
  }, { reason: '完成・承認待ち・接続条件を同期' });

  const savedPost = await repo.getPost(post.channel_post_id);
  const savedRevision = await repo.getRevision(savedPost.current_revision_id);
  const receipt = {
    schema_version: 'reiki-youtube-final-sync.v1',
    status: revisionChanged ? 'SYNCED_NEW_REVISION' : 'REPLAYED',
    changed: revisionChanged,
    run_id: run.run_id,
    source_revision: run.revision,
    channel_post_id: post.channel_post_id,
    revision_id: savedRevision.revision_id,
    revision_no: savedRevision.revision_no,
    component_hashes: run.component_hashes,
    asset_urls: savedRevision.assets.map((asset) => asset.preview_url ?? asset.public_url),
    scheduled_at: savedPost.scheduled_at,
    display_state: savedPost.display_state,
    external_state: run.external.state,
    reservation_receipt: null,
    publication_receipt: null,
    synced_at: clock.nowIso(),
  };
  await writeJson(options.receipt, receipt);
  return receipt;
}

async function main() {
  try {
    const result = await syncYoutubeFinalRun(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
