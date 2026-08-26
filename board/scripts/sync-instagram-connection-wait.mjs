#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { systemClock } from '../js/core/clock.js';
import { domainDigest } from '../js/core/digest.js';
import { assertTransition } from '../js/domain/state.js';
import { openFileDatabase } from '../js/store/filedb.js';
import { Repo } from '../js/store/repo.js';

const SNAPSHOT_DOMAIN = 'REIKI-AUDIT-SNAPSHOT-V1';

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) throw new Error(`引数が不正です: ${key ?? ''}`);
    out[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return out;
}

async function writeJson(path, value) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dataFile || !args.channelPostId || !args.doctorFile || !args.receipt) {
    throw new Error('--data-file、--channel-post-id、--doctor-file、--receipt が必要です。');
  }

  const doctor = JSON.parse(await readFile(resolve(args.doctorFile), 'utf8'));
  if (doctor.status !== 'CONNECTION_AUTH_REQUIRED') throw new Error('接続・認証待ちの診断receiptではありません。');
  if (doctor.token_present || doctor.instagram_user_id_present) throw new Error('接続情報が存在するため、再診断が必要です。');

  const clock = systemClock('Asia/Tokyo');
  const db = await openFileDatabase(resolve(args.dataFile));
  const repo = new Repo(db, clock);
  const post = await repo.getPost(args.channelPostId);
  if (!post) throw new Error('対象のInstagram投稿がありません。');
  if (post.display_state !== 'ACTION_REQUIRED') assertTransition(post.display_state, 'ACTION_REQUIRED');

  const now = clock.nowIso();
  const updated = {
    ...post,
    display_state: 'ACTION_REQUIRED',
    failure_kind: 'CREDENTIAL_EXPIRED',
    credential_expired: true,
    internal: {
      ...(post.internal ?? {}),
      memo: '現Revisionは承認済み。公式Graph APIのアクセストークンとInstagramユーザーIDが未接続のため、外部送信は未実行。',
      tags: [...new Set([...(post.internal?.tags ?? []).filter((tag) => tag !== 'media-production-partial'), 'owner-approved', 'authentication-required', 'external-publication-receipt-pending'])],
    },
    production: post.production ? {
      ...post.production,
      steps: post.production.steps.map((step) => step.id === 'i3'
        ? { ...step, done: false, label: 'Graph API接続・外部receipt', note: '接続・認証待ち。外部送信は未実行' }
        : step),
      updated_at: now,
      updated_by: 'instagram-connection-sync',
    } : post.production,
    updated_at: now,
  };

  const beforeHash = await domainDigest(SNAPSHOT_DOMAIN, post);
  const afterHash = await domainDigest(SNAPSHOT_DOMAIN, updated);
  await repo.change(['channelPosts'], async (tx, audit) => {
    await tx.put('channelPosts', updated);
    await audit({
      actor: 'instagram-connection-sync',
      target_type: 'channelPost',
      target_id: post.channel_post_id,
      action: 'connection.auth.required',
      before_hash: beforeHash,
      after_hash: afterHash,
      reason: doctor.required_action,
      revision_id: post.current_revision_id,
    });
  });

  const receipt = {
    schema_version: 'reiki-instagram-connection-board-sync.v1',
    status: 'CONNECTION_AUTH_REQUIRED',
    changed: post.display_state !== updated.display_state || !post.credential_expired,
    channel_post_id: post.channel_post_id,
    revision_id: post.current_revision_id,
    approval_id: post.approval_id,
    scheduled_at: post.scheduled_at,
    external_request_sent: false,
    external_receipt_present: false,
    required_action: doctor.required_action,
    resume_when: doctor.resume_when,
    next_check_at: doctor.next_check_at,
    synced_at: now,
  };
  await writeJson(args.receipt, receipt);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.message ?? String(error)}\n`);
  process.exitCode = 2;
});
