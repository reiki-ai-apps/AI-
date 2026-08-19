#!/usr/bin/env node

import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { systemClock } from '../js/core/clock.js';
import { openFileDatabase } from '../js/store/filedb.js';
import { openGithubDatabase } from '../js/store/githubdb.js';
import { Repo } from '../js/store/repo.js';
import { ingestPackage, sealPackage, validatePackage } from '../js/services/ingest.js';
import { submitForApproval } from '../js/services/approvals.js';

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
  const result = await ingestPackage(ctx, sealed, assetBytes);
  let queued = [];
  if (options.queueForApproval && !result.replayed) {
    queued = [];
    for (const channelPostId of result.channelPostIds ?? []) {
      await submitForApproval(ctx, channelPostId, { reason: `${sealed.source_skill} の検査済み成果物を確認依頼` });
      queued.push(channelPostId);
    }
  }

  const receipt = {
    ...baseReceipt,
    status: result.replayed ? 'REPLAYED' : 'IMPORTED',
    changed: !result.replayed,
    backend: ctx.backend,
    post_group_id: result.postGroupId,
    channel_post_ids: result.channelPostIds ?? [],
    queued_for_approval: queued,
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
