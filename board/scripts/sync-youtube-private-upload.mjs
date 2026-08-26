#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { systemClock } from '../js/core/clock.js';
import { domainDigest } from '../js/core/digest.js';
import { openFileDatabase } from '../js/store/filedb.js';
import { Repo } from '../js/store/repo.js';

const TIME_ZONE = 'Asia/Tokyo';
const SNAPSHOT_DOMAIN = 'REIKI-AUDIT-SNAPSHOT-V1';

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`引数が不正です: ${key ?? ''}`);
    }
    out[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return out;
}

function verifyReceipt(receipt) {
  if (receipt.status !== 'UPLOADED_PRIVATE') throw new Error('receipt.status は UPLOADED_PRIVATE が必要です。');
  if (!receipt.external_id || !/^https:\/\//.test(receipt.studio_url ?? '')) throw new Error('外部動画IDとStudio URLが必要です。');
  if (receipt.privacy_status !== 'PRIVATE') throw new Error('非公開アップロードの証跡ではありません。');
  if (!receipt.verification?.channel_matches || !receipt.verification?.file_sha256_matches) {
    throw new Error('チャンネルまたは動画Hashの照合が未完了です。');
  }
}

export async function syncYoutubePrivateUpload({ dataFile, receiptFile, runId, platform = 'YOUTUBE_SHORTS', channelPostId }) {
  if (!dataFile || !receiptFile || !runId) throw new Error('--data-file、--receipt-file、--run-id は必須です。');
  const receiptPath = resolve(receiptFile);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  verifyReceipt(receipt);

  const clock = systemClock(TIME_ZONE);
  const db = await openFileDatabase(resolve(dataFile));
  const repo = new Repo(db, clock);
  const candidateGroups = await repo.read(['postGroups'], async (tx) =>
    (await tx.getAll('postGroups')).filter((row) => row.source_run_id === runId && !row.deleted_at),
  );
  let post = channelPostId ? await repo.getPost(channelPostId) : null;
  let group = post ? await repo.getPostGroup(post.post_group_id) : null;
  if (post && post.platform !== platform.toUpperCase()) {
    throw new Error(`明示された投稿IDの媒体が一致しません: ${post.platform}`);
  }
  if (!post) {
    for (const candidate of candidateGroups) {
      const posts = await repo.listChannelPostsOfGroup(candidate.post_group_id);
      const found = posts.find((row) => row.platform === platform.toUpperCase() && !row.deleted_at && !row.cancelled_at);
      if (found) {
        post = found;
        group = candidate;
        break;
      }
    }
  }
  if (!group) throw new Error(`制作runがBoardにありません: ${runId}`);
  if (!post) throw new Error(`対象媒体がBoardにありません: ${platform}`);

  if (post.external_upload?.external_post_id === receipt.external_id) {
    return { status: 'REPLAYED', changed: false, channel_post_id: post.channel_post_id, external_id: receipt.external_id };
  }

  const now = clock.nowIso();
  const steps = (post.production?.steps ?? []).map((step) => step.id === 'y3' ? {
    ...step,
    done: false,
    label: 'YouTubeアップロード済み（非公開）／公開設定中',
    note: `外部動画ID ${receipt.external_id} を取得。公開receipt待ち。`,
  } : step);
  const updatedPost = {
    ...post,
    external_upload: {
      external_post_id: receipt.external_id,
      studio_url: receipt.studio_url,
      watch_url: receipt.watch_url,
      privacy_status: receipt.privacy_status,
      uploaded_at: receipt.uploaded_at,
      video_sha256: receipt.video_sha256,
      receipt_path: receipt.receipt_path,
    },
    internal: {
      ...(post.internal ?? {}),
      memo: 'YouTubeへの動画登録は完了（現在は非公開）。タイトル・説明・公開設定を入力中。公開receipt取得までは予約済み・公開済みとして扱わない。',
      tags: [...new Set([...(post.internal?.tags ?? []).filter((tag) => tag !== 'external-receipt-pending'), 'youtube-uploaded-private', 'metadata-setting-in-progress', 'external-publication-receipt-pending'])],
    },
    production: post.production ? { ...post.production, steps, updated_at: now, updated_by: 'youtube-private-upload-sync' } : undefined,
    updated_at: now,
  };
  const updatedGroup = { ...group, updated_at: now };
  const beforeHash = await domainDigest(SNAPSHOT_DOMAIN, post);
  const afterHash = await domainDigest(SNAPSHOT_DOMAIN, updatedPost);

  await repo.change(['postGroups', 'channelPosts'], async (tx, audit) => {
    await tx.put('postGroups', updatedGroup);
    await tx.put('channelPosts', updatedPost);
    await audit({
      actor: 'youtube-private-upload-sync',
      target_type: 'channelPost',
      target_id: post.channel_post_id,
      action: 'external.upload.confirm',
      before_hash: beforeHash,
      after_hash: afterHash,
      reason: `YouTubeへ非公開アップロード済み（外部ID: ${receipt.external_id}）。公開receipt待ち。`,
      revision_id: post.current_revision_id,
    });
  });

  return { status: 'SYNCED', changed: true, channel_post_id: post.channel_post_id, external_id: receipt.external_id, synced_at: now };
}

async function main() {
  try {
    const result = await syncYoutubePrivateUpload(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
