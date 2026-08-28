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
assert.equal(post?.display_state, 'PENDING_APPROVAL', '確認用YouTubeカードは承認待ちである必要があります');
assert.equal(post?.public_url ?? null, null, '外部公開URLを捏造してはいけません');
assert.equal(post?.external_post_id ?? null, null, '外部投稿IDを捏造してはいけません');

const revision = data.stores.postRevisions.find((row) => row.revision_id === post.current_revision_id);
assert.ok(revision, '現Revisionが必要です');
assert.equal(revision.assets.length, 6, '音声・確認ページ・比較一覧・サムネイル3案の6点が必要です');
assert.deepEqual(
  revision.assets.map((asset) => asset.file_name),
  [
    'pronunciation-preview.aivis.mp3',
    'pronunciation-preview-review.html',
    'thumbnail-contact-sheet-r3.png',
    'thumbnail-a.jpg',
    'thumbnail-b.jpg',
    'thumbnail-c.jpg',
  ],
);

for (const asset of revision.assets) {
  assert.match(asset.public_url, /^https:\/\/reiki-ai-apps\.github\.io\/AI-\/board\/media\/kizashi-20260828-youtube-r3-review\//);
  const local = resolve(root, 'media/kizashi-20260828-youtube-r3-review', asset.file_name);
  const bytes = await readFile(local);
  assert.equal(bytes.length, asset.bytes, `${asset.file_name} のbytesが一致する必要があります`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, `${asset.file_name} のSHA-256が一致する必要があります`);
}

assert.match(uiSource, /mime\.startsWith\('audio\/'\)/, 'Boardは音声プレイヤーを描画する必要があります');
assert.match(uiSource, /el\('audio'/, 'Boardはaudio controls要素を生成する必要があります');
console.log('YouTube確認成果物6点・音声プレイヤー・外部receipt未作成を検証しました。');
