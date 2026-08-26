#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { systemClock } from '../js/core/clock.js';
import { openFileDatabase } from '../js/store/filedb.js';
import { Repo } from '../js/store/repo.js';
import { approve } from '../js/services/approvals.js';
import { reschedule } from '../js/services/schedule.js';
import { buildPublicComponentApproval } from '../js/ui/publicApproval.js';

function parseArgs(argv) {
  const result = { targets: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--target') result.targets.push(value);
    else if (key === '--data-file') result.dataFile = value;
    else if (key === '--receipt') result.receipt = value;
    else if (key === '--instruction') result.instruction = value;
    else if (key === '--approved-message-at') result.approvedMessageAt = value;
    else throw new Error(`不明な引数です: ${key}`);
    index += 1;
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
if (!args.dataFile || !args.receipt || args.targets.length === 0) {
  throw new Error('--data-file、--receipt、--target id|scheduled_at が必要です。');
}

const clock = systemClock('Asia/Tokyo');
const db = await openFileDatabase(resolve(args.dataFile));
const ctx = {
  repo: new Repo(db, clock), db, clock, mode: 'SOLO', backend: 'file',
  actor: { userId: 'reiki-owner', role: 'ADMIN' },
};
const approvals = [];
for (const target of args.targets) {
  const [channelPostId, scheduledAtIso] = String(target).split('|');
  if (!channelPostId || !Number.isFinite(Date.parse(scheduledAtIso))) throw new Error(`不正なtargetです: ${target}`);
  const before = await ctx.repo.getPost(channelPostId);
  if (!before || before.display_state !== 'PENDING_APPROVAL') throw new Error(`承認待ちではありません: ${channelPostId}`);
  await reschedule(ctx, channelPostId, { scheduledAtIso, timeZone: 'Asia/Tokyo' });
  const post = await ctx.repo.getPost(channelPostId);
  const revision = await ctx.repo.getRevision(post.current_revision_id);
  const group = await ctx.repo.getPostGroup(post.post_group_id);
  const content = await buildPublicComponentApproval({ group, post, revision, scope: 'CONTENT' });
  const hasImage = (revision.assets ?? []).some((asset) => String(asset.mime ?? '').startsWith('image/'));
  const thumbnail = hasImage
    ? await buildPublicComponentApproval({ group, post, revision, scope: 'THUMBNAIL' })
    : null;
  const componentApprovals = [
    { scope: 'CONTENT', approval_component_hash: content.target.approval_component_hash },
    ...(thumbnail ? [{ scope: 'THUMBNAIL', approval_component_hash: thumbnail.target.approval_component_hash }] : []),
  ];
  const result = await approve(ctx, channelPostId, {
    comment: '所有者がCodexチャット内で現行Revisionを承認。期限切れ予定は媒体曜日規則に従って安全な次回時刻へ変更。',
    evidence: {
      kind: 'CODEX_CHAT_OWNER_APPROVAL',
      instruction: args.instruction ?? 'Codexチャット内で承認',
      approved_message_at: args.approvedMessageAt ?? clock.nowIso(),
      prior_revision_id: before.current_revision_id,
      target_revision_id: revision.revision_id,
      scheduled_at: post.scheduled_at,
      component_approvals: componentApprovals,
    },
  });
  approvals.push({
    channel_post_id: channelPostId,
    platform: post.platform,
    prior_revision_id: before.current_revision_id,
    revision_id: revision.revision_id,
    scheduled_at: post.scheduled_at,
    approval_id: result.approvalId,
    approval_basis_hash: result.approvalBasisHash,
    component_approvals: componentApprovals,
  });
}

const receipt = {
  schema_version: 'reiki-board-chat-approval.v1',
  decision: 'APPROVED_CURRENT_REVISIONS',
  approved_at: clock.nowIso(),
  approvals,
  external_reservation_executed: false,
  external_publication_executed: false,
};
const receiptPath = resolve(args.receipt);
await mkdir(dirname(receiptPath), { recursive: true });
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
