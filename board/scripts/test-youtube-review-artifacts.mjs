#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const data = JSON.parse(await readFile(resolve(root, 'data/board.json'), 'utf8'));
const uiSource = await readFile(resolve(root, 'js/ui/approvalsView.js'), 'utf8');

const group = data.stores.postGroups.find((row) => row.source_run_id === 'kizashi-20260828' && !row.deleted_at);
assert.ok(group, 'kizashi-20260828 のPostGroupが必要です');
const post = data.stores.channelPosts.find((row) =>
  row.post_group_id === group.post_group_id && row.platform === 'YOUTUBE' && !row.deleted_at && !row.cancelled_at);
assert.equal(post?.display_state, 'SCHEDULED', '外部receipt照合後のYouTubeカードは予約済みである必要があります');
assert.equal(post?.public_url, 'https://youtu.be/k7J6ouH0sec', '外部receiptと一致するURLが必要です');
assert.equal(post?.external_post_id, 'k7J6ouH0sec', '外部receiptと一致する動画IDが必要です');
assert.equal(post?.scheduled_at, '2026-08-31T19:00:00+09:00', '外部receiptと一致する予約時刻が必要です');
assert.ok(post?.approval_id, '現Revisionの所有者承認証跡が必要です');

const revision = data.stores.postRevisions.find((row) => row.revision_id === post.current_revision_id);
assert.ok(revision, '現Revisionが必要です');
assert.equal(revision.assets.length, 9, '最終動画・確認ページ・表示検査・サムネイル3案・メタデータ・字幕・説明文の9点が必要です');
assert.deepEqual(
  revision.assets.map((asset) => asset.file_name),
  [
    'video.mp4',
    'final-review.html',
    'final-qc-contact-sheet-960.png',
    'thumbnail-a.jpg',
    'thumbnail-b.jpg',
    'thumbnail-c.jpg',
    'youtube-metadata.json',
    'subtitles-ja.srt',
    'description.txt',
  ],
);

for (const asset of revision.assets) {
  assert.match(asset.public_url, /^https:\/\/reiki-ai-apps\.github\.io\/AI-\/board\/media\/kizashi-20260828-youtube-r4-final-review\//);
  const local = resolve(root, 'media/kizashi-20260828-youtube-r4-final-review', asset.file_name);
  const bytes = await readFile(local);
  assert.equal(bytes.length, asset.bytes, `${asset.file_name} のbytesが一致する必要があります`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, `${asset.file_name} のSHA-256が一致する必要があります`);
}

assert.match(uiSource, /mime\.startsWith\('audio\/'\)/, 'Boardは音声プレイヤーを描画する必要があります');
assert.match(uiSource, /el\('audio'/, 'Boardはaudio controls要素を生成する必要があります');
console.log('YouTube Revision 4確認成果物9点・現Revision承認・外部予約receiptを検証しました。');
