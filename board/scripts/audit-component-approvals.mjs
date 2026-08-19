#!/usr/bin/env node

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { systemClock } from '../js/core/clock.js';
import { verifyComponentApprovals } from '../js/services/approvals.js';
import { openFileDatabase } from '../js/store/filedb.js';
import { Repo } from '../js/store/repo.js';

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`${key ?? '引数'} の値がありません。`);
    out[key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  return out;
}

export async function auditComponentApprovals({ dataFile }) {
  const clock = systemClock('Asia/Tokyo');
  const db = await openFileDatabase(resolve(dataFile));
  const ctx = {
    repo: new Repo(db, clock), db, clock, mode: 'SOLO', backend: 'file',
    actor: { userId: 'component-approval-auditor', role: 'AUDITOR' },
  };
  const snapshot = JSON.parse(await readFile(resolve(dataFile), 'utf8'));
  const posts = (snapshot.stores?.channelPosts ?? []).filter((post) => !post.deleted_at && post.requires_component_approvals);
  const items = [];
  for (const post of posts) {
    const verdict = await verifyComponentApprovals(ctx, post.channel_post_id);
    items.push({
      channel_post_id: post.channel_post_id,
      platform: post.platform,
      scheduled_at: post.scheduled_at,
      revision_id: post.current_revision_id,
      valid: verdict.valid,
      components: Object.fromEntries(Object.entries(verdict.components).map(([scope, state]) => [scope, {
        valid: state.valid,
        approval_id: state.approval?.approval_id ?? null,
        approved_at: state.approval?.decided_at ?? null,
        revision_id: state.approval?.revision_id ?? null,
        hash: state.approval?.approval_basis_hash ?? state.currentHash,
        evidence_url: state.approval?.evidence?.url ?? null,
      }])),
    });
  }
  return {
    contract: 'REIKI_COMPONENT_APPROVAL_AUDIT_V1',
    checked_at: clock.nowIso(),
    total: items.length,
    fully_approved: items.filter((item) => item.valid).length,
    pending: items.filter((item) => !item.valid).length,
    items,
  };
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.dataFile) throw new Error('--data-file が必要です。');
    const result = await auditComponentApprovals({ dataFile: options.dataFile });
    if (options.output) {
      await mkdir(dirname(resolve(options.output)), { recursive: true });
      await writeFile(resolve(options.output), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
