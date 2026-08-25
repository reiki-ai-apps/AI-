import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { approvalArtifactUrl } from '../js/ui/approvalsView.js';

const boardRoot = fileURLToPath(new URL('..', import.meta.url));

test('承認待ちnoteは記事リンクと全画像を表示できる', async () => {
  const board = JSON.parse(await readFile(resolve(boardRoot, 'data/board.json'), 'utf8'));
  const targetIds = new Set([
    '359e1245-7355-4e59-87e4-6aec6ef7c293',
    'b8d6b6bb-9480-44b4-beb9-c7110bee3ad0',
  ]);
  const notePosts = board.stores.channelPosts.filter((post) => targetIds.has(post.channel_post_id));
  assert.equal(notePosts.length, targetIds.size);

  for (const post of notePosts) {
    const revision = board.stores.postRevisions.find((item) => item.revision_id === post.current_revision_id);
    assert.ok(revision, `${post.channel_post_id}: current revision`);
    const documents = revision.assets.filter((asset) => String(asset.mime ?? '').startsWith('text/'));
    const images = revision.assets.filter((asset) => String(asset.mime ?? '').startsWith('image/'));
    assert.ok(documents.length >= 1, `${post.channel_post_id}: article`);
    assert.ok(images.length >= 1, `${post.channel_post_id}: images`);

    for (const asset of [...documents, ...images]) {
      const url = asset.preview_url ?? asset.public_url ?? asset.thumbnail_url;
      assert.match(url ?? '', /^https:\/\/reiki-ai-apps\.github\.io\/AI-\/board\/media\//);
      const relative = new URL(url).pathname.split('/board/')[1];
      await access(resolve(boardRoot, relative));
    }
  }
});

test('新Revision作成時も表示URLと素材役割を保持する', async () => {
  const postsSource = await readFile(resolve(boardRoot, 'js/services/posts.js'), 'utf8');
  assert.match(postsSource, /asset_role:\s*a\.asset_role/);
  assert.match(postsSource, /public_url:\s*a\.public_url/);
  assert.match(postsSource, /preview_url:\s*a\.preview_url/);
});

test('承認画面は記事全文リンクとリンク欠落警告を表示する', async () => {
  const source = await readFile(resolve(boardRoot, 'js/ui/approvalsView.js'), 'utf8');
  assert.match(source, /記事全文を開く/);
  assert.match(source, /成果物の表示リンクが未登録/);
});

test('動画投稿の確認リンクは一次情報ではなく完成動画を優先する', () => {
  const videoUrl = 'https://reiki-ai-apps.github.io/AI-/board/media/short.mp4';
  assert.equal(approvalArtifactUrl({
    assets: [{ asset_role: 'VIDEO', mime: 'video/mp4', preview_url: videoUrl }],
    rights: { sources: [{ source_url: 'https://openai.com/source/' }] },
  }), videoUrl);
});

test('記事投稿の確認リンクは記事全文を動画より優先する', () => {
  const articleUrl = 'https://reiki-ai-apps.github.io/AI-/board/media/article.html';
  assert.equal(approvalArtifactUrl({ assets: [
    { asset_role: 'VIDEO', mime: 'video/mp4', preview_url: 'https://example.com/video.mp4' },
    { asset_role: 'CONTENT', mime: 'text/html', preview_url: articleUrl },
  ] }), articleUrl);
});
