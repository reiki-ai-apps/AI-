#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { systemClock } from '../js/core/clock.js';
import {
  approve,
  recordComponentApproval,
  requiredApprovalComponents,
  verifyComponentApprovals,
} from '../js/services/approvals.js';
import { openFileDatabase } from '../js/store/filedb.js';
import { Repo } from '../js/store/repo.js';

const EXPECTED_PLATFORMS = Object.freeze(['INSTAGRAM', 'NOTE', 'X', 'YOUTUBE', 'YOUTUBE_SHORTS']);

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`${key ?? '引数'} の値がありません。`);
    result[key.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
  }
  return result;
}

export async function approveOwnerConfirmed({ dataFile, receiptFile, date, statement, expectedCount = 5 }) {
  if (!dataFile || !receiptFile || !date || !statement) {
    throw new Error('--data-file、--receipt、--date、--statement が必要です。');
  }
  const count = Number(expectedCount);
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('--expected-count が不正です。');

  const target = resolve(dataFile);
  const clock = systemClock('Asia/Tokyo');
  const db = await openFileDatabase(target);
  const repo = new Repo(db, clock);
  const ctx = {
    repo,
    db,
    clock,
    mode: 'SOLO',
    backend: 'file',
    actor: { userId: 'owner', role: 'ADMIN' },
  };

  const snapshot = JSON.parse(await readFile(target, 'utf8'));
  const posts = (snapshot.stores?.channelPosts ?? [])
    .filter((post) => !post.deleted_at
      && post.calendar_date_key === date
      && post.display_state === 'PENDING_APPROVAL'
      && post.requires_component_approvals)
    .sort((left, right) => left.platform.localeCompare(right.platform));

  if (posts.length !== count) {
    throw new Error(`${date} の承認対象は${count}件の想定ですが、${posts.length}件でした。`);
  }
  const platforms = posts.map((post) => post.platform).sort();
  if (count === EXPECTED_PLATFORMS.length
    && JSON.stringify(platforms) !== JSON.stringify([...EXPECTED_PLATFORMS].sort())) {
    throw new Error(`承認対象媒体が一致しません: ${platforms.join(', ')}`);
  }

  const approvedAt = clock.nowIso();
  const evidenceBase = {
    type: 'CODEX_OWNER_CONFIRMATION',
    source: 'codex-task',
    owner_statement: statement,
    confirmed_at: approvedAt,
    target_date: date,
  };
  const approvals = [];

  for (const selected of posts) {
    const before = await repo.getPost(selected.channel_post_id);
    const revision = await repo.getRevision(before.current_revision_id);
    if (!revision) throw new Error(`Revisionが見つかりません: ${before.current_revision_id}`);

    const componentResults = {};
    for (const componentScope of requiredApprovalComponents(before, revision)) {
      componentResults[componentScope] = await recordComponentApproval(ctx, before.channel_post_id, {
        componentScope,
        evidence: { ...evidenceBase, component_scope: componentScope },
        comment: `所有者が「${statement}」と明示承認`,
      });
    }

    const verdict = await verifyComponentApprovals(ctx, before.channel_post_id);
    if (!verdict.valid) throw new Error(`${before.platform} の二重承認が成立しませんでした。`);

    const final = await approve(ctx, before.channel_post_id, {
      evidence: {
        ...evidenceBase,
        type: 'CODEX_OWNER_CONFIRMATION_PAIR',
        component_approval_ids: Object.fromEntries(
          Object.entries(componentResults).map(([scope, result]) => [scope, result.approvalId]),
        ),
      },
      comment: `所有者が「${statement}」と明示承認。公開予定へ移行`,
    });

    approvals.push({
      channel_post_id: before.channel_post_id,
      platform: before.platform,
      scheduled_at: before.scheduled_at,
      revision_id: revision.revision_id,
      revision_no: revision.revision_no,
      content: {
        approval_id: componentResults.CONTENT.approvalId,
        hash: verdict.components.CONTENT.currentHash,
      },
      thumbnail: componentResults.THUMBNAIL ? {
        approval_id: componentResults.THUMBNAIL.approvalId,
        hash: verdict.components.THUMBNAIL.currentHash,
      } : null,
      final_approval_id: final.approvalId,
      final_approval_hash: final.approvalBasisHash,
      schedule_id: final.scheduleId,
      resulting_state: (await repo.getPost(before.channel_post_id)).display_state,
    });
  }

  const receipt = {
    contract: 'REIKI_OWNER_CONFIRMATION_RECEIPT_V1',
    status: 'APPROVED_AND_SCHEDULED',
    approved_at: approvedAt,
    owner_statement: statement,
    target_date: date,
    count: approvals.length,
    approvals,
  };
  await mkdir(dirname(resolve(receiptFile)), { recursive: true });
  await writeFile(resolve(receiptFile), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return receipt;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const receipt = await approveOwnerConfirmed({
      dataFile: options.dataFile,
      receiptFile: options.receipt,
      date: options.date,
      statement: options.statement,
      expectedCount: options.expectedCount ?? '5',
    });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error?.message ?? String(error)}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
