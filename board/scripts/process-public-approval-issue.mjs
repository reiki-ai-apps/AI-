#!/usr/bin/env node

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { systemClock } from '../js/core/clock.js';
import { buildApprovalBasis, approvalBasisHash } from '../js/domain/approval.js';
import { approve, approveGroup } from '../js/services/approvals.js';
import { openFileDatabase } from '../js/store/filedb.js';
import { Repo } from '../js/store/repo.js';

export const PUBLIC_APPROVAL_CONTRACT = 'REIKI_POST_BOARD_APPROVAL_V1';
const ALLOWED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`不明な引数です: ${arg}`);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} の値がありません。`);
    out[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    i += 1;
  }
  return out;
}

export function parseApprovalPayload(body) {
  const escaped = PUBLIC_APPROVAL_CONTRACT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(body ?? '').match(new RegExp(`<!--\\s*${escaped}\\s*([\\s\\S]*?)\\s*-->`));
  if (!match) throw new Error('POST BOARD承認データが見つかりません。');
  const payload = JSON.parse(match[1]);
  if (payload?.contract !== PUBLIC_APPROVAL_CONTRACT || payload?.action !== 'APPROVE') {
    throw new Error('対応していない承認データです。');
  }
  if (!Array.isArray(payload.targets) || payload.targets.length < 1 || payload.targets.length > 4) {
    throw new Error('承認対象は1〜4件で指定してください。');
  }
  if (payload.component_scope != null && !['CONTENT', 'THUMBNAIL'].includes(payload.component_scope)) {
    throw new Error('承認対象の区分が不正です。');
  }
  return payload;
}

async function priorComponentApprovals(receiptFile) {
  if (!receiptFile) return [];
  const folder = dirname(resolve(receiptFile));
  let names = [];
  try { names = await readdir(folder); } catch { return []; }
  const receipts = [];
  for (const name of names.filter((item) => item.endsWith('.json'))) {
    try {
      const value = JSON.parse(await readFile(resolve(folder, name), 'utf8'));
      if (value?.contract === PUBLIC_APPROVAL_CONTRACT && value?.component_scope) receipts.push(value);
    } catch { /* 壊れた別ファイルは承認証拠に使わない */ }
  }
  return receipts;
}

function hasMatchingComponent(receipts, scope, checked) {
  return checked.every((item) => receipts.some((receipt) => receipt.component_scope === scope
    && (receipt.approvals ?? []).some((approval) => approval.channel_post_id === item.post.channel_post_id
      && approval.revision_id === item.revision.revision_id
      && approval.approval_basis_hash === item.currentHash)));
}

async function validateTarget(ctx, target) {
  const post = await ctx.repo.getPost(target.channel_post_id);
  if (!post || post.deleted_at) throw new Error(`対象投稿が見つかりません: ${target.channel_post_id}`);
  if (post.display_state !== 'PENDING_APPROVAL') {
    throw new Error(`承認待ちではありません: ${target.channel_post_id} (${post.display_state})`);
  }
  if (post.current_revision_id !== target.revision_id) {
    throw new Error(`Revisionが更新されています: ${target.channel_post_id}`);
  }
  const revision = await ctx.repo.getRevision(post.current_revision_id);
  if (!revision) throw new Error(`対象版が見つかりません: ${target.revision_id}`);
  const allowedRetryDelayMinutes = Number(target.allowed_retry_delay_minutes ?? 30);
  if (!Number.isInteger(allowedRetryDelayMinutes) || allowedRetryDelayMinutes < 0 || allowedRetryDelayMinutes > 1440) {
    throw new Error('許可した遅延再試行時間が不正です。');
  }
  const basis = buildApprovalBasis({
    channelPost: post,
    revision,
    schedule: { scheduled_at: post.scheduled_at, time_zone: post.time_zone },
    allowedRetryDelayMinutes,
  });
  const currentHash = await approvalBasisHash(basis);
  if (currentHash !== target.approval_basis_hash) {
    throw new Error(`承認対象Hashが一致しません: ${target.channel_post_id}`);
  }
  return { post, revision, currentHash, allowedRetryDelayMinutes };
}

export async function processPublicApprovalIssue({ event, dataFile, receiptFile }) {
  const issue = event?.issue;
  const repository = event?.repository;
  if (!issue || !repository) throw new Error('GitHub Issueイベントではありません。');
  if (!ALLOWED_ASSOCIATIONS.has(issue.author_association)) {
    throw new Error(`承認権限がありません: ${issue.author_association || 'NONE'}`);
  }
  const payload = parseApprovalPayload(issue.body);
  const clock = systemClock('Asia/Tokyo');
  const db = await openFileDatabase(resolve(dataFile));
  const ctx = {
    repo: new Repo(db, clock),
    db,
    clock,
    mode: 'SOLO',
    backend: 'file',
    actor: { userId: issue.user?.login || 'github-user', role: 'ADMIN' },
  };

  const checked = [];
  for (const target of payload.targets) checked.push(await validateTarget(ctx, target));
  const groupIds = new Set(checked.map((item) => item.post.post_group_id));
  if (groupIds.size !== 1) throw new Error('異なる企画をまとめて承認できません。');

  const evidence = {
    type: 'GITHUB_ISSUE',
    repository: repository.full_name,
    issue_number: issue.number,
    url: issue.html_url,
    actor_login: issue.user?.login || null,
    author_association: issue.author_association,
    event_created_at: issue.created_at,
  };
  const options = {
    evidence,
    comment: `GitHub Issue #${issue.number} で承認`,
  };
  const componentScope = payload.component_scope ?? null;
  const otherScope = componentScope === 'CONTENT' ? 'THUMBNAIL' : 'CONTENT';
  const priorReceipts = componentScope ? await priorComponentApprovals(receiptFile) : [];
  const complete = !componentScope || hasMatchingComponent(priorReceipts, otherScope, checked);
  let results = [];
  if (!complete) {
    results = [];
  } else if (checked.length === 1) {
    const item = checked[0];
    results = [await approve(ctx, item.post.channel_post_id, {
      ...options,
      allowedRetryDelayMinutes: item.allowedRetryDelayMinutes,
    })];
  } else {
    const delays = new Set(checked.map((item) => item.allowedRetryDelayMinutes));
    if (delays.size !== 1) throw new Error('一括承認の遅延再試行時間が一致しません。');
    const groupResult = await approveGroup(ctx, checked.map((item) => item.post.channel_post_id), {
      ...options,
      allowedRetryDelayMinutes: checked[0].allowedRetryDelayMinutes,
    });
    results = groupResult.results;
  }

  const receipt = {
    contract: PUBLIC_APPROVAL_CONTRACT,
    status: complete ? 'APPROVED' : 'COMPONENT_APPROVED',
    component_scope: componentScope,
    project_title: payload.project_title ?? null,
    repository: repository.full_name,
    issue_number: issue.number,
    issue_url: issue.html_url,
    approver: issue.user?.login || null,
    approved_at: clock.nowIso(),
    approvals: checked.map((item, index) => ({
      channel_post_id: item.post.channel_post_id,
      revision_id: item.revision.revision_id,
      approval_id: results[index]?.approvalId ?? null,
      approval_basis_hash: results[index]?.approvalBasisHash ?? item.currentHash,
    })),
  };
  if (receiptFile) {
    const target = resolve(receiptFile);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  }
  return receipt;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.event || !options.dataFile) throw new Error('--event と --data-file が必要です。');
    const event = JSON.parse(await readFile(resolve(options.event), 'utf8'));
    const receipt = await processPublicApprovalIssue({
      event,
      dataFile: options.dataFile,
      receiptFile: options.receipt,
    });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
