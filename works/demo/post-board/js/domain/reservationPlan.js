import { shiftDateKey } from '../core/tz.js';
import { productionProgress } from './production.js';

const STAGES = Object.freeze(['CREATING', 'READY', 'APPROVAL', 'CONNECTION_REQUIRED', 'EXTERNAL_PENDING', 'SCHEDULED']);

const DAILY_MINIMUMS = Object.freeze({ NOTE: 2, X: 2, INSTAGRAM: 2 });

function weekdayForDateKey(dateKey) {
  return new Date(`${dateKey}T12:00:00+09:00`).getUTCDay();
}

export function platformRequirements(dateKey) {
  const weekday = weekdayForDateKey(dateKey);
  const mainVideoDay = weekday === 1 || weekday === 3 || weekday === 5;
  return {
    ...DAILY_MINIMUMS,
    YOUTUBE: mainVideoDay ? 1 : 0,
    YOUTUBE_SHORTS: mainVideoDay ? 0 : 1,
  };
}

function hasExternalScheduleReceipt(post, group = {}) {
  const tags = [...(post.internal?.tags ?? []), ...(group.internal?.tags ?? [])];
  return Boolean(
    post.external_schedule_receipt
    || post.external_schedule_id
    || tags.includes('external-schedule-verified')
  );
}

function packageIsReady(pkg) {
  if (!pkg || pkg.status !== 'ACCEPTED') return false;
  const checks = (pkg.quality_reviews ?? []).filter((review) => review.review_type !== 'HUMAN_APPROVAL');
  return checks.length > 0 && checks.every((review) => review.verdict === 'PASS');
}

/** 投稿内容は承認済みだが、外部SNSとの接続だけが残っている状態。 */
function approvedConnectionRequired(post) {
  return post.display_state === 'ACTION_REQUIRED'
    && post.failure_kind === 'CREDENTIAL_EXPIRED'
    && Boolean(post.approval_id);
}

export function pipelineStage(post, pkg, group = {}) {
  if (post.display_state === 'SCHEDULED' || post.display_state === 'PUBLISHING') {
    return hasExternalScheduleReceipt(post, group) ? 'SCHEDULED' : 'EXTERNAL_PENDING';
  }
  if (post.display_state === 'PENDING_APPROVAL') return 'APPROVAL';
  if (approvedConnectionRequired(post)) return 'CONNECTION_REQUIRED';
  if (post.display_state === 'ACTION_REQUIRED') return 'CREATING';
  if (productionProgress(post.production ?? null).complete || packageIsReady(pkg)) return 'APPROVAL';
  return 'CREATING';
}

/** 予約確認では、承認画面に載った状態と、載せられる準備完了状態を分ける。 */
export function reservationStage(post, pkg, group = {}) {
  if (post.display_state === 'SCHEDULED' || post.display_state === 'PUBLISHING') {
    return hasExternalScheduleReceipt(post, group) ? 'SCHEDULED' : 'EXTERNAL_PENDING';
  }
  if (post.display_state === 'PENDING_APPROVAL') return 'APPROVAL';
  if (approvedConnectionRequired(post)) return 'CONNECTION_REQUIRED';
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
    requirements: platformRequirements(shiftDateKey(todayKey, index)),
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
      : reservationStage(post, packages.get(post.post_group_id), group);
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
    day.coverage = Object.fromEntries(Object.entries(day.requirements).map(([platform, required]) => {
      const matching = day.items.filter((item) => item.platform === platform);
      const confirmed = matching.filter((item) => item.stage === 'SCHEDULED' || item.stage === 'PUBLISHED').length;
      return [platform, { required, confirmed, total: matching.length }];
    }));
    day.complete = Object.values(day.coverage).every(({ required, confirmed }) => required === 0 || confirmed >= required);
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

function statusPlatform(channel, requirements) {
  if (channel.id === 'note') return 'NOTE';
  if (channel.id === 'x') return 'X';
  if (channel.id === 'instagram') return 'INSTAGRAM';
  if (channel.id === 'youtube') {
    return requirements.YOUTUBE_SHORTS > 0 || /Shorts/i.test(channel.label ?? '')
      ? 'YOUTUBE_SHORTS'
      : 'YOUTUBE';
  }
  return String(channel.id ?? '').toUpperCase();
}

function statusPendingStage(state) {
  if (['AUTH_WAIT', 'AUTH_REQUIRED', 'CONNECTION_REQUIRED'].includes(state)) return 'CONNECTION_REQUIRED';
  if (['APPROVAL_WAIT', 'AWAITING_APPROVAL', 'PENDING_APPROVAL', 'READY'].includes(state)) return 'APPROVAL';
  if (['EXTERNAL_WAIT', 'EXTERNAL_PENDING'].includes(state)) return 'EXTERNAL_PENDING';
  return 'CREATING';
}

/**
 * status.json は公開receiptを集約した正本である。今日の媒体カードは、制作run由来の
 * 仮channelPostよりこの集約値を優先し、上段と3日枠の件数・状態を一致させる。
 */
export function reconcileTodayFromStatus(plan, today = {}) {
  const day = plan.days?.[0];
  if (!day || !Array.isArray(today.channels) || today.channels.length === 0) return plan;

  const items = [];
  for (const channel of today.channels) {
    const platform = statusPlatform(channel, day.requirements);
    const target = Math.max(0, Number(channel.target ?? day.requirements[platform] ?? 0));
    const done = Math.min(target, Math.max(0, Number(channel.done ?? 0)));
    const completedStage = channel.state === 'SCHEDULED' ? 'SCHEDULED' : 'PUBLISHED';
    const pendingStage = statusPendingStage(channel.state);
    for (let index = 0; index < target; index += 1) {
      items.push({
        id: `status:${today.date ?? day.dateKey}:${channel.id}:${index + 1}`,
        title: channel.status ?? channel.label ?? channel.id,
        brandId: 'news',
        platform,
        scheduledAt: null,
        stage: index < done ? completedStage : pendingStage,
      });
    }
  }

  day.items = items;
  day.counts = emptyCounts();
  day.publishedCount = 0;
  for (const item of items) {
    if (item.stage === 'PUBLISHED') day.publishedCount += 1;
    else day.counts[item.stage] += 1;
  }
  day.coverage = Object.fromEntries(Object.entries(day.requirements).map(([platform, required]) => {
    const matching = items.filter((item) => item.platform === platform);
    const confirmed = matching.filter((item) => item.stage === 'SCHEDULED' || item.stage === 'PUBLISHED').length;
    return [platform, { required, confirmed, total: matching.length }];
  }));
  day.complete = Object.values(day.coverage).every(({ required, confirmed }) => required === 0 || confirmed >= required);
  plan.complete = plan.days.every((candidate) => candidate.complete);
  return plan;
}
