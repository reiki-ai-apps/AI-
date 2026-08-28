#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { systemClock } from '../js/core/clock.js';
import { openFileDatabase } from '../js/store/filedb.js';
import { Repo } from '../js/store/repo.js';
import { reviseChannelPost, updateInternal } from '../js/services/posts.js';
import { submitForApproval } from '../js/services/approvals.js';
import { updateProduction } from '../js/services/production.js';

const TIME_ZONE = 'Asia/Tokyo';

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`引数が不正です: ${key ?? ''}`);
    }
    values[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return values;
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

async function fileEvidence(path) {
  const fullPath = resolve(path);
  const [bytes, info] = await Promise.all([readFile(fullPath), stat(fullPath)]);
  return {
    path: fullPath,
    file_name: basename(fullPath),
    bytes: info.size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function publicAsset({ id, role, mime, evidence, publicBase, altText, order }) {
  const publicUrl = `${publicBase.replace(/\/$/, '')}/${encodeURIComponent(evidence.file_name)}`;
  return {
    asset_id: id,
    asset_role: role,
    sha256: evidence.sha256,
    mime,
    bytes: evidence.bytes,
    order,
    alt_text: altText,
    rights_status: 'VERIFIED',
    file_name: evidence.file_name,
    public_url: publicUrl,
    preview_url: publicUrl,
    thumbnail_url: mime.startsWith('image/') ? publicUrl : null,
  };
}

export async function syncYoutubeReviewArtifacts(options) {
  for (const key of ['runFile', 'gateFile', 'episodeFile', 'dataFile', 'assetDir', 'publicBase']) {
    if (!options[key]) throw new Error(`--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)} は必須です。`);
  }

  const [run, gate, episode] = await Promise.all([
    readJson(options.runFile),
    readJson(options.gateFile),
    readJson(options.episodeFile),
  ]);
  if (run.run_id !== gate.run_id || episode.run_id !== run.run_id) throw new Error('run_id が一致しません。');

  const assetDir = resolve(options.assetDir);
  const specs = [
    ['28a00000-0000-4000-8000-000000000001', 'CONTENT', 'audio/mpeg', 'pronunciation-preview.aivis.mp3', 'Aivis Cloud発音プレビュー18.29秒。発音・アクセント・抑揚の確認用音声', 0],
    ['28a00000-0000-4000-8000-000000000002', 'CONTENT', 'text/html', 'pronunciation-preview-review.html', '発音確認の読み上げ原稿・音声プレイヤー・ハッシュをまとめた確認ページ', 1],
    ['28a00000-0000-4000-8000-000000000003', 'THUMBNAIL', 'image/png', 'thumbnail-contact-sheet-r3.png', 'YouTubeサムネイルA・B・Cの比較一覧。全案にタイトルまたは具体コピーを実装', 0],
    ['28a00000-0000-4000-8000-000000000004', 'THUMBNAIL', 'image/jpeg', 'thumbnail-a.jpg', 'サムネイルA「AIで完成度 思考で独自性／1,000人超の実験」選択案', 1],
    ['28a00000-0000-4000-8000-000000000005', 'THUMBNAIL', 'image/jpeg', 'thumbnail-b.jpg', 'サムネイルB「ChatGPTだけで 考える力は伸びるか／研究結果を検証」', 2],
    ['28a00000-0000-4000-8000-000000000006', 'THUMBNAIL', 'image/jpeg', 'thumbnail-c.jpg', 'サムネイルC「良い答えと 新しい発想は別／AI仕事術の分岐点」', 3],
  ];
  const evidences = await Promise.all(specs.map((spec) => fileEvidence(resolve(assetDir, spec[3]))));
  const assets = specs.map((spec, index) => publicAsset({
    id: spec[0], role: spec[1], mime: spec[2], evidence: evidences[index],
    publicBase: options.publicBase, altText: spec[4], order: spec[5],
  }));

  const clock = systemClock(TIME_ZONE);
  const db = await openFileDatabase(resolve(options.dataFile));
  const repo = new Repo(db, clock);
  const ctx = {
    repo,
    db,
    clock,
    mode: 'SOLO',
    actor: { userId: 'youtube-review-sync', role: 'ADMIN' },
  };

  const group = await repo.read(['postGroups'], async (tx) =>
    (await tx.getAll('postGroups')).find((row) => row.source_run_id === run.run_id && !row.deleted_at));
  if (!group) throw new Error(`制作run ${run.run_id} のPostGroupがありません。`);
  const posts = await repo.listChannelPostsOfGroup(group.post_group_id);
  const post = posts.find((row) => row.platform === 'YOUTUBE' && !row.deleted_at && !row.cancelled_at);
  if (!post) throw new Error('YouTube投稿枠がありません。');

  const story = episode.stories?.[0] ?? {};
  const title = episode.youtube?.title ?? story.title ?? 'YouTube本編・発音確認';
  const body = [
    '【中間確認：公開・予約の承認ではありません】',
    '現在工程: Revision 3 発音プレビューの人による聞き取り',
    `本編タイトル: ${title}`,
    '投稿先: YouTube「AI進化レーダー」',
    '形式: 金曜YouTube本編',
    '確認音声: 18.29秒（Board上で再生可能）',
    'サムネイル: コピー入り3案。Aを選択案として表示',
    `一次情報: ${story.url ?? '取得不能'}`,
    `再生リスト: ${episode.youtube?.playlist ?? '取得不能'}`,
    '価格: 無料公開予定',
    '費用: 今回のAivis Cloud音声生成は上限70円で承認済み。発音プレビュー推定4.88円。追加課金なし',
    '未完了: 本編音声・字幕同期・最終動画・三周検査・公開直前承認・外部receipt',
    '',
    episode.youtube?.description_draft ?? '',
  ].filter(Boolean).join('\n');

  const current = await repo.getRevision(post.current_revision_id);
  const currentHashes = (current?.assets ?? []).map((asset) => asset.sha256).sort();
  const wantedHashes = assets.map((asset) => asset.sha256).sort();
  let changed = current?.title !== title || JSON.stringify(currentHashes) !== JSON.stringify(wantedHashes);
  if (changed) {
    await reviseChannelPost(ctx, post.channel_post_id, {
      title,
      body,
      hashtags: episode.youtube?.tags ?? [],
      cta: '音声を再生し、発音・アクセント・抑揚を確認してください。サムネイル3案も拡大して確認できます。',
      visibility: 'PUBLIC',
      scheduledAtIso: post.scheduled_at,
      timeZone: post.time_zone ?? TIME_ZONE,
      assets,
      rights: {
        confirmed: true,
        rights_status: 'VERIFIED',
        sources: story.url ? [{
          claim_id: 'openai-critical-thinking-study-20260827',
          source_url: story.url,
          verified_at: gate.checked_at,
          epistemic_status: 'VERIFIED',
        }] : [],
      },
    }, { reason: `Revision ${episode.revision}の発音プレビュー・確認ページ・コピー入りサムネイル3案をBoardへ同期` });
  }

  const afterRevision = await repo.getPost(post.channel_post_id);
  if (afterRevision.display_state !== 'PENDING_APPROVAL') {
    await submitForApproval(ctx, post.channel_post_id, {
      reason: '発音プレビューとコピー入りサムネイル3案をBoard上で確認可能にする',
    });
  }
  await updateProduction(ctx, post.channel_post_id, {
    kind: 'VIDEO',
    steps: gate.platform_steps?.YOUTUBE ?? [],
    reason: `制作run ${run.run_id} Revision ${episode.revision} の確認成果物を同期`,
  });
  await updateInternal(ctx, post.channel_post_id, {
    memo: '発音プレビュー18.29秒とコピー入りサムネイル3案をBoardで確認可能。公開・予約は未実行。',
    tags: ['production-run', 'pronunciation-review', 'review-artifacts-ready', 'external-receipt-missing'],
  }, { reason: '確認成果物の表示状態を同期' });

  const savedPost = await repo.getPost(post.channel_post_id);
  const savedRevision = await repo.getRevision(savedPost.current_revision_id);
  const result = {
    schema_version: 'reiki-youtube-review-artifacts-sync.v1',
    status: changed ? 'SYNCED_NEW_REVISION' : 'REPLAYED',
    changed,
    run_id: run.run_id,
    source_revision: episode.revision,
    post_group_id: group.post_group_id,
    channel_post_id: post.channel_post_id,
    board_revision_id: savedRevision.revision_id,
    board_revision_no: savedRevision.revision_no,
    display_state: savedPost.display_state,
    assets: savedRevision.assets.map((asset) => ({
      file_name: asset.file_name,
      sha256: asset.sha256,
      bytes: asset.bytes,
      public_url: asset.public_url,
    })),
    reservation_receipt: null,
    publication_receipt: null,
    synced_at: clock.nowIso(),
  };
  await writeJson(options.receipt, result);
  return result;
}

async function main() {
  try {
    const result = await syncYoutubeReviewArtifacts(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error?.message ?? String(error)}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
