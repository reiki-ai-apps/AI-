// 2つ以上の事業を混ぜず、投稿日×媒体×工程だけを一目で確認する面。

import { el } from '../core/dom.js';
import { platformName } from '../domain/platforms.js';
import { intendedDate, pipelineStage } from '../domain/reservationPlan.js';
import { platformBadge } from './platformBadge.js';

const ALL_PLATFORMS = Object.freeze(['X', 'INSTAGRAM', 'YOUTUBE', 'NOTE']);
const PLATFORMS_BY_BUSINESS = Object.freeze({
  // REIKIは現在、XとInstagramだけを運用対象にする。
  creative: Object.freeze(['X', 'INSTAGRAM']),
  news: ALL_PLATFORMS,
});
const STAGES = Object.freeze([
  { id: 'CREATING', label: '制作中', tone: 'progress' },
  { id: 'APPROVAL', label: '承認待ち', tone: 'attention' },
  { id: 'SCHEDULED', label: '予約済み', tone: 'scheduled' },
]);

const BUSINESS_LABELS = Object.freeze({
  news: 'KIZASHI（AIニュース）',
  creative: 'REIKI（制作・集客）',
});

function emptyCounts() {
  return Object.fromEntries(STAGES.map((stage) => [stage.id, 0]));
}

/** 純粋集計。公開済みは投稿履歴へ分離し、これから公開する投稿だけを数える。 */
export function summarizeBusinessPipeline({ posts = [], postGroups = [], publicationPackages = [] }) {
  const groups = new Map(postGroups.map((group) => [group.post_group_id, group]));
  const packages = new Map(publicationPackages.map((pkg) => [pkg.post_group_id, pkg]));
  const businesses = new Map();

  for (const post of posts) {
    if (post.deleted_at || post.cancelled_at || post.display_state === 'PUBLISHED') continue;
    const group = groups.get(post.post_group_id) ?? {};
    const businessId = group.brand_id ?? post.brand_id ?? group.source_skill ?? 'other';
    const business = businesses.get(businessId) ?? {
      id: businessId,
      label: BUSINESS_LABELS[businessId] ?? businessId,
      sourceSkill: group.source_skill ?? null,
      totals: emptyCounts(),
      days: new Map(),
    };
    businesses.set(businessId, business);

    const isProductionRun = post.internal?.tags?.includes('production-run') ?? false;
    // KIZASHIの制作runは公開予約ではない。ただし、いつ確認した次回分かは残す。
    const dateKey = isProductionRun ? (post.calendar_date_key ?? 'UNSCHEDULED') : (intendedDate(post) ?? 'UNSCHEDULED');
    const day = business.days.get(dateKey) ?? {
      dateKey,
      isProductionRun,
      platforms: Object.fromEntries(ALL_PLATFORMS.map((platform) => [platform, emptyCounts()])),
    };
    business.days.set(dateKey, day);

    if (!day.platforms[post.platform]) day.platforms[post.platform] = emptyCounts();
    const stage = pipelineStage(post, packages.get(post.post_group_id));
    day.platforms[post.platform][stage] += 1;
    business.totals[stage] += 1;
  }

  return [...businesses.values()]
    .map((business) => ({
      ...business,
      days: [...business.days.values()].sort((a, b) => {
        if (a.dateKey === 'UNSCHEDULED') return 1;
        if (b.dateKey === 'UNSCHEDULED') return -1;
        return a.dateKey.localeCompare(b.dateKey);
      }),
    }))
    .sort((a, b) => (a.id === 'news' ? -1 : b.id === 'news' ? 1 : a.label.localeCompare(b.label, 'ja')));
}

export function buildBusinessPipelinePanel(input) {
  const businesses = summarizeBusinessPipeline(input);
  return el('section', { class: 'card business-pipeline' },
    el('div', { class: 'business-pipeline-head' },
      el('div', null,
        el('h2', { class: 'card-title' }, '2事業｜投稿の進み具合'),
        el('p', { class: 'field-hint' }, '承認待ちは、制作完了後のあなたの最終確認待ちです。'))),
    businesses.length
      ? el('div', { class: 'business-pipeline-list' }, ...businesses.map((business) => buildBusiness(business)))
      : el('p', { class: 'empty-state' }, '制作中・承認待ち・予約済みの投稿はありません。'));
}

function buildBusiness(business) {
  const total = Object.values(business.totals).reduce((a, b) => a + b, 0);
  return el('article', { class: 'business-block' },
    el('div', { class: 'business-block-head' },
      el('h3', { class: 'business-block-title' }, business.label),
      el('span', { class: 'business-block-total' }, `${total}件`)),
    el('p', { class: 'business-action-summary' }, businessSummary(business)),
  el('div', { class: 'business-day-list' }, ...business.days.map((day) => buildDay(day, business))));
}

function buildDay(day, business) {
  const label = day.isProductionRun
    ? `${dateLabel(day.dateKey)}確認分｜公開日未定`
    : day.dateKey === 'UNSCHEDULED' ? '投稿日未定' : `${dateLabel(day.dateKey)}用`;
  const platforms = PLATFORMS_BY_BUSINESS[business.id] ?? ALL_PLATFORMS;
  const rows = platforms.map((platform) =>
    el('div', { class: 'business-platform-row' },
      el('div', { class: 'business-platform-name' },
        platformBadge(platform, { size: 19, decorative: true }),
        platformName(platform)),
      stageSummary(day.platforms[platform] ?? emptyCounts())));
  return el('section', { class: 'business-day' },
    el('h4', { class: 'business-day-title' }, label),
    el('div', { class: 'business-platform-list' }, ...rows));
}

function businessSummary(business) {
  const { totals } = business;
  if (totals.APPROVAL > 0) return `最優先：${totals.APPROVAL}件の承認後、予約へ進めます。`;
  if (totals.CREATING > 0) return `いま：${totals.CREATING}件を制作中です。公開日は未定です。`;
  if (totals.SCHEDULED > 0) return `予約済み：${totals.SCHEDULED}件です。`;
  return '予定はありません。';
}

function stageSummary(counts) {
  const active = STAGES.filter((stage) => (counts[stage.id] ?? 0) > 0);
  if (!active.length) return el('span', { class: 'business-stage-summary is-empty' }, '予定なし');
  return el('span', { class: 'business-stage-summary' }, ...active.map((stage) =>
    el('span', { class: `business-stage-pill is-${stage.tone}` }, `${stage.label} ${counts[stage.id]}件`)));
}

function dateLabel(dateKey) {
  const [, month, day] = dateKey.split('-').map(Number);
  const weekday = new Intl.DateTimeFormat('ja-JP', { weekday: 'short', timeZone: 'UTC' })
    .format(new Date(`${dateKey}T00:00:00Z`));
  return `${month}/${day}（${weekday}）`;
}
