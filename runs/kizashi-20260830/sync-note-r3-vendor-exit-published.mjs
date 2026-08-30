import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('.');
const runDir = resolve(root, 'runs/kizashi-20260830');
const rewriteDir = resolve(runDir, 'note-rewrite-r3');
const jobDir = resolve(rewriteDir, 'vendor-exit');
const statusPath = resolve(root, 'board/data/status.json');
const boardPath = resolve(root, 'board/data/board.json');
const runPath = resolve(runDir, 'run.json');
const gatePath = resolve(runDir, 'gate.json');
const rewriteGatePath = resolve(rewriteDir, 'gate.json');
const receiptPath = resolve(jobDir, 'note-publication-receipt-r3.json');
const receiptRelative = 'runs/kizashi-20260830/note-rewrite-r3/vendor-exit/note-publication-receipt-r3.json';
const publishedAt = '2026-08-30T16:17:41+09:00';
const secondEarliestAt = '2026-08-30T20:17:41+09:00';
const publicUrl = 'https://note.com/natty_swan9072/n/n09540acd5c5a';
const syncedAt = new Date().toISOString();

async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function writeJson(file, value, pretty = true) { await writeFile(file, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, 'utf8'); }

const receipt = {
  schema_version: 'reiki-external-publication-receipt.v1',
  status: 'PUBLISHED',
  platform: 'NOTE',
  run_id: 'kizashi-20260830',
  revision: 3,
  job_id: 'vendor-exit',
  content_id: 'kizashi-20260830-note-vendor-exit-r3',
  article_hash: '0872c2e32d5db034b88aa62e0cd89acaa2e1c67f9faa6c7b1c6bd134195e09f8',
  thumbnail_hash: '0144ab47e70ff35fc9ca2d1a5934324993f8b2171ff069814aff5af64dd9347c',
  approval_id: 'd04c145c-5a53-4c0b-99aa-a36433aeb628',
  owner_approval_valid_at_publish: true,
  account: 'natty_swan9072',
  external_post_id: 'n09540acd5c5a',
  public_url: publicUrl,
  published_at: publishedAt,
  verified_at: syncedAt,
  price_jpy: 100,
  purchase_status: 'UNAVAILABLE',
  inferred_zero: false,
  paid_boundary: {
    status: 'VERIFIED',
    immediately_before_heading: '成果物1：依存関係台帳',
    free_area_marker_visible: true,
  },
  visuals: {
    cover_verified: true,
    inline_image_count: 6,
    free_area_inline_images: 2,
    paid_area_inline_images: 4,
  },
  external_page_checks: {
    title: 'PASS',
    account: 'PASS',
    price_100_jpy: 'PASS',
    paid_boundary: 'PASS',
    cover: 'PASS',
    inline_images: 'PASS',
    official_primary_links: 4,
  },
  tags: ['AI', '生成AI', '業務改善', 'リスク管理'],
  magazine: 'KIZASHI',
  second_article_earliest_publish_at: secondEarliestAt,
  duplicate_retry_performed: false,
};
await writeJson(receiptPath, receipt);

const run = await readJson(runPath);
run.stage = 'YouTube Shorts 1/1公開／note 1/2公開・2本目は20:17以降／X・Instagram接続待ち';
run.reason = 'note Revision 3第1記事を100円で公開し、外部ID・URL・価格・有料境界・カバー・本文6図版・一次情報リンクを検証した。第2記事は4時間間隔を守り20:17:41 JST以降に公開する。';
await writeJson(runPath, run);

const gate = await readJson(gatePath);
gate.checked_at = syncedAt;
gate.status = 'PASS';
gate.passed = true;
gate.reason = 'note Revision 3第1記事の外部公開receipt取得済み。100円・有料境界・6図版・一次情報リンクを検証し、第2記事は4時間間隔待ち。';
gate.checks.external_publish_receipts = true;
gate.checks.external_publish_receipt_count = 1;
gate.checks.note_price_policy_jpy = 100;
gate.checks.note_purchase_status = 'UNAVAILABLE';
await writeJson(gatePath, gate);

const rewriteGate = await readJson(rewriteGatePath);
rewriteGate.status = 'PASS';
rewriteGate.external_action_allowed = true;
rewriteGate.external_publication_receipts = [receiptRelative];
rewriteGate.external_publication_receipt_count = 1;
rewriteGate.second_article_earliest_publish_at = secondEarliestAt;
rewriteGate.checked_at = syncedAt;
await writeJson(rewriteGatePath, rewriteGate);

const status = await readJson(statusPath);
status.generated_at = syncedAt;
status.today.next_action = 'note第2記事は20:17:41 JST以降に100円で公開する。それまでX・Instagramの安全な接続診断と投稿準備を継続する。';
const todayNote = status.today.channels.find((item) => item.id === 'note');
if (Number(todayNote.done || 0) < 1) {
  status.today.completed = Number(status.today.completed || 0) + 1;
  status.summary.published_confirmed = Number(status.summary.published_confirmed || 0) + 1;
}
Object.assign(todayNote, {
  done: 1,
  state: 'PUBLISHED',
  status: '1/2公開済み／第2記事は20:17:41 JST以降',
  next: '第2記事を4時間間隔後に100円で公開し、外部receiptを取得',
  blocker: '4時間間隔待ち。外部障害ではない',
});
status.today.headline = '8月30日（日曜）は2/7件公開。YouTube Shorts 1/1、note 1/2公開済み。note第2記事は4時間間隔後、X・Instagramは接続待ち。';
const noteChannel = status.channels.find((item) => item.id === 'note');
noteChannel.last_verified_at = syncedAt;
noteChannel.latest_published = {
  title: 'AIモデル供給停止に備える「切替設計」実務キット｜期限から逆算する5つの成果物',
  url: publicUrl,
};
noteChannel.note = `Revision 3第1記事を100円で公開済み: ${publicUrl}。外部ID、価格、有料境界、カバー、本文6図版を確認。販売管理はUNAVAILABLEで0と推測しない。`;
status.production.last_run.stage = 'YouTube Shorts 1/1公開／note 1/2公開・第2記事4時間間隔待ち';
status.production.last_run.next_action = 'note第2記事を20:17:41 JST以降に100円で公開し、外部表示とreceiptを検証する。';
status.monitoring.last_checked_at = syncedAt;
status.evidence = [receiptRelative, ...status.evidence.filter((item) => item !== receiptRelative)];
await writeJson(statusPath, status, false);

const board = await readJson(boardPath);
const group = board.stores.postGroups.find((item) => item.source_run_id === 'kizashi-20260830');
const notePost = board.stores.channelPosts.find((item) => item.post_group_id === group.post_group_id && item.platform === 'NOTE');
group.project_title = '2026-08-30｜YouTube Shorts 1/1公開／note 1/2公開・第2記事20:17以降／X・Instagram接続待ち';
group.updated_at = syncedAt;
group.internal.memo = 'note第1記事は100円で外部公開・検証済み。第2記事は4時間間隔後に進める。';
Object.assign(notePost, {
  display_state: 'PUBLISHED',
  title: 'note 1/2｜1本目公開済み・2本目は20:17以降',
  published_at: publishedAt,
  public_url: publicUrl,
  external_post_id: 'n09540acd5c5a',
  failure_kind: null,
  updated_at: syncedAt,
});
notePost.internal.memo = '第1記事を100円で公開し、外部ID・URL・価格・有料境界・カバー・本文6図版・一次情報リンク4件を確認。販売管理はUNAVAILABLE。第2記事は20:17:41 JST以降。';
notePost.internal.tags = [...new Set([...notePost.internal.tags, 'external-publish-verified', 'note-1-of-2-published', 'price-100-jpy'])];
notePost.production.updated_at = syncedAt;
notePost.production.updated_by = 'kizashi-note-r3-publication-sync';
const publishStep = notePost.production.steps.find((item) => item.id === 'note30r3_4');
if (publishStep) {
  publishStep.done = false;
  publishStep.note = '1/2公開済み。第1記事: n09540acd5c5a、100円、有料境界・6図版確認。第2記事は20:17:41 JST以降。';
}
notePost.production.release_gate = {
  ...notePost.production.release_gate,
  status: 'PASS',
  owner_approval_valid: true,
  external_receipts: 1,
  latest_external_receipt: receiptRelative,
};
notePost.production.publications = [
  {
    job_id: 'vendor-exit',
    external_post_id: 'n09540acd5c5a',
    public_url: publicUrl,
    published_at: publishedAt,
    price_jpy: 100,
    receipt: receiptRelative,
    verified: true,
  },
];
notePost.production.second_article_earliest_publish_at = secondEarliestAt;

const auditId = 'k30-note-r3-vendor-exit-published';
if (!board.stores.auditEvents.some((item) => item.audit_event_id === auditId)) {
  board.stores.auditEvents.push({
    audit_event_id: auditId,
    brand_id: 'news',
    actor_user_id: 'kizashi-note-r3-publication',
    action: 'EXTERNAL_NOTE_PUBLICATION_VERIFIED',
    entity_type: 'CHANNEL_POST',
    entity_id: notePost.channel_post_id,
    before_json: { revision: 3, state: 'EXTERNAL_WAIT', published: '0/2', external_receipts: 0 },
    after_json: { revision: 3, state: 'PUBLISHED', published: '1/2', external_post_id: 'n09540acd5c5a', price_jpy: 100, external_receipts: 1, receipt: receiptRelative },
    created_at: syncedAt,
  });
  if (board.autoSeq && Number.isFinite(Number(board.autoSeq.auditEvents))) board.autoSeq.auditEvents = Number(board.autoSeq.auditEvents) + 1;
}
await writeJson(boardPath, board, false);

console.log(JSON.stringify({
  status: 'SYNCED_PUBLISHED_1_OF_2',
  revision: 3,
  external_post_id: 'n09540acd5c5a',
  public_url: publicUrl,
  price_jpy: 100,
  external_receipts: 1,
  second_article_earliest_publish_at: secondEarliestAt,
  synced_at: syncedAt,
}, null, 2));
