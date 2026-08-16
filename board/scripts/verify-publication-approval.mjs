#!/usr/bin/env node

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { systemClock } from '../js/core/clock.js';
import { verifyApprovalStillValid } from '../js/services/approvals.js';
import { openFileDatabase } from '../js/store/filedb.js';
import { Repo } from '../js/store/repo.js';

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

export async function verifyPublicationApproval({ syncReceipt, dataFile }) {
  if (!Array.isArray(syncReceipt?.channel_post_ids) || syncReceipt.channel_post_ids.length === 0) {
    throw new Error('同期receiptにchannel_post_idsがありません。');
  }
  const clock = systemClock('Asia/Tokyo');
  const db = await openFileDatabase(resolve(dataFile));
  const ctx = {
    repo: new Repo(db, clock),
    db,
    clock,
    mode: 'SOLO',
    backend: 'file',
    actor: { userId: 'skill-verifier', role: 'AUDITOR' },
  };
  const items = [];
  for (const channelPostId of syncReceipt.channel_post_ids) {
    const post = await ctx.repo.getPost(channelPostId);
    if (!post) throw new Error(`同期対象がボードにありません: ${channelPostId}`);
    const group = await ctx.repo.getPostGroup(post.post_group_id);
    if (group?.package_id && group.package_id !== syncReceipt.package_id) {
      throw new Error(`同期receiptとPackageが一致しません: ${channelPostId}`);
    }
    const verdict = await verifyApprovalStillValid(ctx, channelPostId);
    items.push({
      channel_post_id: channelPostId,
      revision_id: post.current_revision_id,
      valid: verdict.valid,
      reason: verdict.reason,
      approval_id: verdict.approval?.approval_id ?? null,
      approval_basis_hash: verdict.approval?.approval_basis_hash ?? null,
      approver: verdict.approval?.approver_user_id ?? null,
      approved_at: verdict.approval?.decided_at ?? null,
      evidence: verdict.approval?.evidence ?? null,
    });
  }
  const approved = items.every((item) => item.valid && item.evidence?.type === 'GITHUB_ISSUE');
  return {
    contract: 'REIKI_POST_BOARD_APPROVAL_CHECK_V1',
    status: approved ? 'APPROVED' : 'PENDING_APPROVAL',
    package_id: syncReceipt.package_id,
    source_skill: syncReceipt.source_skill,
    idempotency_key: syncReceipt.idempotency_key,
    checked_at: clock.nowIso(),
    items,
  };
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.receipt || !options.dataFile) throw new Error('--receipt と --data-file が必要です。');
    const syncReceipt = JSON.parse(await readFile(resolve(options.receipt), 'utf8'));
    const result = await verifyPublicationApproval({ syncReceipt, dataFile: options.dataFile });
    if (options.output) {
      const target = resolve(options.output);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== 'APPROVED') process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
