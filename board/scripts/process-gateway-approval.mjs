#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { systemClock } from '../js/core/clock.js';
import { computeApprovalComponentHash } from '../js/domain/approval.js';
import { approve, recordComponentApproval, verifyComponentApprovals } from '../js/services/approvals.js';
import { openFileDatabase } from '../js/store/filedb.js';
import { Repo } from '../js/store/repo.js';

export const GATEWAY_APPROVAL_CONTRACT = 'REIKI_BOARD_GATEWAY_APPROVAL_V1';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) throw new Error(`不明な引数です: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} の値がありません。`);
    result[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  return result;
}

function gatewayRecord(event) {
  if (event?.repository?.full_name !== 'reiki-ai-apps/AI-') throw new Error('対象リポジトリが一致しません。');
  const record = event?.client_payload?.approval;
  if (record?.contract !== GATEWAY_APPROVAL_CONTRACT || record?.action !== 'APPROVE_COMPONENT') {
    throw new Error('対応していない直接承認データです。');
  }
  if (!['CONTENT', 'THUMBNAIL'].includes(record.component_scope)) throw new Error('承認対象の区分が不正です。');
  if (!record.request_id || !record.device_fingerprint || !record.target) throw new Error('承認証跡が不足しています。');
  return record;
}

async function writeJson(path, value) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function processGatewayApproval({ event, dataFile, receiptFile }) {
  const record = gatewayRecord(event);
  const clock = systemClock('Asia/Tokyo');
  const db = await openFileDatabase(resolve(dataFile));
  const ctx = {
    repo: new Repo(db, clock),
    db,
    clock,
    mode: 'SOLO',
    backend: 'file',
    actor: { userId: 'reiki-owner-device', role: 'ADMIN' },
  };
  const post = await ctx.repo.getPost(record.target.channel_post_id);
  if (!post || post.deleted_at) throw new Error('承認対象の投稿がありません。');
  if (post.current_revision_id !== record.target.revision_id) throw new Error('Revisionが更新されています。');

  if (post.display_state === 'SCHEDULED' && post.approval_id) {
    const receipt = {
      contract: GATEWAY_APPROVAL_CONTRACT,
      status: 'ALREADY_APPROVED',
      request_id: record.request_id,
      channel_post_id: post.channel_post_id,
      revision_id: post.current_revision_id,
      approval_id: post.approval_id,
      processed_at: clock.nowIso(),
    };
    if (receiptFile) await writeJson(receiptFile, receipt);
    return receipt;
  }
  if (post.display_state !== 'PENDING_APPROVAL') throw new Error(`承認待ちではありません: ${post.display_state}`);

  const revision = await ctx.repo.getRevision(post.current_revision_id);
  if (!revision) throw new Error('承認対象のRevisionがありません。');
  const retryDelayMinutes = Number(record.target.allowed_retry_delay_minutes);
  if (!Number.isInteger(retryDelayMinutes) || retryDelayMinutes < 0 || retryDelayMinutes > 1440) {
    throw new Error('許可遅延時間が不正です。');
  }
  const currentHash = await computeApprovalComponentHash({
    channelPost: post,
    revision,
    schedule: { scheduled_at: post.scheduled_at, time_zone: post.time_zone },
    componentScope: record.component_scope,
    allowedRetryDelayMinutes: retryDelayMinutes,
  });
  if (currentHash !== record.target.approval_component_hash) throw new Error('承認対象Hashが一致しません。');

  const evidence = {
    type: 'CLOUDFLARE_APPROVAL_GATEWAY',
    request_id: record.request_id,
    received_at: record.received_at,
    device_fingerprint: record.device_fingerprint,
    component_scope: record.component_scope,
  };
  const componentResult = await recordComponentApproval(ctx, post.channel_post_id, {
    componentScope: record.component_scope,
    expectedHash: currentHash,
    allowedRetryDelayMinutes: retryDelayMinutes,
    evidence,
    comment: `Boardの承認ボタンで${record.component_scope}を承認`,
  });
  const verdict = await verifyComponentApprovals(ctx, post.channel_post_id);
  const approvalResult = verdict.valid
    ? await approve(ctx, post.channel_post_id, {
        allowedRetryDelayMinutes: retryDelayMinutes,
        comment: 'Boardの承認ボタンで公開直前承認が成立',
        evidence: { type: 'CLOUDFLARE_APPROVAL_GATEWAY_PAIR', components: verdict.components },
      })
    : null;
  const receipt = {
    contract: GATEWAY_APPROVAL_CONTRACT,
    status: verdict.valid ? 'APPROVED' : 'COMPONENT_APPROVED',
    request_id: record.request_id,
    channel_post_id: post.channel_post_id,
    revision_id: revision.revision_id,
    component_scope: record.component_scope,
    component_approval_id: componentResult.approvalId,
    component_approval_hash: currentHash,
    component_approvals: verdict.components,
    approval_id: approvalResult?.approvalId ?? null,
    approval_basis_hash: approvalResult?.approvalBasisHash ?? null,
    processed_at: clock.nowIso(),
  };
  if (receiptFile) await writeJson(receiptFile, receipt);
  return receipt;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.event || !options.dataFile) throw new Error('--event と --data-file が必要です。');
  const event = JSON.parse(await readFile(resolve(options.event), 'utf8'));
  const receipt = await processGatewayApproval({
    event,
    dataFile: options.dataFile,
    receiptFile: options.receipt,
  });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 2;
  });
}
