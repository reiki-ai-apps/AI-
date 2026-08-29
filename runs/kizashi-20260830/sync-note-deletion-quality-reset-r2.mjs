import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('.');
const runDir = resolve(root, 'runs/kizashi-20260830');
const statusPath = resolve(root, 'board/data/status.json');
const boardPath = resolve(root, 'board/data/board.json');
const runPath = resolve(runDir, 'run.json');
const gatePath = resolve(runDir, 'gate.json');
const publishedManifestPath = resolve(runDir, 'note/vendor-exit/manifest.json');
const draftManifestPath = resolve(runDir, 'note/prototype-gate/manifest.json');
const deletionReceiptPath = resolve(runDir, 'note/vendor-exit/note-deletion-receipt-r2.json');
const holdReceiptPath = resolve(runDir, 'note/prototype-gate/note-quality-hold-receipt-r2.json');
const deletionReceiptRelative = 'runs/kizashi-20260830/note/vendor-exit/note-deletion-receipt-r2.json';
const holdReceiptRelative = 'runs/kizashi-20260830/note/prototype-gate/note-quality-hold-receipt-r2.json';
const deletedId = 'n4a967cb08202';
const deletedUrl = `https://note.com/natty_swan9072/n/${deletedId}`;
const externalDraftId = 'n4bc07009a5ef';
const rejectedRevisionId = '20260830-0000-4000-8000-000000000091';
const syncedAt = new Date().toISOString();

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const publishedManifest = await readJson(publishedManifestPath);
publishedManifest.price_jpy = 100;
publishedManifest.gate.round_1 = 'REJECTED_BY_OWNER';
publishedManifest.gate.round_2 = 'REJECTED_BY_OWNER';
publishedManifest.gate.round_3 = 'REJECTED_BY_OWNER';
publishedManifest.gate.external_receipt = deletionReceiptRelative;
publishedManifest.publication = {
  state: 'DELETED',
  external_id: deletedId,
  public_url: deletedUrl,
  published_at: '2026-08-30T07:16:00+09:00',
  deleted_at: syncedAt,
  price_jpy_at_publication: 500,
  price_policy_jpy: 100,
};
publishedManifest.quality_reset = {
  state: 'REJECTED_BY_OWNER',
  reason: 'サムネイルと本文が前回比で明確に低品質。公開note本文に見出し画像以外の本文図版がなく、比較ゲートも欠落。',
  observed_regression: {
    current_article_characters: 4030,
    previous_owner_approved_characters: 5083,
    current_markdown_inline_images: 0,
    previous_owner_approved_inline_images: 6,
    current_live_inline_visuals: 0,
  },
  excluded_from_future_baselines: true,
};
await writeJson(publishedManifestPath, publishedManifest);

const draftManifest = await readJson(draftManifestPath);
draftManifest.price_jpy = 100;
draftManifest.gate.round_1 = 'REJECTED_BY_OWNER';
draftManifest.gate.round_2 = 'REJECTED_BY_OWNER';
draftManifest.gate.round_3 = 'REJECTED_BY_OWNER';
draftManifest.gate.external_receipt = holdReceiptRelative;
draftManifest.external_draft = {
  state: 'REWRITE_REQUIRED',
  external_draft_id: externalDraftId,
  planned_publish_at: null,
  price_jpy: 100,
  receipt_path: holdReceiptRelative,
  publish_blocked_by: 'QUALITY_REGRESSION',
};
draftManifest.quality_reset = {
  state: 'REJECTED_BY_OWNER',
  reason: '同じ低品質工程で作成されたため公開を停止し、前回比ゲートから全面改稿する。',
  excluded_from_future_baselines: true,
};
await writeJson(draftManifestPath, draftManifest);

const deletionReceipt = {
  schema_version: 'reiki-note-deletion-receipt.v1',
  status: 'DELETED_BY_OWNER_REQUEST',
  platform: 'NOTE',
  run_id: 'kizashi-20260830',
  revision: publishedManifest.revision,
  content_id: publishedManifest.content_id,
  external_id: deletedId,
  public_url: deletedUrl,
  deleted_at: syncedAt,
  reason: 'OWNER_REJECTED_THUMBNAIL_AND_CONTENT_QUALITY',
  verification: {
    deletion_confirmed: true,
    observed_message: 'この記事は削除されています。',
    author_and_purchaser_only_message_present: true,
  },
  purchase_evidence: {
    status: 'UNAVAILABLE_PASSWORD_REAUTH_REQUIRED',
    inferred_zero: false,
  },
  price_policy: {
    fixed_price_jpy: 100,
    until: 'FIRST_PAID_PURCHASE_RECEIPT',
    change_without_explicit_owner_instruction: false,
  },
  component_hashes: {
    article_sha256: publishedManifest.article_sha256,
    thumbnail_sha256: publishedManifest.visuals.find((item) => item.path.endsWith('thumbnail-1.jpg'))?.sha256 ?? null,
  },
};
await writeJson(deletionReceiptPath, deletionReceipt);

const holdReceipt = {
  schema_version: 'reiki-note-quality-hold-receipt.v1',
  status: 'REWRITE_REQUIRED',
  platform: 'NOTE',
  run_id: 'kizashi-20260830',
  revision: draftManifest.revision,
  content_id: draftManifest.content_id,
  external_draft_id: externalDraftId,
  held_at: syncedAt,
  reason: 'OWNER_REJECTED_CURRENT_NOTE_QUALITY_AND_REQUIRED_PREVIOUS_BEST_COMPARISON',
  external_publish_allowed: false,
  price_jpy: 100,
  required_recovery: [
    '直近所有者合格記事と過去最高記事の比較',
    '本文・写真・図解・サムネイルを前回以上へ全面改稿',
    'PCと375pxのnote実表示証拠',
    '100円設定の照合',
    '三周検査を第1周から再実行',
  ],
};
await writeJson(holdReceiptPath, holdReceipt);

const run = await readJson(runPath);
run.stage = 'YouTube Shorts 1/1公開／note 0/2・公開記事削除済み・第2下書き全面改稿中／X・Instagram接続待ち';
run.reason = 'note第1記事は所有者の品質不合格により削除。第2下書きも同じ工程のため公開停止し、100円固定・前回比品質ゲートで全面改稿する。';
await writeJson(runPath, run);

const gate = await readJson(gatePath);
gate.checked_at = syncedAt;
gate.status = 'IMPROVING';
gate.reason = 'note現Revisionは所有者品質NG。公開記事を削除し、第2下書きの公開を停止。前回比品質ゲートと100円固定で第1周から再制作する。';
gate.checks.external_publish_receipts = false;
gate.checks.note_owner_quality = 'REJECTED_BY_OWNER';
gate.checks.note_price_policy_jpy = 100;
await writeJson(gatePath, gate);

const status = await readJson(statusPath);
const wasAlreadySynced = status.evidence.includes(deletionReceiptRelative);
status.generated_at = syncedAt;
if (!wasAlreadySynced) {
  status.summary.published_confirmed = Math.max(0, Number(status.summary.published_confirmed || 0) - 1);
}
status.today.completed = 1;
status.today.headline = '8月30日（日曜）は1/7件公開。YouTube Shortsは公開済み。noteは低品質記事を削除し0/2へ戻しました。';
status.today.next_action = 'note 2記事を100円固定・前回比品質ゲートで全面改稿。第2外部下書きは公開停止。X・Instagramは接続照合を継続。';
status.today.next_deadline = null;
status.today.owner_action_required = false;
status.today.owner_action = null;
const todayNote = status.today.channels.find((item) => item.id === 'note');
Object.assign(todayNote, {
  done: 0,
  state: 'PRODUCTION',
  status: '0/2公開／第1記事は品質不合格で削除済み。第2記事も公開停止・全面改稿中',
  next: '100円固定、直近合格記事以上・過去最高以上の比較証跡を作り、第1周から再制作',
  blocker: '品質回帰。本文4030字・本文内画像0点で、前回5083字・本文内画像6点を下回った。所有者操作は不要',
  url: null,
});
const noteChannel = status.channels.find((item) => item.id === 'note');
Object.assign(noteChannel, {
  state: 'ATTENTION',
  last_verified_at: syncedAt,
  latest_published: {
    title: 'AIで文章が整っても、独自性は別に測る｜研修を変える二軸評価表',
    url: 'https://note.com/natty_swan9072/n/n5c99c22290ea',
  },
  next_scheduled: null,
  note: '8月30日第1記事は所有者の品質不合格により削除。第2下書きは公開停止。以後は購入receipt確認まで100円固定し、所有者の明示指示なしに価格変更しない。',
});
status.production.last_run.stage = 'YouTube Shorts 1/1公開／note 0/2・削除済み・全面改稿中';
status.production.last_run.reason = 'note公開記事を所有者品質NGで削除し、低品質Revisionを将来の模範から除外。';
status.production.last_run.next_action = 'note 2記事を100円固定・前回比品質ゲートで全面改稿し、note実表示で検証する。';
status.monitoring.last_checked_at = syncedAt;
status.evidence = [
  deletionReceiptRelative,
  holdReceiptRelative,
  ...status.evidence.filter((item) => ![deletionReceiptRelative, holdReceiptRelative].includes(item)),
];
await writeFile(statusPath, JSON.stringify(status), 'utf8');

const board = await readJson(boardPath);
const group = board.stores.postGroups.find((item) => item.source_run_id === 'kizashi-20260830');
group.project_title = '2026-08-30｜YouTube Shorts 1/1公開／note 0/2全面改稿中／他媒体継続中';
group.updated_at = syncedAt;
group.internal.memo = 'note第1記事は所有者品質NGで削除。第2下書きは公開停止。100円固定と前回比品質ゲートで全面改稿する。';
group.internal.tags = [...new Set([
  ...group.internal.tags.filter((tag) => !['note-published-1-of-2', 'note-paid-boundary-verified', 'second-note-external-draft-ready'].includes(tag)),
  'note-deleted-owner-quality-reject',
  'note-quality-regression',
  'note-price-locked-100',
  'second-note-rewrite-required',
])];

const notePost = board.stores.channelPosts.find((item) => item.post_group_id === group.post_group_id && item.platform === 'NOTE');
const previousRevision = board.stores.postRevisions.find((item) => item.revision_id === notePost.current_revision_id);
if (!board.stores.postRevisions.some((item) => item.revision_id === rejectedRevisionId)) {
  board.stores.postRevisions.push({
    ...previousRevision,
    revision_id: rejectedRevisionId,
    revision_no: Number(previousRevision.revision_no || 1) + 1,
    title: 'note 0/2｜現Revision品質不合格・100円固定で全面改稿',
    body: '所有者品質判定: REJECTED_BY_OWNER\n外部記事: 削除済み n4a967cb08202\n第2外部下書き: 公開停止 n4bc07009a5ef\n価格: 有料購入receipt成立まで100円固定。成立後も明示指示なしに変更しない。\n回帰証拠: 本文4030字・本文内画像0点。前回合格は5083字・本文内画像6点。\n再開条件: 直近合格以上・過去最高以上・少なくとも1項目改善をPC/375px実表示で証明。',
    created_at: syncedAt,
    created_by: 'kizashi-note-quality-reset-r2',
    approval_basis_hash: null,
  });
}
Object.assign(notePost, {
  display_state: 'PRODUCTION',
  title: 'note 0/2｜公開記事削除済み・2記事全面改稿中',
  current_revision_id: rejectedRevisionId,
  approval_id: null,
  scheduled_at: null,
  published_at: null,
  public_url: null,
  external_post_id: null,
  failure_kind: 'QUALITY_REGRESSION',
  execution_id: null,
  price_jpy: 100,
  updated_at: syncedAt,
});
notePost.internal.memo = '第1記事は所有者品質NGで削除済み。第2外部下書きも公開停止。100円固定・前回比品質ゲートで2記事を全面改稿する。';
notePost.internal.tags = [...new Set([
  ...notePost.internal.tags.filter((tag) => !['external-publish-verified', 'note-published-1-of-2', 'paid-boundary-verified', 'second-note-external-draft-ready'].includes(tag)),
  'owner-quality-rejected',
  'external-article-deleted',
  'quality-regression',
  'price-locked-100',
  'rewrite-required',
])];
notePost.production.steps = [
  { id: 'note30_1', label: '本文・一次情報・購入価値を前回比で再設計', done: false, note: 'QUALITY_REGRESSIONから全面改稿' },
  { id: 'note30_2', label: '実在写真＋意味ある図解・PC/375px実表示', done: false, note: '前回以上の比較証拠が必要' },
  { id: 'note30_3', label: '100円・有料境界・公開後receipt', done: false, note: '購入receipt成立まで100円固定' },
];
notePost.production.updated_at = syncedAt;
notePost.production.updated_by = 'kizashi-note-quality-reset-r2';

const auditId = 'k30-note-owner-quality-delete-r2';
if (!board.stores.auditEvents.some((item) => item.audit_event_id === auditId)) {
  board.stores.auditEvents.push({
    audit_event_id: auditId,
    brand_id: 'news',
    actor_user_id: 'kizashi-note-quality-reset-r2',
    action: 'OWNER_QUALITY_REJECTION_AND_EXTERNAL_DELETION',
    entity_type: 'CHANNEL_POST',
    entity_id: notePost.channel_post_id,
    before_json: { display_state: 'PUBLISHED', external_post_id: deletedId, price_jpy: 500 },
    after_json: {
      display_state: 'PRODUCTION',
      external_deleted: true,
      deletion_receipt: deletionReceiptRelative,
      second_draft_state: 'REWRITE_REQUIRED',
      price_policy_jpy: 100,
      current_revision_id: rejectedRevisionId,
    },
    created_at: syncedAt,
  });
  if (board.autoSeq && Number.isFinite(Number(board.autoSeq.auditEvents))) {
    board.autoSeq.auditEvents = Number(board.autoSeq.auditEvents) + 1;
  }
}
await writeFile(boardPath, JSON.stringify(board), 'utf8');

console.log(JSON.stringify({
  status: 'SYNCED',
  deleted_external_id: deletedId,
  second_draft: 'REWRITE_REQUIRED',
  price_policy_jpy: 100,
  deletion_receipt: deletionReceiptRelative,
  hold_receipt: holdReceiptRelative,
  synced_at: syncedAt,
}, null, 2));
