#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { systemClock } from '../js/core/clock.js';
import { computeApprovalComponentHash } from '../js/domain/approval.js';
import { approve, recordComponentApproval, verifyComponentApprovals } from '../js/services/approvals.js';
import { openFileDatabase } from '../js/store/filedb.js';
import { Repo } from '../js/store/repo.js';

const QUEUE_CONTRACT = 'REIKI_BOARD_GATEWAY_QUEUE_V1';
const APPROVAL_CONTRACT = 'REIKI_BOARD_GATEWAY_APPROVAL_V1';

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

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

function receiptPath(directory, requestId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(requestId ?? ''))) throw new Error('request_idが不正です。');
  return join(resolve(directory), `gateway-${requestId}.json`);
}

async function applyRecord(ctx, record) {
  if (record?.contract !== APPROVAL_CONTRACT || record?.action !== 'APPROVE_COMPONENT') throw new Error('承認契約が不正です。');
  if (!['CONTENT', 'THUMBNAIL'].includes(record.component_scope)) throw new Error('承認区分が不正です。');
  const target = record.target ?? {};
  const post = await ctx.repo.getPost(target.channel_post_id);
  if (!post || post.deleted_at) throw new Error('対象投稿がありません。');
  if (post.display_state === 'SCHEDULED' || post.display_state === 'PUBLISHED') {
    return { status: 'ALREADY_APPROVED', post, component: null, verdict: null, final: null };
  }
  if (post.display_state !== 'PENDING_APPROVAL') throw new Error(`承認待ちではありません: ${post.display_state}`);
  if (post.current_revision_id !== target.revision_id) throw new Error('Revisionが更新されています。');
  const revision = await ctx.repo.getRevision(post.current_revision_id);
  if (!revision) throw new Error('Revisionが見つかりません。');
  const currentHash = await computeApprovalComponentHash({
    channelPost: post,
    revision,
    schedule: { scheduled_at: post.scheduled_at, time_zone: post.time_zone },
    componentScope: record.component_scope,
    allowedRetryDelayMinutes: target.allowed_retry_delay_minutes,
  });
  if (currentHash !== target.approval_component_hash) throw new Error('Revision/Hashが現在の成果物と一致しません。');
  const evidence = {
    type: 'CLOUDFLARE_DEVICE_APPROVAL',
    request_id: record.request_id,
    received_at: record.received_at,
    device_fingerprint: record.device_fingerprint,
  };
  const component = await recordComponentApproval(ctx, post.channel_post_id, {
    componentScope: record.component_scope,
    expectedHash: currentHash,
    allowedRetryDelayMinutes: target.allowed_retry_delay_minutes,
    evidence,
    comment: `Board登録済み端末から${record.component_scope}を承認`,
  });
  const verdict = await verifyComponentApprovals(ctx, post.channel_post_id);
  const final = verdict.valid ? await approve(ctx, post.channel_post_id, {
    allowedRetryDelayMinutes: target.allowed_retry_delay_minutes,
    evidence: { ...evidence, type: 'CLOUDFLARE_DEVICE_APPROVAL_PAIR', components: verdict.components },
    comment: '記事・動画とサムネイルの両承認が成立',
  }) : null;
  return { status: final ? 'APPROVED_AND_SCHEDULED' : 'COMPONENT_APPROVED', post, component, verdict, final };
}

export async function processApprovalGateway({ queueFile, dataFile, receiptDirectory }) {
  const queue = JSON.parse(await readFile(resolve(queueFile), 'utf8'));
  if (queue?.contract !== QUEUE_CONTRACT || !Array.isArray(queue.approvals)) throw new Error('承認キューが不正です。');
  const clock = systemClock('Asia/Tokyo');
  const db = await openFileDatabase(resolve(dataFile));
  const ctx = {
    repo: new Repo(db, clock), db, clock, mode: 'SOLO', backend: 'file',
    actor: { userId: 'owner-device', role: 'ADMIN' },
  };
  await mkdir(resolve(receiptDirectory), { recursive: true });
  const results = [];
  for (const record of [...queue.approvals].sort((left, right) => String(left.received_at).localeCompare(String(right.received_at)))) {
    let output;
    const path = receiptPath(receiptDirectory, record.request_id);
    if (await exists(path)) {
      results.push({ request_id: record.request_id, status: 'PREVIOUSLY_PROCESSED' });
      continue;
    }
    try {
      const applied = await applyRecord(ctx, record);
      output = {
        contract: 'REIKI_BOARD_GATEWAY_RECEIPT_V1',
        request_id: record.request_id,
        processed_at: clock.nowIso(),
        status: applied.status,
        component_scope: record.component_scope,
        channel_post_id: record.target?.channel_post_id,
        revision_id: record.target?.revision_id,
        approval_component_hash: record.target?.approval_component_hash,
        component_approval_id: applied.component?.approvalId ?? null,
        final_approval_id: applied.final?.approvalId ?? null,
        schedule_id: applied.final?.scheduleId ?? null,
      };
    } catch (error) {
      output = {
        contract: 'REIKI_BOARD_GATEWAY_RECEIPT_V1',
        request_id: record.request_id,
        processed_at: clock.nowIso(),
        status: 'REJECTED',
        reason: error?.message ?? String(error),
        component_scope: record.component_scope ?? null,
        channel_post_id: record.target?.channel_post_id ?? null,
        revision_id: record.target?.revision_id ?? null,
      };
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    results.push({ request_id: record.request_id, status: output.status });
  }
  return { contract: 'REIKI_BOARD_GATEWAY_BATCH_V1', processed_at: clock.nowIso(), results };
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.queue || !options.dataFile || !options.receiptDir) throw new Error('--queue、--data-file、--receipt-dir が必要です。');
    const result = await processApprovalGateway({
      queueFile: options.queue,
      dataFile: options.dataFile,
      receiptDirectory: options.receiptDir,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error?.message ?? String(error)}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();

