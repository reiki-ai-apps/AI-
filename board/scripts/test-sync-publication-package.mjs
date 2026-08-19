import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { syncPublicationPackage } from './sync-publication-package.mjs';

const ZERO_DIGEST = '0'.repeat(64);

function publicationPackage({ sourceSkill, brandId, idempotencyKey, title, omitTenant = false }) {
  return {
    contract_version: '1.0',
    package_id: crypto.randomUUID(),
    ...(omitTenant ? {} : { tenant_id: '11111111-1111-4111-8111-111111111111' }),
    brand_id: brandId,
    source_skill: sourceSkill,
    source_run_id: `${sourceSkill}-2026-08-15`,
    idempotency_key: idempotencyKey,
    request_digest: ZERO_DIGEST,
    submitted_at: '2026-08-15T01:00:00.000Z',
    project_title: title,
    platform_payloads: [
      {
        platform: 'X',
        title,
        body: `${title} の投稿本文`,
        hashtags: ['AI'],
        cta: '詳しく見る',
        suggested_schedule: {
          scheduled_at: '2026-08-16T03:00:00.000Z',
          time_zone: 'Asia/Tokyo',
        },
      },
    ],
    assets: [],
    claims: [
      {
        claim_id: `${sourceSkill}-claim-1`,
        source_url: 'https://example.com/source',
        verified_at: '2026-08-15T00:30:00.000Z',
        epistemic_status: 'VERIFIED',
      },
    ],
    reviews: [
      { review_type: 'QUALITY', verdict: 'PASS' },
    ],
    operations: { owner: 'skill-sync', approver_candidates: ['reiki'] },
  };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('素材を公開領域へコピーしURL・役割をBoardへ保存する', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reiki-board-media-'));
  const packagePath = join(dir, 'publication-package.json');
  const dataPath = join(dir, 'data', 'board.json');
  const mediaDir = join(dir, 'media');
  const imagePath = join(dir, 'thumbnail.png');
  const bytes = Buffer.from('test-image-bytes');
  await writeFile(imagePath, bytes);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Buffer.from(digest).toString('hex');
  const pkg = publicationPackage({ sourceSkill: 'ai_news_v1', brandId: 'news', idempotencyKey: 'ai_news_v1:media:2026-08-20', title: '素材同期テスト' });
  pkg.assets = [{ asset_id: crypto.randomUUID(), sha256, mime: 'image/png', bytes: bytes.length,
    rights_status: 'OWNED', archive_member: 'thumbnail.png', order: 1, alt_text: '確認用サムネイル' }];
  await writeJson(packagePath, pkg);

  const result = await syncPublicationPackage({ package: packagePath, dataFile: dataPath,
    publicMediaDir: mediaDir, publicMediaBaseUrl: 'https://example.test/board/media', queueForApproval: true,
    actor: 'skill-sync-test' });
  assert.equal(result.status, 'IMPORTED');
  const board = JSON.parse(await readFile(dataPath, 'utf8'));
  const asset = board.stores.postRevisions[0].assets[0];
  assert.equal(asset.asset_role, 'THUMBNAIL');
  assert.match(asset.public_url, /^https:\/\/example\.test\/board\/media\//);
  await stat(join(mediaDir, pkg.package_id, '01-thumbnail.png'));
});

for (const scenario of [
  { sourceSkill: 'ai_news_v1', brandId: 'news', title: 'KIZASHI AIニュース' },
  { sourceSkill: 'ai_creative_v1', brandId: 'creative', title: 'REIKI AIクリエイティブ', omitTenant: true },
]) {
  test(`${scenario.sourceSkill} を冪等に同期し承認待ちへ送る`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reiki-board-sync-'));
    const packagePath = join(dir, 'publication-package.json');
    const dataPath = join(dir, 'board.json');
    const receiptPath = join(dir, 'receipt.json');
    const pkg = publicationPackage({
      ...scenario,
      idempotencyKey: `${scenario.sourceSkill}:content:revision:2026-08-15`,
    });
    await writeJson(packagePath, pkg);

    const previousTenant = process.env.REIKI_POST_BOARD_TENANT_ID;
    if (scenario.omitTenant) {
      process.env.REIKI_POST_BOARD_TENANT_ID = '11111111-1111-4111-8111-111111111111';
    }

    try {
      const first = await syncPublicationPackage({
        package: packagePath,
        dataFile: dataPath,
        receipt: receiptPath,
        queueForApproval: true,
        actor: 'skill-sync-test',
      });
      assert.equal(first.status, 'IMPORTED');
      assert.equal(first.channel_post_ids.length, 1);
      assert.deepEqual(first.queued_for_approval, first.channel_post_ids);

      const second = await syncPublicationPackage({
        package: packagePath,
        dataFile: dataPath,
        queueForApproval: true,
        actor: 'skill-sync-test',
      });
      assert.equal(second.status, 'REPLAYED');
      assert.equal(second.changed, false);

      const board = JSON.parse(await readFile(dataPath, 'utf8'));
      assert.equal(board.stores.publicationPackages.length, 1);
      assert.equal(board.stores.channelPosts.length, 1);
      assert.equal(board.stores.channelPosts[0].display_state, 'PENDING_APPROVAL');

      const savedReceipt = JSON.parse(await readFile(receiptPath, 'utf8'));
      assert.equal(savedReceipt.package_id, pkg.package_id);
      assert.equal(Object.hasOwn(savedReceipt, 'token'), false);
    } finally {
      if (previousTenant === undefined) delete process.env.REIKI_POST_BOARD_TENANT_ID;
      else process.env.REIKI_POST_BOARD_TENANT_ID = previousTenant;
    }
  });
}
