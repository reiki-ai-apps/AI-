import { shiftDateKey } from '../core/tz.js';
import { productionProgress } from './production.js';

const STAGES = Object.freeze(['CREATING', 'READY', 'APPROVAL', 'SCHEDULED']);

function packageIsReady(pkg) {
  if (!pkg || pkg.status !== 'ACCEPTED') return false;
  const checks = (pkg.quality_reviews ?? []).filter((review) => review.review_type !== 'HUMAN_APPROVAL');
  return checks.length > 0 && checks.every((review) => review.verdict === 'PASS');
}

export function pipelineStage(post, pkg) {
  if (post.display_state === 'SCHEDULED' || post.display_state === 'PUBLISHING') return 'SCHEDULED';
  if (post.display_state === 'PENDING_APPROVAL') return 'APPROVAL';
  if (post.display_state === 'ACTION_REQUIRED') return 'CREATING';
  if (productionProgress(post.production ?? null).complete || packageIsReady(pkg)) return 'APPROVAL';
  return 'CREATING';
}

/** 予約確認では、承認画面に載った状態と、載せられる準備完了状態を分ける。 */
export function reservationStage(post, pkg) {
  if (post.display_state === 'SCHEDULED' || post.display_state === 'PUBLISHING') return 'SCHEDULED';
  if (post.display_state === 'PENDING_APPROVAL') return 'APPROVAL';
  if (productionProgress(post.production ?? null).complete || packageIsReady(pkg)) return 'READY';
  return 'CREATING';
}

export function intendedDate(post) {
  const declared = post.internal?.intended_publish_date ?? post.internal?.publish_date ?? null;
  if (declared) return declared;
  if (post.internal?.tags?.includes('production-run')) return null;
  return post.calendar_date_key ?? null;
}

function emptyCounts() {
  return Object.fromEntries(STAGES.map((stage) => [stage, 0]));
}

/** 今日・明日・2日後の「何を、どこへ、何時に、どの状態で」を組み立てる。 */
export function buildReservationPlan({
  posts = [],
  postGroups = [],
  publicationPackages = [],
  todayKey,
  horizonDays = 2,
}) {
  const groups = new Map(postGroups.map((group) => [group.post_group_id, group]));
  const packages = new Map(publicationPackages.map((pkg) => [pkg.post_group_id, pkg]));
  const days = Array.from({ length: horizonDays + 1 }, (_, index) => ({
    index,
    dateKey: shiftDateKey(todayKey, index),
    items: [],
    counts: emptyCounts(),
    publishedCount: 0,
  }));
  const byDate = new Map(days.map((day) => [day.dateKey, day]));

  for (const post of posts) {
    if (post.deleted_at || post.cancelled_at) continue;
    const dateKey = intendedDate(post);
    const day = byDate.get(dateKey);
    if (!day) continue;
    const group = groups.get(post.post_group_id) ?? {};
    const stage = post.display_state === 'PUBLISHED'
      ? 'PUBLISHED'
      : reservationStage(post, packages.get(post.post_group_id));
    if (stage === 'PUBLISHED') day.publishedCount += 1;
    else day.counts[stage] += 1;
    day.items.push({
      id: post.channel_post_id,
      title: group.project_title || post.title || 'タイトル未設定',
      brandId: group.brand_id ?? post.brand_id ?? 'other',
      platform: post.platform,
      scheduledAt: post.scheduled_at ?? null,
      stage,
    });
  }

  for (const day of days) {
    day.items.sort((a, b) => Date.parse(a.scheduledAt ?? '') - Date.parse(b.scheduledAt ?? ''));
    day.complete = day.items.length > 0
      && day.items.every((item) => item.stage === 'SCHEDULED' || item.stage === 'PUBLISHED');
  }

  const totals = days.reduce((sum, day) => {
    for (const stage of STAGES) sum[stage] += day.counts[stage];
    sum.PUBLISHED += day.publishedCount;
    if (day.items.length === 0) sum.UNPLANNED_DAYS += 1;
    return sum;
  }, { ...emptyCounts(), PUBLISHED: 0, UNPLANNED_DAYS: 0 });

  return {
    complete: days.every((day) => day.complete),
    days,
    totals,
  };
}
