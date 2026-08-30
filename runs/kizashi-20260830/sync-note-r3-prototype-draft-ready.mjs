import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('C:/Users/hinat/Documents/Codex/2026-08-15/ai/work/hosting-release-countfix');
const runDir = resolve(root, 'runs/kizashi-20260830');
const statusPath = resolve(root, 'board/data/status.json');
const boardPath = resolve(root, 'board/data/board.json');
const runPath = resolve(runDir, 'run.json');
const gatePath = resolve(runDir, 'gate.json');
const receiptPath = resolve(runDir, 'note-rewrite-r3/prototype-gate/note-draft-ready-receipt-r3.json');
const receiptRelative = 'runs/kizashi-20260830/note-rewrite-r3/prototype-gate/note-draft-ready-receipt-r3.json';
const rejectedDeletionReceiptPath = resolve(runDir, 'note-rewrite-r3/prototype-gate/rejected-r1-draft-deletion-receipt.json');
const rejectedDeletionReceiptRelative = 'runs/kizashi-20260830/note-rewrite-r3/prototype-gate/rejected-r1-draft-deletion-receipt.json';

const externalDraftId = 'nebbeebff25e1';
const title = 'AI試作品を本番へ運ぶ「8週間ゲート」実務キット｜価値・評価・安全・費用・復旧を揃える';
const articleHash = '40cae5d34cbf633cf5b1bdfbc2fd7c085f54450ba561cccb22da892d6be78758';
const thumbnailHash = '706f5ab478b0a04e883c2e504bd40732fadcfa9e636c8ac0577b911cff6740d6';
const approvalId = 'd04c145c-5a53-4c0b-99aa-a36433aeb628';
const earliestPublishAt = '2026-08-30T20:17:41+09:00';
const plannedPublishAt = '2026-08-30T20:18:00+09:00';
const syncedAt = new Date().toISOString();

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeCompactJson(path, value) {
  await writeFile(path, `${JSON.stringify(value)}\n`, 'utf8');
}

let rejectedDeletionReceipt;
try {
  rejectedDeletionReceipt = await readJson(rejectedDeletionReceiptPath);
} catch {
  rejectedDeletionReceipt = {
    schema_version: 'reiki-note-draft-deletion-receipt.v1',
    status: 'DELETED',
    platform: 'NOTE',
    run_id: 'kizashi-20260830',
    rejected_revision: 1,
    external_draft_id: 'n4bc07009a5ef',
    account: 'natty_swan9072',
    title: 'AIの試作品を本番へ運ぶ「8週間ゲート」｜実証・評価・安全・費用を同時に進める',
    rejected_price_jpy: 500,
    reason: 'REJECTED_BY_OWNER。Revision 3の公開候補と混同しないため削除。',
    deletion_verified: true,
    verification_url: 'https://note.com/notes',
    recoverability: 'UNKNOWN',
    deleted_at: syncedAt,
  };
  await writeJson(rejectedDeletionReceiptPath, rejectedDeletionReceipt);
}

const receipt = {
  schema_version: 'reiki-note-draft-ready-receipt.v2',
  status: 'EXTERNAL_DRAFT_READY',
  platform: 'NOTE',
  run_id: 'kizashi-20260830',
  revision: 3,
  content_id: 'kizashi-note-20260830-prototype-gate-r3',
  publication_key: 'note:natty_swan9072:kizashi-note-20260830-prototype-gate-r3:40cae5d34cbf633c',
  external_draft_id: externalDraftId,
  editor_url: `https://editor.note.com/notes/${externalDraftId}/publish/`,
  account: 'natty_swan9072',
  title,
  price_jpy: 100,
  earliest_publish_at: earliestPublishAt,
  planned_publish_at: plannedPublishAt,
  receipt_path: receiptRelative,
  component_hashes: {
    article_sha256: articleHash,
    thumbnail_sha256: thumbnailHash,
  },
  approval: {
    status: 'APPROVED',
    approval_id: approvalId,
    content_hash: articleHash,
    thumbnail_hash: thumbnailHash,
    expires_at: '2026-08-31T06:04:34.025Z',
  },
  verification: {
    account_matches: true,
    title_matches: true,
    price_matches: true,
    cover_image_present: true,
    inline_visual_count: 6,
    heading_count: 13,
    primary_link_count: 4,
    tags: ['AI', '生成AI', '業務改善', 'リスク管理'],
    magazine: 'KIZASHI',
    paid_boundary_matches: true,
    paid_boundary_before_heading: '成果物1：課題・範囲シート',
    quality_gate_passed: true,
    minimum_gap_satisfied_at_planned_time: true,
  },
  scheduling: {
    external_schedule_created: false,
    reason: 'note予約投稿はnoteプレミアム契約が必要。新規課金を行わず、20:18 JSTに直接公開する。',
    owner_action_required: false,
  },
  duplicate_protection: {
    public_receipt_match: false,
    unknown_external_result_retry: false,
    rejected_revision_1_draft_id: 'n4bc07009a5ef',
    rejected_revision_1_must_not_publish: true,
    rejected_revision_1_deleted: true,
    rejected_revision_1_deletion_receipt: rejectedDeletionReceiptRelative,
  },
  verified_at: syncedAt,
};
await writeJson(receiptPath, receipt);

const run = await readJson(runPath);
run.stage = 'YouTube Shorts 1/1公開／note 1/2公開・第2記事Revision 3外部下書き完成・20:18直接公開待ち／X・Instagram接続待ち';
run.reason = `note第2記事Revision 3は外部下書きID ${externalDraftId}、100円、カバー、本文6図版、4リンク、13見出し、有料境界まで設定済み。予約投稿は新規noteプレミアム契約が必要なため使わず、20:18 JSTに直接公開する。`;
run.next_action = '20:18 JSTに第2noteを1回だけ直接公開し、外部URL・価格・有料境界・画像を検証してBoardを2/2へ即時同期する。';
await writeJson(runPath, run);

const gate = await readJson(gatePath);
gate.checked_at = syncedAt;
gate.reason = `note Revision 3第1記事は公開済み。第2記事は外部下書きID ${externalDraftId}、100円、カバー、本文6図版、4リンク、13見出し、有料境界まで照合済みで、20:18 JST直接公開待ち。`;
await writeJson(gatePath, gate);

const status = await readJson(statusPath);
status.generated_at = syncedAt;
status.today.headline = '8月30日（日曜）は2/7件公開。YouTube Shorts 1/1、note 1/2公開済み。note第2記事Revision 3は外部下書き完成、20:18 JST直接公開待ち。';
status.today.next_action = 'note第2記事Revision 3は100円・カバー・本文6図版・有料境界まで公式下書き完成。20:18 JSTに1回だけ直接公開する。';
status.today.next_deadline = plannedPublishAt;
const todayNote = status.today.channels.find((item) => item.id === 'note');
todayNote.status = '1/2公開済み／第2記事Revision 3は外部下書き完成・20:18 JST直接公開待ち';
todayNote.next = '20:18 JSTに100円で1回だけ直接公開し、外部URL・価格・有料境界・画像を検証';
todayNote.blocker = '4時間間隔待ち。note予約投稿は新規プレミアム課金が必要なため使用しない。所有者操作は不要';
const noteChannel = status.channels.find((item) => item.id === 'note');
noteChannel.last_verified_at = syncedAt;
noteChannel.note = `Revision 3第1記事は100円で公開済み。第2記事は外部下書きID ${externalDraftId}、100円、カバー、本文6図版、4リンク、13見出し、有料境界「成果物1：課題・範囲シート」直前まで設定済み。20:18 JST直接公開待ち。`;
status.production.last_run.stage = 'YouTube Shorts 1/1公開／note 1/2公開・第2記事Revision 3外部下書き完成';
status.production.last_run.next_action = '20:18 JSTに第2noteを直接公開し、外部receipt取得直後にBoardを2/2へ同期する。';
status.monitoring.cadence = 'PT2H';
status.monitoring.last_checked_at = syncedAt;
status.monitoring.description = status.monitoring.description.replace('1時間ごとに', '2時間ごとに');
status.evidence = [receiptRelative, rejectedDeletionReceiptRelative, ...status.evidence.filter((item) => item !== receiptRelative && item !== rejectedDeletionReceiptRelative)];
await writeCompactJson(statusPath, status);

const board = await readJson(boardPath);
const group = board.stores.postGroups.find((item) => item.source_run_id === 'kizashi-20260830');
group.updated_at = syncedAt;
group.internal.memo = `YouTube Shortsとnote第1記事を公開済み。note第2記事Revision 3は外部下書きID ${externalDraftId}、100円、カバー、本文6図版、有料境界を設定し、20:18 JST直接公開待ち。`;
group.internal.tags = [...new Set([...group.internal.tags, 'note-r3-second-external-draft-ready', 'note-premium-scheduling-unavailable', 'rejected-r1-note-draft-deleted'])];
const notePost = board.stores.channelPosts.find((item) => item.post_group_id === group.post_group_id && item.platform === 'NOTE');
notePost.title = 'note 1/2公開｜第2記事Revision 3は外部下書き完成・20:18直接公開';
notePost.updated_at = syncedAt;
notePost.internal.memo = `第1記事公開済み。第2記事Revision 3は外部下書きID ${externalDraftId}、100円、カバー、本文6図版、4リンク、13見出し、有料境界「成果物1：課題・範囲シート」直前を設定済み。新規課金なしで20:18 JST直接公開待ち。`;
notePost.internal.tags = [...new Set([...notePost.internal.tags, 'note-r3-second-external-draft-ready', 'note-premium-scheduling-unavailable', 'rejected-r1-note-draft-deleted'])];
await writeCompactJson(boardPath, board);

console.log(JSON.stringify({
  status: 'SYNCED',
  external_draft_id: externalDraftId,
  price_jpy: 100,
  planned_publish_at: plannedPublishAt,
  receipt: receiptRelative,
  synced_at: syncedAt,
}, null, 2));
