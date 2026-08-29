import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('C:/Users/hinat/Documents/Codex/2026-08-15/ai/work/hosting-release-countfix');
const runDir = resolve(root, 'runs/kizashi-20260830');
const statusPath = resolve(root, 'board/data/status.json');
const boardPath = resolve(root, 'board/data/board.json');
const runPath = resolve(runDir, 'run.json');
const gatePath = resolve(runDir, 'gate.json');
const manifestPath = resolve(runDir, 'note/vendor-exit/manifest.json');
const receiptPath = resolve(runDir, 'note/vendor-exit/note-publication-receipt-r1.json');

const publishedAt = '2026-08-30T07:16:00+09:00';
const syncedAt = new Date().toISOString();
const externalId = 'n4a967cb08202';
const publicUrl = `https://note.com/natty_swan9072/n/${externalId}`;
const receiptRelative = 'runs/kizashi-20260830/note/vendor-exit/note-publication-receipt-r1.json';
const title = 'AIモデル供給が止まる前に作る「切替設計」｜11月12日という期限から逆算する';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const manifest = await readJson(manifestPath);
const receipt = {
  schema_version: 'reiki-external-publication-receipt.v1',
  status: 'PUBLISHED',
  platform: 'NOTE',
  run_id: 'kizashi-20260830',
  revision: manifest.revision,
  content_id: manifest.content_id,
  external_id: externalId,
  public_url: publicUrl,
  published_at: publishedAt,
  price_jpy: 500,
  receipt_path: receiptRelative,
  component_hashes: {
    article_sha256: manifest.article_sha256,
    thumbnail_sha256: manifest.visuals.find((item) => item.path.endsWith('thumbnail-1.jpg'))?.sha256 ?? null,
  },
  verification: {
    channel_matches: true,
    title_matches: true,
    published_at_matches: true,
    price_matches: true,
    public_page_loaded: true,
    paid_boundary_matches: true,
    paid_boundary_before_heading: '残り期間を4つの区間に分ける',
    cover_image_present: true,
  },
  verified_title: title,
  verified_account: 'natty_swan9072',
  verified_at: syncedAt,
  external_result_unknown: false,
};
await writeJson(receiptPath, receipt);

manifest.gate.round_3 = 'PASS';
manifest.gate.external_receipt = receiptRelative;
manifest.publication = {
  state: 'PUBLISHED',
  external_id: externalId,
  public_url: publicUrl,
  published_at: publishedAt,
  price_jpy: 500,
};
await writeJson(manifestPath, manifest);

const run = await readJson(runPath);
run.stage = 'YouTube Shorts 1/1・note 1/2公開／note第2記事は4時間間隔待ち／X・Instagram接続待ち';
run.reason = `YouTube Shortsとnote第1記事を公開。note外部ID ${externalId}、公開URL、500円、07:16 JST、有料境界を照合。第2記事は最低4時間間隔を守り12:00 JST公開予定。X・Instagramは対象アカウントの接続条件未成立。`;
await writeJson(runPath, run);

const gate = await readJson(gatePath);
gate.checked_at = syncedAt;
gate.reason = `YouTube Shortsとnote第1記事は外部公開receipt取得済み。note第2記事は最低4時間間隔を守り12:00 JST公開予定。X・Instagramは接続・認証待ち。`;
gate.checks.aivis_paid_call_executed = true;
gate.checks.external_publish_receipts = false;
await writeJson(gatePath, gate);

const status = await readJson(statusPath);
status.generated_at = syncedAt;
status.summary.published_confirmed = Math.max(Number(status.summary.published_confirmed || 0), 27);
status.today.completed = 2;
status.today.headline = '8月30日（日曜）は2/7件公開。YouTube Shorts 1本と有料note第1記事を公開済みです。';
status.today.next_action = 'note第2記事を最低4時間間隔後の12:00 JSTに公開。X・Instagramは対象アカウント接続の照合を継続。';
status.today.next_deadline = '2026-08-30T12:00:00+09:00';
status.today.owner_action_required = false;
status.today.owner_action = null;
const todayNote = status.today.channels.find((item) => item.id === 'note');
Object.assign(todayNote, {
  done: 1,
  state: 'PUBLISHED',
  status: '1/2公開／第1記事は500円・外部ID n4a967cb08202・有料境界を照合済み。第2記事も品質ゲート合格済み',
  next: '第1記事から最低4時間空け、12:00 JSTに第2記事を500円で公開',
  blocker: '第2記事は連投防止の最低4時間間隔待ち（最短11:16 JST、運用枠12:00 JST）',
  url: publicUrl,
});
const noteChannel = status.channels.find((item) => item.id === 'note');
Object.assign(noteChannel, {
  state: 'HEALTHY',
  last_verified_at: syncedAt,
  latest_published: { title, url: publicUrl },
  next_scheduled: null,
  note: '8月30日第1記事を500円で公開。外部ID n4a967cb08202、公開時刻07:16 JST、タイトル、価格、有料境界を照合。第2記事は最低4時間間隔後の12:00 JSTに公開する。',
});
status.production.last_run.stage = 'YouTube Shorts 1/1・note 1/2公開済み';
status.production.last_run.reason = `YouTube Shortsに続き、note第1記事を500円で公開。外部ID ${externalId}、URL、時刻、有料境界を照合。`;
status.production.last_run.next_action = 'note第2記事を12:00 JSTに公開し、X・Instagramの対象アカウント接続診断を継続。';
status.monitoring.last_checked_at = syncedAt;
status.evidence = [receiptRelative, ...status.evidence.filter((item) => item !== receiptRelative)];
await writeJson(statusPath, status);

const board = await readJson(boardPath);
const group = board.stores.postGroups.find((item) => item.source_run_id === 'kizashi-20260830');
group.project_title = '2026-08-30｜YouTube Shorts 1/1・note 1/2公開済み／他媒体継続中';
group.updated_at = syncedAt;
group.internal.memo = `YouTube Shorts公開済み。note第1記事も500円で公開し、外部ID ${externalId}、URL、07:16 JST、有料境界を同期。第2記事は12:00 JST公開予定。`;
group.internal.tags = [...new Set([...group.internal.tags, 'note-published-1-of-2', 'note-paid-boundary-verified'])];
const notePost = board.stores.channelPosts.find((item) => item.post_group_id === group.post_group_id && item.platform === 'NOTE');
Object.assign(notePost, {
  display_state: 'PUBLISHED',
  title: 'note 1/2公開｜第1記事500円・第2記事12:00予定',
  published_at: publishedAt,
  external_post_id: externalId,
  public_url: publicUrl,
  price_jpy: 500,
  failure_kind: null,
  updated_at: syncedAt,
});
notePost.internal.memo = `第1記事を500円で公開。外部ID ${externalId}、URL、07:16 JST、有料境界「残り期間を4つの区間に分ける」直前を照合。第2記事は最低4時間間隔後の12:00 JSTに公開する。`;
notePost.internal.tags = [...new Set([
  ...notePost.internal.tags.filter((tag) => !['external-not-published', 'owner-approval-pending', 'approval-required'].includes(tag)),
  'external-publish-verified',
  'note-published-1-of-2',
  'paid-boundary-verified',
])];
await writeJson(boardPath, board);

console.log(JSON.stringify({ status: 'SYNCED', external_id: externalId, public_url: publicUrl, receipt: receiptRelative, synced_at: syncedAt }, null, 2));
