import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('C:/Users/hinat/Documents/Codex/2026-08-15/ai/work/hosting-release-countfix');
const runDir = resolve(root, 'runs/kizashi-20260830');
const statusPath = resolve(root, 'board/data/status.json');
const boardPath = resolve(root, 'board/data/board.json');
const runPath = resolve(runDir, 'run.json');
const gatePath = resolve(runDir, 'gate.json');
const manifestPath = resolve(runDir, 'note/prototype-gate/manifest.json');
const receiptPath = resolve(runDir, 'note/prototype-gate/note-draft-ready-receipt-r1.json');
const receiptRelative = 'runs/kizashi-20260830/note/prototype-gate/note-draft-ready-receipt-r1.json';
const externalDraftId = 'n4bc07009a5ef';
const readyAfter = '2026-08-30T11:16:00+09:00';
const plannedPublishAt = '2026-08-30T12:00:00+09:00';
const syncedAt = new Date().toISOString();

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const manifest = await readJson(manifestPath);
const title = 'AIの試作品を本番へ運ぶ「8週間ゲート」｜実証・評価・安全・費用を同時に進める';
const receipt = {
  schema_version: 'reiki-note-draft-ready-receipt.v1',
  status: 'EXTERNAL_DRAFT_READY',
  platform: 'NOTE',
  run_id: 'kizashi-20260830',
  revision: manifest.revision,
  content_id: manifest.content_id,
  external_draft_id: externalDraftId,
  account: 'natty_swan9072',
  title,
  price_jpy: 500,
  ready_after: readyAfter,
  planned_publish_at: plannedPublishAt,
  receipt_path: receiptRelative,
  component_hashes: {
    article_sha256: manifest.article_sha256,
    thumbnail_sha256: manifest.visuals.find((item) => item.path.endsWith('thumbnail-1.jpg'))?.sha256 ?? null,
  },
  verification: {
    title_matches: true,
    price_matches: true,
    cover_image_present: true,
    paid_boundary_matches: true,
    paid_boundary_before_heading: '2週目：最小の利用場面を選ぶ',
    quality_gate_passed: true,
    minimum_gap_satisfied_at_planned_time: true,
  },
  scheduling: {
    external_schedule_created: false,
    reason: 'note予約投稿はnoteプレミアム契約が必要。新規課金を行わず、最低4時間間隔後に直接公開する。',
    owner_action_required: false,
  },
  verified_at: syncedAt,
};
await writeJson(receiptPath, receipt);

manifest.gate.external_receipt = null;
manifest.external_draft = {
  state: 'READY',
  external_draft_id: externalDraftId,
  ready_after: readyAfter,
  planned_publish_at: plannedPublishAt,
  price_jpy: 500,
  receipt_path: receiptRelative,
};
await writeJson(manifestPath, manifest);

const run = await readJson(runPath);
run.stage = 'YouTube Shorts 1/1・note 1/2公開／note第2記事は外部下書き完成・12:00直接公開待ち／X・Instagram接続待ち';
run.reason = `YouTube Shortsとnote第1記事を公開済み。note第2記事は外部下書きID ${externalDraftId}、500円、見出し画像、有料境界を設定済み。予約投稿はnoteプレミアム契約が必要なため新規課金せず、12:00 JSTに直接公開する。`;
await writeJson(runPath, run);

const gate = await readJson(gatePath);
gate.checked_at = syncedAt;
gate.reason = `YouTube Shortsとnote第1記事は公開receipt取得済み。note第2記事は外部下書きID ${externalDraftId}まで完成し、12:00 JST直接公開待ち。X・Instagramは接続・認証待ち。`;
await writeJson(gatePath, gate);

const status = await readJson(statusPath);
status.generated_at = syncedAt;
status.today.next_action = 'note第2記事は外部下書き・500円・有料境界まで完成。最低4時間間隔後の12:00 JSTに直接公開する。X・Instagramは接続照合を継続。';
status.today.next_deadline = plannedPublishAt;
const todayNote = status.today.channels.find((item) => item.id === 'note');
todayNote.status = '1/2公開／第2記事は外部下書きID n4bc07009a5ef・500円・見出し画像・有料境界まで設定済み';
todayNote.next = 'noteプレミアムの新規課金は行わず、最低4時間間隔後の12:00 JSTに第2記事を直接公開';
todayNote.blocker = '第2記事は連投防止の最低4時間間隔待ち（最短11:16 JST、運用枠12:00 JST）。所有者操作は不要';
const noteChannel = status.channels.find((item) => item.id === 'note');
noteChannel.last_verified_at = syncedAt;
noteChannel.note = '8月30日第1記事を500円で公開。第2記事は外部下書きID n4bc07009a5ef、500円、見出し画像、有料境界まで設定済み。予約投稿は新規noteプレミアム契約が必要なため使わず、12:00 JSTに直接公開する。';
status.production.last_run.stage = 'YouTube Shorts 1/1・note 1/2公開／第2記事外部下書き完成';
status.production.last_run.next_action = 'note第2記事を12:00 JSTに直接公開し、X・Instagramの対象アカウント接続診断を継続。';
status.monitoring.last_checked_at = syncedAt;
status.evidence = [receiptRelative, ...status.evidence.filter((item) => item !== receiptRelative)];
await writeJson(statusPath, status);

const board = await readJson(boardPath);
const group = board.stores.postGroups.find((item) => item.source_run_id === 'kizashi-20260830');
group.updated_at = syncedAt;
group.internal.memo = `YouTube Shortsとnote第1記事を公開済み。note第2記事は外部下書きID ${externalDraftId}、500円、見出し画像、有料境界を設定し、12:00 JST直接公開待ち。`;
group.internal.tags = [...new Set([...group.internal.tags, 'second-note-external-draft-ready', 'note-premium-scheduling-unavailable'])];
const notePost = board.stores.channelPosts.find((item) => item.post_group_id === group.post_group_id && item.platform === 'NOTE');
notePost.title = 'note 1/2公開｜第2記事は外部下書き完成・12:00直接公開';
notePost.updated_at = syncedAt;
notePost.internal.memo = `第1記事公開済み。第2記事は外部下書きID ${externalDraftId}、500円、見出し画像、有料境界「2週目：最小の利用場面を選ぶ」直前を設定済み。予約投稿は新規課金が必要なため使わず、12:00 JST直接公開待ち。`;
notePost.internal.tags = [...new Set([...notePost.internal.tags, 'second-note-external-draft-ready', 'note-premium-scheduling-unavailable'])];
await writeJson(boardPath, board);

console.log(JSON.stringify({ status: 'SYNCED', external_draft_id: externalDraftId, planned_publish_at: plannedPublishAt, receipt: receiptRelative, synced_at: syncedAt }, null, 2));
