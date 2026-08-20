#!/usr/bin/env node

import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { systemClock } from '../js/core/clock.js';
import { canonicalize } from '../js/core/jcs.js';
import { sha256OfBytes } from '../js/core/digest.js';
import { openFileDatabase } from '../js/store/filedb.js';
import { openGithubDatabase } from '../js/store/githubdb.js';
import { Repo } from '../js/store/repo.js';
import { ContractError, ingestPackage, sealPackage, validatePackage } from '../js/services/ingest.js';
import { submitForApproval } from '../js/services/approvals.js';
import { reviseChannelPost } from '../js/services/posts.js';

const DEFAULT_REPO = 'reiki-post-board-data';
const DEFAULT_BRANCH = 'main';
const DEFAULT_PATH = 'board.json';
const DEFAULT_TIME_ZONE = 'Asia/Tokyo';
const DEFAULT_PUBLIC_MEDIA_BASE_URL = 'https://reiki-ai-apps.github.io/AI-/board/media';
const MAX_PUBLIC_MEDIA_BYTES = 95_000_000;

function usage() {
  return `Usage:
  node board/scripts/sync-publication-package.mjs --package <package.json> [options]

Options:
  --validate-only            Validate and seal without changing POST BOARD
  --queue-for-approval       Move newly imported drafts to 承認待ち
  --asset-dir <directory>    Base directory for assets.archive_member files
  --public-media-dir <dir>   Copy assets into this public Board directory
  --public-media-base-url <url> Public URL corresponding to that directory
  --receipt <file>           Write a JSON receipt (never contains credentials)
  --owner <github-owner>     Data-repository owner (or REIKI_POST_BOARD_OWNER)
  --repo <github-repo>       Data repository (default: ${DEFAULT_REPO})
  --branch <branch>          Data branch (default: ${DEFAULT_BRANCH})
  --path <path>              Data file (default: ${DEFAULT_PATH})
  --data-file <file>         Use a local board snapshot instead of GitHub (testing)
  --actor <user-id>          Audit actor (default: skill-sync)
  --help                     Show this help

GitHub mode requires REIKI_POST_BOARD_GITHUB_TOKEN. The token is read only from
the environment and is never written to the package, receipt, logs, or board data.
REIKI_POST_BOARD_TENANT_ID may supply tenant_id when the package omits it.
同じ source_skill + source_run_id の修正版は、source_revision と
idempotency_key を更新すると同じ企画の新Revisionとして即時同期されます。
`;
}

function parseArgs(argv) {
  const out = {
    validateOnly: false,
    queueForApproval: false,
    repo: process.env.REIKI_POST_BOARD_REPO || DEFAULT_REPO,
    branch: process.env.REIKI_POST_BOARD_BRANCH || DEFAULT_BRANCH,
    path: process.env.REIKI_POST_BOARD_PATH || DEFAULT_PATH,
    owner: process.env.REIKI_POST_BOARD_OWNER || '',
    actor: 'skill-sync',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--validate-only') out.validateOnly = true;
    else if (arg === '--queue-for-approval') out.queueForApproval = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} の値がありません。`);
      out[key] = value;
      i += 1;
    } else {
      throw new Error(`不明な引数です: ${arg}`);
    }
  }
  return out;
}

async function loadAssets(pkg, assetDir) {
  const assets = new Map();
  for (const asset of pkg.assets ?? []) {
    if (!asset.archive_member) continue;
    if (!assetDir) {
      throw new Error(`素材 ${asset.archive_member} を読むには --asset-dir が必要です。`);
    }
    const fullPath = resolve(assetDir, asset.archive_member);
    assets.set(asset.archive_member, new Uint8Array(await readFile(fullPath)));
  }
  return assets;
}

function safeMediaName(asset, index) {
  const source = basename(asset.archive_member || `asset-${index + 1}`);
  const clean = source.normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${String(asset.order ?? index + 1).padStart(2, '0')}-${clean || `asset-${index + 1}`}`;
}

function inferAssetRole(asset) {
  if (asset.asset_role) return asset.asset_role;
  const name = String(asset.archive_member ?? '').toLowerCase();
  if (/thumb|thumbnail|cover|サムネ/.test(name)) return 'THUMBNAIL';
  if (String(asset.mime ?? '').startsWith('video/')) return 'VIDEO';
  if (String(asset.mime ?? '').startsWith('image/')) return 'CAROUSEL';
  return 'ATTACHMENT';
}

async function publishAssets(pkg, assetDir, options) {
  if (!(pkg.assets ?? []).length) return pkg;
  const dataFile = options.dataFile ? resolve(options.dataFile) : null;
  const defaultMediaDir = dataFile ? join(dirname(dirname(dataFile)), 'media') : null;
  const mediaDir = resolve(options.publicMediaDir || defaultMediaDir || 'board/media');
  const packageDir = join(mediaDir, pkg.package_id);
  await mkdir(packageDir, { recursive: true });
  const baseUrl = String(options.publicMediaBaseUrl || DEFAULT_PUBLIC_MEDIA_BASE_URL).replace(/\/$/, '');

  const assets = [];
  for (let index = 0; index < pkg.assets.length; index += 1) {
    const asset = pkg.assets[index];
    if (!asset.archive_member) {
      assets.push(asset);
      continue;
    }
    const source = resolve(assetDir, asset.archive_member);
    const sourceStat = await stat(source);
    if (sourceStat.size > MAX_PUBLIC_MEDIA_BYTES) {
      throw new Error(`公開確認用素材が95MBを超えています: ${asset.archive_member}。軽量プレビューを登録し、原本Hashはsource_sha256へ保存してください。`);
    }
    const fileName = safeMediaName(asset, index);
    await copyFile(source, join(packageDir, fileName));
    assets.push({
      ...asset,
      asset_role: inferAssetRole(asset),
      public_url: `${baseUrl}/${encodeURIComponent(pkg.package_id)}/${encodeURIComponent(fileName)}`,
    });
  }
  return { ...pkg, assets };
}

async function writeReceipt(path, receipt) {
  if (!path) return;
  const fullPath = resolve(path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
}

function validationError(errors) {
  return errors.map((item) => `${item.pointer || '/'}: ${item.message}`).join('\n');
}

async function openContext(options) {
  const clock = systemClock(DEFAULT_TIME_ZONE);
  let db;
  let backend;
  if (options.dataFile) {
    db = await openFileDatabase(resolve(options.dataFile));
    backend = 'file';
  } else {
    const token = process.env.REIKI_POST_BOARD_GITHUB_TOKEN;
    if (!token) throw new Error('REIKI_POST_BOARD_GITHUB_TOKEN が設定されていません。');
    if (!options.owner) throw new Error('--owner または REIKI_POST_BOARD_OWNER が必要です。');
    db = await openGithubDatabase({
      owner: options.owner,
      repo: options.repo,
      branch: options.branch,
      path: options.path,
      token,
    });
    backend = 'github';
  }
  const repo = new Repo(db, clock);
  return {
    repo,
    db,
    clock,
    backend,
    mode: 'SOLO',
    actor: { userId: options.actor, role: 'ADMIN' },
  };
}

function normalizedAssets(pkg) {
  return (pkg.assets ?? []).map((asset, index) => ({
    asset_id: asset.asset_id,
    sha256: asset.sha256,
    mime: asset.mime,
    bytes: asset.bytes,
    order: Number.isFinite(asset.order) ? asset.order : index,
    crop: asset.crop ?? null,
    thumbnail_sha256: asset.thumbnail_sha256 ?? null,
    subtitle_sha256: asset.subtitle_sha256 ?? null,
    alt_text: asset.alt_text ?? '',
    rights_status: asset.rights_status,
    file_name: asset.archive_member ?? null,
    asset_role: asset.asset_role ?? inferAssetRole(asset),
    public_url: asset.public_url ?? null,
    thumbnail_url: asset.thumbnail_url ?? null,
    preview_url: asset.preview_url ?? null,
    source_sha256: asset.source_sha256 ?? null,
    source_bytes: asset.source_bytes ?? null,
  }));
}

function assetsForPlatform(pkg, platform) {
  const normalized = normalizedAssets(pkg);
  return normalized.filter((asset) => {
    const source = (pkg.assets ?? []).find((candidate) => candidate.asset_id === asset.asset_id);
    return !source?.platform || source.platform === platform;
  });
}

function rightsForPackage(pkg) {
  return {
    confirmed: (pkg.claims ?? []).length > 0,
    rights_status: (pkg.assets ?? [])[0]?.rights_status ?? 'UNKNOWN',
    sources: (pkg.claims ?? [])
      .map((claim) => ({
        claim_id: claim.claim_id,
        source_url: claim.source_url,
        verified_at: claim.verified_at ?? null,
        epistemic_status: claim.epistemic_status ?? null,
      }))
      .sort((a, b) => String(a.claim_id).localeCompare(String(b.claim_id))),
  };
}

function revisionProjection({ post, revision }) {
  return {
    body: revision.body ?? '',
    title: revision.title ?? '',
    hashtags: revision.hashtags ?? [],
    cta: revision.cta ?? '',
    visibility: revision.visibility ?? 'PUBLIC',
    article_url: revision.article_url ?? null,
    assets: revision.assets ?? [],
    rights: revision.rights ?? {},
    scheduled_at: post.scheduled_at,
    time_zone: post.time_zone,
  };
}

function desiredProjection(pkg, payload) {
  const assetUrlById = new Map(normalizedAssets(pkg).map((asset) => [asset.asset_id, asset.public_url]));
  return {
    body: payload.body ?? '',
    title: payload.title ?? pkg.project_title,
    hashtags: payload.hashtags ?? [],
    cta: payload.cta ?? '',
    visibility: payload.visibility ?? 'PUBLIC',
    article_url: payload.article_url ?? payload.link_url ?? assetUrlById.get(payload.content_asset_id) ?? null,
    assets: assetsForPlatform(pkg, payload.platform),
    rights: rightsForPackage(pkg),
    scheduled_at: new Date(Date.parse(payload.suggested_schedule.scheduled_at)).toISOString(),
    time_zone: payload.suggested_schedule.time_zone,
  };
}

async function validateRevisionAssets(pkg, assetBytes) {
  for (const asset of pkg.assets ?? []) {
    if (!asset.archive_member) continue;
    const bytes = assetBytes.get(asset.archive_member);
    if (!bytes) throw new ContractError('ASSET_DIGEST_MISMATCH', 422, `素材ファイルが見つかりません: ${asset.archive_member}`);
    const actual = await sha256OfBytes(bytes);
    if (actual !== asset.sha256) {
      throw new ContractError('ASSET_DIGEST_MISMATCH', 422, `素材Hashが一致しません: ${asset.archive_member}`);
    }
  }
}

async function findExistingRun(ctx, pkg) {
  if (!pkg.source_run_id) return null;
  const matches = (await ctx.repo.listPostGroups()).filter((group) =>
    !group.deleted_at
    && group.source_skill === pkg.source_skill
    && group.source_run_id === pkg.source_run_id);
  if (matches.length > 1) {
    throw new Error(`同じsource_run_idの企画が複数あります: ${pkg.source_run_id}`);
  }
  return matches[0] ?? null;
}

async function replayForPackage(ctx, pkg) {
  const existing = (await ctx.repo.listPublicationPackages()).find((record) =>
    record.tenant_id === pkg.tenant_id
    && record.source_skill === pkg.source_skill
    && record.idempotency_key === pkg.idempotency_key);
  if (!existing) return null;
  if (existing.server_digest !== pkg.request_digest) {
    throw new ContractError(
      'IDEMPOTENCY_MISMATCH',
      409,
      '同じidempotency_keyで異なる修正版が送られました。source_revisionとidempotency_keyを更新してください。',
    );
  }
  const posts = await ctx.repo.listChannelPostsOfGroup(existing.post_group_id);
  return {
    status: 200,
    packageId: existing.package_id,
    postGroupId: existing.post_group_id,
    channelPostIds: posts.map((post) => post.channel_post_id),
    replayed: true,
    revised: false,
    revisionUpdates: [],
    warnings: [],
  };
}

async function reviseExistingRun(ctx, pkg, group, assetBytes) {
  await validateRevisionAssets(pkg, assetBytes);
  const priorPackages = (await ctx.repo.listPublicationPackages())
    .filter((record) => record.post_group_id === group.post_group_id);
  const maxSourceRevision = Math.max(0, ...priorPackages.map((record) => Number(record.source_revision ?? 1)));
  const sourceRevision = Number(pkg.source_revision ?? maxSourceRevision + 1);
  if (!Number.isInteger(sourceRevision) || sourceRevision <= maxSourceRevision) {
    throw new ContractError(
      'STALE_SOURCE_REVISION',
      409,
      `修正版のsource_revisionは${maxSourceRevision + 1}以上にしてください。`,
    );
  }

  const posts = await ctx.repo.listChannelPostsOfGroup(group.post_group_id);
  const byPlatform = new Map(posts.map((post) => [post.platform, post]));
  const revisionUpdates = [];
  for (const payload of pkg.platform_payloads) {
    const post = byPlatform.get(payload.platform);
    if (!post) throw new Error(`既存企画に${payload.platform}の投稿がありません。`);
    const current = await ctx.repo.getRevision(post.current_revision_id);
    if (!current) throw new Error(`現在Revisionが見つかりません: ${post.current_revision_id}`);
    const desired = desiredProjection(pkg, payload);
    if (canonicalize(revisionProjection({ post, revision: current })) === canonicalize(desired)) {
      revisionUpdates.push({
        platform: payload.platform,
        channel_post_id: post.channel_post_id,
        changed: false,
        revision_id: current.revision_id,
        revision_no: current.revision_no,
        approval_basis_hash: current.approval_basis_hash,
      });
      continue;
    }
    const result = await reviseChannelPost(ctx, post.channel_post_id, {
      body: desired.body,
      title: desired.title,
      hashtags: desired.hashtags,
      cta: desired.cta,
      visibility: desired.visibility,
      articleUrl: desired.article_url,
      assets: desired.assets,
      rights: desired.rights,
      scheduledAtIso: desired.scheduled_at,
      timeZone: desired.time_zone,
    }, { reason: `${pkg.source_skill} の修正版 source_revision=${sourceRevision} を即時同期` });
    const next = await ctx.repo.getRevision(result.revisionId);
    revisionUpdates.push({
      platform: payload.platform,
      channel_post_id: post.channel_post_id,
      changed: true,
      revision_id: result.revisionId,
      revision_no: result.revisionNo,
      approval_basis_hash: next?.approval_basis_hash ?? null,
      invalidated_approval: result.invalidatedApproval,
      changes: result.changes,
    });
  }

  const now = ctx.clock.nowIso();
  const packageRecord = {
    package_id: pkg.package_id,
    tenant_id: pkg.tenant_id,
    source_skill: pkg.source_skill,
    idempotency_key: pkg.idempotency_key,
    request_digest: pkg.request_digest,
    server_digest: pkg.request_digest,
    contract_version: pkg.contract_version,
    source_revision: sourceRevision,
    source_artifact_id: pkg.source_artifact_id ?? null,
    received_at: now,
    post_group_id: group.post_group_id,
    status: 'ACCEPTED_REVISION',
    quality_reviews: pkg.reviews ?? [],
  };
  await ctx.repo.change(['postGroups', 'publicationPackages'], async (tx, audit) => {
    const liveGroup = await tx.get('postGroups', group.post_group_id);
    await tx.put('postGroups', {
      ...liveGroup,
      project_title: pkg.project_title,
      package_id: pkg.package_id,
      updated_at: now,
    });
    await tx.add('publicationPackages', packageRecord);
    await audit({
      actor: ctx.actor.userId,
      target_type: 'publicationPackage',
      target_id: pkg.package_id,
      action: 'package.revision.accepted',
      before_hash: priorPackages.at(-1)?.server_digest ?? null,
      after_hash: pkg.request_digest,
      reason: `${pkg.source_skill} の修正版を同一runへ即時同期（source_revision=${sourceRevision}）`,
      revision_id: revisionUpdates.find((item) => item.changed)?.revision_id ?? null,
    });
  });

  return {
    status: 200,
    packageId: pkg.package_id,
    postGroupId: group.post_group_id,
    channelPostIds: revisionUpdates.map((item) => item.channel_post_id),
    replayed: false,
    revised: true,
    revisionUpdates,
    warnings: [],
  };
}

export async function syncPublicationPackage(options) {
  if (!options.package) throw new Error('--package が必要です。');
  const sourcePath = resolve(options.package);
  const raw = JSON.parse(await readFile(sourcePath, 'utf8'));
  const hydrated = {
    ...raw,
    tenant_id: raw.tenant_id || process.env.REIKI_POST_BOARD_TENANT_ID,
  };
  const assetDir = options.assetDir || dirname(sourcePath);
  const published = options.validateOnly ? hydrated : await publishAssets(hydrated, assetDir, options);
  const sealed = await sealPackage(published);
  const errors = validatePackage(sealed);
  if (errors.length) throw new Error(`PublicationPackage が不正です。\n${validationError(errors)}`);

  const baseReceipt = {
    contract_version: sealed.contract_version,
    package_id: sealed.package_id,
    source_skill: sealed.source_skill,
    idempotency_key: sealed.idempotency_key,
    request_digest: sealed.request_digest,
    validated_at: new Date().toISOString(),
  };

  if (options.validateOnly) {
    const receipt = { ...baseReceipt, status: 'VALIDATED', changed: false };
    await writeReceipt(options.receipt, receipt);
    return receipt;
  }

  const ctx = await openContext(options);
  const assetBytes = await loadAssets(sealed, assetDir);
  const replay = await replayForPackage(ctx, sealed);
  const existingRun = replay ? null : await findExistingRun(ctx, sealed);
  const result = replay
    ?? (existingRun
      ? await reviseExistingRun(ctx, sealed, existingRun, assetBytes)
      : await ingestPackage(ctx, sealed, assetBytes));
  let queued = [];
  if (options.queueForApproval && !result.replayed) {
    queued = [];
    for (const channelPostId of result.channelPostIds ?? []) {
      const post = await ctx.repo.getPost(channelPostId);
      if (post?.display_state === 'PENDING_APPROVAL') {
        queued.push(channelPostId);
      } else if (['DRAFT', 'QUALITY_REVIEW', 'ACTION_REQUIRED'].includes(post?.display_state)) {
        await submitForApproval(ctx, channelPostId, { reason: `${sealed.source_skill} の検査済み成果物を確認依頼` });
        queued.push(channelPostId);
      }
    }
  }

  const receipt = {
    ...baseReceipt,
    status: result.replayed ? 'REPLAYED' : result.revised ? 'REVISED' : 'IMPORTED',
    changed: !result.replayed,
    backend: ctx.backend,
    post_group_id: result.postGroupId,
    channel_post_ids: result.channelPostIds ?? [],
    queued_for_approval: queued,
    revision_updates: result.revisionUpdates ?? [],
    warnings: result.warnings ?? [],
    public_media: (sealed.assets ?? []).filter((asset) => asset.public_url).map((asset) => ({
      asset_id: asset.asset_id,
      asset_role: asset.asset_role,
      mime: asset.mime,
      sha256: asset.sha256,
      public_url: asset.public_url,
    })),
    synced_at: new Date().toISOString(),
  };
  await writeReceipt(options.receipt, receipt);
  return receipt;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage());
      return;
    }
    const receipt = await syncPublicationPackage(options);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error?.code ? `${error.code}: ` : ''}${error?.message ?? String(error)}\n`);
    if (Array.isArray(error?.errors)) {
      process.stderr.write(`${validationError(error.errors)}\n`);
    }
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
