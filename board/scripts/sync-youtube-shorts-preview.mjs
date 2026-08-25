#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
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

async function writeJson(path, value) {
  if (!path) return;
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function syncYoutubeShortsPreview(options) {
  for (const required of ['dataFile', 'channelPostId', 'publicUrl']) {
    if (!options[required]) throw new Error(`--${required.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)} は必須です。`);
  }

  const clock = systemClock(TIME_ZONE);
  const db = await openFileDatabase(resolve(options.dataFile));
  const repo = new Repo(db, clock);
  const ctx = {
    repo,
    db,
    clock,
    mode: 'SOLO',
    actor: { userId: 'youtube-shorts-preview-sync', role: 'ADMIN' },
  };

  const post = await repo.getPost(options.channelPostId);
  if (!post || post.deleted_at || post.cancelled_at) throw new Error('対象のYouTube Shorts投稿がありません。');
  const current = await repo.getRevision(post.current_revision_id);
  const videoAsset = (current.assets ?? []).find((asset) => asset.mime === 'video/mp4');
  if (!videoAsset) throw new Error('完成動画アセットがありません。');

  const alreadyLinked = (videoAsset.preview_url ?? videoAsset.public_url) === options.publicUrl
    && videoAsset.asset_role === 'VIDEO';
  if (!alreadyLinked) {
    const assets = (current.assets ?? []).map((asset) => asset.asset_id === videoAsset.asset_id ? {
      ...asset,
      asset_role: 'VIDEO',
      file_name: options.fileName ?? asset.file_name,
      public_url: options.publicUrl,
      preview_url: options.publicUrl,
      thumbnail_url: null,
    } : asset);
    await reviseChannelPost(ctx, post.channel_post_id, {
      title: current.title,
      body: current.body,
      hashtags: current.hashtags,
      cta: current.cta,
      visibility: current.visibility,
      scheduledAtIso: post.scheduled_at,
      timeZone: post.time_zone,
      assets,
      rights: current.rights,
    }, { reason: '完成Shortsの軽量MP4表示URLとVIDEO役割を同期' });
  }

  const latest = await repo.getPost(post.channel_post_id);
  if (latest.display_state !== 'PENDING_APPROVAL') {
    await submitForApproval(ctx, post.channel_post_id, { reason: '完成ShortsをBoard上で再生確認' });
  }
  await updateProduction(ctx, post.channel_post_id, {
    kind: 'SHORT_VIDEO',
    steps: [
      { id: 'y1', label: '火曜日Shorts企画', done: true },
      { id: 'y2', label: '動画・字幕・18件UI安全検査', done: true },
      { id: 'y3', label: '所有者確認・YouTube外部receipt', done: false },
    ],
    reason: 'Revision 2の完成Shortsと確認待ち状態を同期',
  });
  await updateInternal(ctx, post.channel_post_id, {
    memo: '33.9秒・3.8MB・高速再生対応。確認成立まで外部アップロードしない。',
    tags: ['youtube-shorts', 'media-complete', 'owner-confirmation-pending', 'external-not-uploaded'],
  }, { reason: '完成・確認待ち・外部未投稿を同期' });

  const savedPost = await repo.getPost(post.channel_post_id);
  const savedRevision = await repo.getRevision(savedPost.current_revision_id);
  const receipt = {
    schema_version: 'reiki-youtube-shorts-preview-sync.v1',
    status: alreadyLinked ? 'REPLAYED' : 'SYNCED_NEW_REVISION',
    changed: !alreadyLinked,
    channel_post_id: savedPost.channel_post_id,
    revision_id: savedRevision.revision_id,
    revision_no: savedRevision.revision_no,
    video_sha256: videoAsset.sha256,
    video_url: options.publicUrl,
    display_state: savedPost.display_state,
    scheduled_at: savedPost.scheduled_at,
    external_actions_executed: false,
    synced_at: clock.nowIso(),
  };
  await writeJson(options.receipt, receipt);
  return receipt;
}

async function main() {
  try {
    const result = await syncYoutubeShortsPreview(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
