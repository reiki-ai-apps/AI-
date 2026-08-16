import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { systemClock } from '../js/core/clock.js';
import { buildApprovalBasis, approvalBasisHash } from '../js/domain/approval.js';
import { openFileDatabase } from '../js/store/filedb.js';
import { Repo } from '../js/store/repo.js';
import { processPublicApprovalIssue, PUBLIC_APPROVAL_CONTRACT } from './process-public-approval-issue.mjs';
import { syncPublicationPackage } from './sync-publication-package.mjs';
import { verifyPublicationApproval } from './verify-publication-approval.mjs';

function samplePackage() {
  return {
    contract_version: '1.0',
    package_id: '10000000-0000-4000-8000-000000000001',
    tenant_id: '20000000-0000-4000-8000-000000000002',
    brand_id: 'news',
    source_skill: 'ai_news_v1',
    source_run_id: 'run-approval-test',
    source_revision: 1,
    source_artifact_id: 'artifact-approval-test',
    idempotency_key: 'ai_news_v1:approval-flow:test:1',
    submitted_at: '2026-08-16T00:00:00+09:00',
    project_title: '承認証跡テスト',
    platform_payloads: [{
      platform: 'YOUTUBE',
      title: '確認対象タイトル',
      body: '確認対象本文',
      hashtags: ['AI'],
      cta: '詳細を見る',
      visibility: 'PRIVATE',
      suggested_schedule: {
        scheduled_at: '2099-08-16T03:00:00.000Z',
        time_zone: 'Asia/Tokyo',
      },
    }],
    assets: [],
    claims: [],
    reviews: [],
    operations: { owner: 'skill-sync', approver_candidates: ['reiki'] },
  };
}

test('GitHub Issueの本人承認をRevision/Hashへ固定しスキルが証跡を検証できる', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-board-approval-'));
  const packagePath = join(dir, 'package.json');
  const dataFile = join(dir, 'board.json');
  const syncReceiptPath = join(dir, 'sync-receipt.json');
  const approvalReceiptPath = join(dir, 'approval-receipt.json');
  await writeFile(packagePath, JSON.stringify(samplePackage()), 'utf8');

  const syncReceipt = await syncPublicationPackage({
    package: packagePath,
    dataFile,
    queueForApproval: true,
    receipt: syncReceiptPath,
    actor: 'skill-sync',
  });
  assert.equal(syncReceipt.status, 'IMPORTED');
  assert.equal(syncReceipt.channel_post_ids.length, 1);

  const db = await openFileDatabase(dataFile);
  const repo = new Repo(db, systemClock('Asia/Tokyo'));
  const post = await repo.getPost(syncReceipt.channel_post_ids[0]);
  const revision = await repo.getRevision(post.current_revision_id);
  const expectedHash = await approvalBasisHash(buildApprovalBasis({
    channelPost: post,
    revision,
    schedule: { scheduled_at: post.scheduled_at, time_zone: post.time_zone },
    allowedRetryDelayMinutes: 30,
  }));
  const payload = {
    contract: PUBLIC_APPROVAL_CONTRACT,
    action: 'APPROVE',
    project_title: '承認証跡テスト',
    targets: [{
      channel_post_id: post.channel_post_id,
      revision_id: revision.revision_id,
      approval_basis_hash: expectedHash,
      allowed_retry_delay_minutes: 30,
    }],
  };
  const event = {
    repository: { full_name: 'reiki-ai-apps/AI-' },
    issue: {
      number: 42,
      html_url: 'https://github.com/reiki-ai-apps/AI-/issues/42',
      body: `確認\n<!-- ${PUBLIC_APPROVAL_CONTRACT}\n${JSON.stringify(payload)}\n-->`,
      author_association: 'MEMBER',
      created_at: '2026-08-16T01:00:00Z',
      user: { login: 'hinata2462-eng' },
    },
  };
  const approvalReceipt = await processPublicApprovalIssue({ event, dataFile, receiptFile: approvalReceiptPath });
  assert.equal(approvalReceipt.status, 'APPROVED');
  assert.equal(approvalReceipt.approvals[0].approval_basis_hash, expectedHash);

  const savedSyncReceipt = JSON.parse(await readFile(syncReceiptPath, 'utf8'));
  const verdict = await verifyPublicationApproval({ syncReceipt: savedSyncReceipt, dataFile });
  assert.equal(verdict.status, 'APPROVED');
  assert.equal(verdict.items[0].valid, true);
  assert.equal(verdict.items[0].approver, 'hinata2462-eng');
  assert.equal(verdict.items[0].evidence.type, 'GITHUB_ISSUE');
  assert.equal(verdict.items[0].evidence.issue_number, 42);
});

test('権限のないIssue作成者の承認を拒否する', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-board-approval-deny-'));
  const dataFile = join(dir, 'board.json');
  await writeFile(dataFile, JSON.stringify({ stores: {}, autoSeq: {} }), 'utf8');
  await assert.rejects(
    processPublicApprovalIssue({
      dataFile,
      event: {
        repository: { full_name: 'reiki-ai-apps/AI-' },
        issue: {
          number: 99,
          html_url: 'https://github.com/reiki-ai-apps/AI-/issues/99',
          body: `<!-- ${PUBLIC_APPROVAL_CONTRACT}\n{}\n-->`,
          author_association: 'NONE',
          user: { login: 'outsider' },
        },
      },
    }),
    /承認権限がありません/,
  );
});
