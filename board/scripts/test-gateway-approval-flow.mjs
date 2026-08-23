import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { systemClock } from '../js/core/clock.js';
import { computeApprovalComponentHash } from '../js/domain/approval.js';
import { openFileDatabase } from '../js/store/filedb.js';
import { Repo } from '../js/store/repo.js';
import { processGatewayApproval, GATEWAY_APPROVAL_CONTRACT } from './process-gateway-approval.mjs';
import { syncPublicationPackage } from './sync-publication-package.mjs';

test('直接承認は2部品が揃った時だけ投稿承認を成立させる', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'post-board-gateway-approval-'));
  const packagePath = join(dir, 'package.json');
  const dataFile = join(dir, 'board.json');
  await writeFile(packagePath, JSON.stringify({
    contract_version: '1.0',
    package_id: '10000000-0000-4000-8000-000000000001',
    tenant_id: '20000000-0000-4000-8000-000000000002',
    brand_id: 'news',
    source_skill: 'ai_news_v1',
    source_run_id: 'gateway-approval-test',
    source_revision: 1,
    source_artifact_id: 'gateway-approval-artifact',
    idempotency_key: 'gateway-approval-test:1',
    submitted_at: '2026-08-23T00:00:00+09:00',
    project_title: '直接承認テスト',
    platform_payloads: [{
      platform: 'NOTE',
      title: '確認対象タイトル',
      body: '確認対象本文',
      hashtags: ['AI'],
      cta: '詳細を見る',
      visibility: 'PUBLIC',
      suggested_schedule: { scheduled_at: '2099-08-23T03:00:00.000Z', time_zone: 'Asia/Tokyo' },
    }],
    assets: [],
    claims: [],
    reviews: [],
    operations: {
      owner: 'test', approver_candidates: ['reiki'], separate_content_thumbnail_approval: true,
    },
  }), 'utf8');
  const synced = await syncPublicationPackage({
    package: packagePath, dataFile, queueForApproval: true, actor: 'test',
  });
  const repo = new Repo(await openFileDatabase(dataFile), systemClock('Asia/Tokyo'));
  const post = await repo.getPost(synced.channel_post_ids[0]);
  const revision = await repo.getRevision(post.current_revision_id);
  const eventFor = async (scope, requestId) => {
    const hash = await computeApprovalComponentHash({
      channelPost: post,
      revision,
      schedule: { scheduled_at: post.scheduled_at, time_zone: post.time_zone },
      componentScope: scope,
      allowedRetryDelayMinutes: 30,
    });
    return {
      repository: { full_name: 'reiki-ai-apps/AI-' },
      client_payload: {
        approval: {
          contract: GATEWAY_APPROVAL_CONTRACT,
          action: 'APPROVE_COMPONENT',
          component_scope: scope,
          request_id: requestId,
          received_at: '2026-08-23T00:00:00.000Z',
          device_fingerprint: 'owner-device-test',
          target: {
            channel_post_id: post.channel_post_id,
            revision_id: revision.revision_id,
            approval_component_hash: hash,
            allowed_retry_delay_minutes: 30,
          },
        },
      },
    };
  };
  const first = await processGatewayApproval({ event: await eventFor('CONTENT', 'content-request'), dataFile });
  assert.equal(first.status, 'COMPONENT_APPROVED');
  assert.equal((await repo.getPost(post.channel_post_id)).display_state, 'PENDING_APPROVAL');
  const second = await processGatewayApproval({ event: await eventFor('THUMBNAIL', 'thumbnail-request'), dataFile });
  assert.equal(second.status, 'APPROVED');
  assert.ok(second.approval_id);
  const refreshedRepo = new Repo(await openFileDatabase(dataFile), systemClock('Asia/Tokyo'));
  assert.equal((await refreshedRepo.getPost(post.channel_post_id)).display_state, 'SCHEDULED');
});
