import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const boardRoot = fileURLToPath(new URL('..', import.meta.url));
const boardPath = resolve(process.argv[2] ?? boardRoot, process.argv[2] ? '' : 'data/board.json');
const board = JSON.parse(await readFile(boardPath, 'utf8'));
const { channelPosts = [], postRevisions = [] } = board.stores ?? {};
let repairedAssets = 0;
const repairedPosts = [];

function cacheBusted(rawUrl, revisionNo) {
  const url = new URL(rawUrl);
  url.searchParams.set('v', String(revisionNo));
  return url.toString();
}

function inferredRole(asset) {
  const mime = String(asset.mime ?? '');
  if (mime.startsWith('text/')) return 'CONTENT';
  if (/thumbnail/i.test(String(asset.file_name ?? ''))) return 'THUMBNAIL';
  if (mime.startsWith('video/')) return 'VIDEO';
  if (mime.startsWith('image/')) return 'IMAGE';
  return null;
}

for (const post of channelPosts.filter((item) => item.platform === 'NOTE' && !item.deleted_at)) {
  const current = postRevisions.find((revision) => revision.revision_id === post.current_revision_id);
  if (!current) continue;
  const history = postRevisions
    .filter((revision) => revision.channel_post_id === post.channel_post_id && revision.revision_no < current.revision_no)
    .sort((left, right) => right.revision_no - left.revision_no);

  let changed = false;
  current.assets = (current.assets ?? []).map((asset) => {
    const existingUrl = asset.preview_url ?? asset.public_url ?? asset.thumbnail_url ?? null;
    const historical = history
      .flatMap((revision) => revision.assets ?? [])
      .find((candidate) => candidate.file_name === asset.file_name
        && (candidate.preview_url ?? candidate.public_url ?? candidate.thumbnail_url));
    const inheritedUrl = existingUrl
      ?? historical?.preview_url
      ?? historical?.public_url
      ?? historical?.thumbnail_url
      ?? null;
    const assetRole = asset.asset_role ?? inferredRole(asset);
    if (!inheritedUrl && asset.asset_role === assetRole) return asset;
    changed = true;
    repairedAssets += inheritedUrl && !existingUrl ? 1 : 0;
    return {
      ...asset,
      asset_role: assetRole,
      public_url: inheritedUrl ? cacheBusted(inheritedUrl, current.revision_no) : null,
      preview_url: asset.preview_url ?? null,
      thumbnail_url: asset.thumbnail_url ?? null,
    };
  });
  if (changed) repairedPosts.push(post.channel_post_id);
}

if (repairedPosts.length) {
  await writeFile(boardPath, JSON.stringify(board), 'utf8');
}

process.stdout.write(`${JSON.stringify({ boardPath, repairedPosts, repairedAssets }, null, 2)}\n`);
