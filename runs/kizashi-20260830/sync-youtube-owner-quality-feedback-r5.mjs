import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('.');
const runDir = resolve(root, 'runs/kizashi-20260830');
const statusPath = resolve(root, 'board/data/status.json');
const boardPath = resolve(root, 'board/data/board.json');
const runPath = resolve(runDir, 'run.json');
const gatePath = resolve(runDir, 'gate.json');
const receiptRelative = 'runs/kizashi-20260830/youtube-shorts-final-r4/owner-post-publication-quality-feedback-r5.json';
const ladderRelative = 'runs/kizashi-20260830/youtube-shorts-final-r4/quality-ladder-retrospective-r5.json';
const receiptPath = resolve(root, receiptRelative);
const syncedAt = new Date().toISOString();

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value, pretty = true) {
  await writeFile(path, pretty ? `${JSON.stringify(value, null, 2)}\n` : JSON.stringify(value), 'utf8');
}

const receipt = await readJson(receiptPath);

const status = await readJson(statusPath);
status.generated_at = syncedAt;
const todayYouTube = status.today.channels.find((item) => item.id === 'youtube');
Object.assign(todayYouTube, {
  done: 1,
  state: 'PUBLISHED',
  status: '1/1公開／内容反応は良好との所有者評価。映像・字幕品質は次回基準として不合格',
  next: '内容・フックは学習し、映像は直近合格＋過去ベストとの前回超えゲートで全面強化',
  blocker: null,
  url: receipt.public_url,
});
const youtubeChannel = status.channels.find((item) => item.id === 'youtube');
if (youtubeChannel) {
  youtubeChannel.last_verified_at = syncedAt;
  youtubeChannel.note = '公開動画は維持。内容・フックは反応学習へ使用するが、字幕・映像品質は所有者不合格のため映像ベースラインから除外。次回は実写動画比率、重複ショット、字幕同期、パネル面積、9フレーム比較を前回超えゲートで検証する。';
}
status.today.next_action = 'note品質回復とX・Instagram接続照合を継続。次回YouTubeは内容構成を活かし、映像品質だけを前回超えゲートで強化する。';
status.monitoring.last_checked_at = syncedAt;
status.evidence = [receiptRelative, ladderRelative, ...status.evidence.filter((item) => ![receiptRelative, ladderRelative].includes(item))];
await writeJson(statusPath, status, false);

const run = await readJson(runPath);
run.stage = 'YouTube Shorts 1/1公開・内容反応学習／映像品質は次回ベースライン不採用／note全面改稿・X・Instagram接続待ち';
run.reason = '公開Shortsは内容評価が良好。一方、所有者が字幕・動画品質を不合格としたため、内容と映像を分離して学習し、次回は前回超え品質ゲートを必須化する。';
await writeJson(runPath, run);

const gate = await readJson(gatePath);
gate.checked_at = syncedAt;
gate.checks.youtube_published_content_feedback = 'POSITIVE_RESPONSE_OBSERVED';
gate.checks.youtube_visual_owner_feedback = 'REJECTED_AS_BASELINE';
gate.checks.youtube_caption_owner_feedback = 'BELOW_TARGET_QUALITY';
gate.checks.youtube_continuous_quality_gate_required_next = true;
await writeJson(gatePath, gate);

const board = await readJson(boardPath);
const post = board.stores.channelPosts.find((item) => item.channel_post_id === '20260830-0000-4000-8000-000000000014');
const group = board.stores.postGroups.find((item) => item.post_group_id === '20260830-0000-4000-8000-000000000001');
if (!post || !group) throw new Error('YouTube Board records are missing');

post.updated_at = syncedAt;
post.internal.memo = '公開維持。内容・フックは反応学習へ使用可能。字幕・映像品質は所有者不合格のため映像ベースラインから除外し、次回は直近合格＋過去ベストとの前回超えゲートを必須化。';
post.internal.tags = [...new Set([
  ...(post.internal.tags || []),
  'content-response-positive',
  'visual-quality-owner-rejected',
  'caption-quality-below-target',
  'exclude-from-visual-baseline',
  'continuous-quality-gate-next',
])];
post.production.updated_at = syncedAt;
post.production.updated_by = 'kizashi-youtube-owner-quality-feedback-r5';
group.updated_at = syncedAt;
group.internal.memo = 'YouTubeは公開維持。内容反応と映像品質を分離し、次回Shortsは直近合格・過去映像ベストの双方を上回る比較証跡が必須。note全面改稿と他媒体接続は継続。';
group.internal.tags = [...new Set([...(group.internal.tags || []), 'youtube-continuous-quality-loop'])];

const auditId = 'k30-youtube-owner-quality-feedback-r5';
board.stores.auditEvents = board.stores.auditEvents.filter((item) => item.audit_event_id !== auditId);
board.stores.auditEvents.push({
  audit_event_id: auditId,
  brand_id: 'news',
  actor_user_id: 'kizashi-youtube-owner-quality-feedback-r5',
  action: 'OWNER_POST_PUBLICATION_QUALITY_FEEDBACK_CAPTURED',
  entity_type: 'CHANNEL_POST',
  entity_id: post.channel_post_id,
  before_json: { published: true, quality_role: 'UNCLASSIFIED' },
  after_json: {
    published: true,
    content_baseline_eligible: true,
    visual_baseline_eligible: false,
    caption_baseline_eligible: false,
    next_quality_gate: 'NON_REGRESSION_PLUS_MEASURABLE_IMPROVEMENT',
    receipt: receiptRelative,
    quality_ladder: ladderRelative,
  },
  created_at: syncedAt,
});
await writeJson(boardPath, board, false);

console.log(JSON.stringify({
  status: 'SYNCED',
  external_post_id: receipt.external_post_id,
  published_video_action: 'KEEP_PUBLIC',
  visual_baseline_eligible: false,
  content_baseline_eligible: true,
  receipt: receiptRelative,
  synced_at: syncedAt,
}, null, 2));
