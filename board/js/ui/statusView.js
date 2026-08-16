import { el, button } from '../core/dom.js';
import { clockLabel, dayHeading } from '../core/fmt.js';
import { platformName } from '../domain/platforms.js';
import { platformBadge } from './platformBadge.js';
import { buildReservationPlan } from '../domain/reservationPlan.js';

const STATE_LABELS = {
  HEALTHY: '問題なし',
  ATTENTION: '確認あり',
  BLOCKED: '停止中',
  HOLD: '待機中',
  DANGER: '予約不足',
  UNKNOWN: '未確認',
};

const BLOCKER_COPY = {
  'news-primary-source-quorum': ['次回ニュース', '新しい公式情報が3件そろうまで待機'],
  'note-profile-links': ['note', 'プロフィールのSNSリンクを確認'],
  'youtube-short-verification': ['YouTube', 'Shortsの公開結果を確認'],
};

const CHANNEL_ATTENTION_COPY = {
  note: 'プロフィールのSNSリンクを確認',
  youtube: 'Shortsの公開結果を確認',
};

function dateTime(value) {
  if (!value) return '未確認';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function externalLink(label, url) {
  if (!url) return null;
  return el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, label);
}

export function blockerSummary(item = {}) {
  const known = BLOCKER_COPY[item.id];
  if (known) return { title: known[0], action: known[1] };
  return { title: '確認事項', action: item.message || '内容を確認してください' };
}

export function productionOverview(production = {}) {
  const run = production.last_run ?? {};
  const verified = Number(run.verified_primary_count ?? 0);
  const required = Number(run.required_primary_count ?? 0);
  const ready = required > 0 && verified >= required;
  const cadence = String(production.cadence ?? '').match(/^PT(\d+)H$/)?.[1];
  return {
    headline: ready ? '制作を始められます' : '新しい公式情報を確認中',
    progress: required > 0 ? `${verified} / ${required}件` : '件数未確認',
    next: ready ? '次：原稿と映像を制作' : `次の確認：${cadence ? `${cadence}時間後` : '後ほど'}`,
  };
}

export function channelBrief(channel = {}) {
  if (channel.reservation_state !== 'COVERED') return '危険：2日先まで予約されていません';
  if (channel.state === 'ATTENTION') {
    return CHANNEL_ATTENTION_COPY[channel.id] ?? channel.note ?? '内容を確認してください';
  }
  if (channel.state === 'BLOCKED') return '現在停止しています';
  if (channel.state === 'UNKNOWN') return 'まだ確認できていません';
  return channel.next_scheduled ? `次回：${dateTime(channel.next_scheduled.scheduled_at)}` : '問題ありません';
}

function channelCard(channel) {
  const state = channel.reservation_state === 'COVERED' ? (channel.state ?? 'UNKNOWN') : 'DANGER';
  const latest = channel.latest_published ?? null;
  const next = channel.next_scheduled ?? null;
  return el('article', { class: 'status-card status-channel' },
    el('div', { class: 'status-card-head' },
      el('div', null,
        el('h2', { class: 'status-card-title' }, channel.label),
        el('p', { class: 'status-account' }, channel.account ?? '')),
      el('span', { class: `status-pill status-pill-${state.toLowerCase()}` }, STATE_LABELS[state] ?? state)),
    el('p', { class: `status-channel-brief${state === 'ATTENTION' || state === 'DANGER' ? ' is-danger' : ''}` }, channelBrief(channel)),
    el('details', { class: 'status-details' },
      el('summary', null, '詳しく見る'),
      el('dl', { class: 'status-kv' },
        el('dt', null, '確認日時'), el('dd', null, dateTime(channel.last_verified_at)),
        el('dt', null, '最新公開'), el('dd', null,
          latest
            ? el('span', null, latest.title ?? '公開済み', latest.url ? ' ' : '', externalLink('開く', latest.url))
            : '公開記録なし'),
        el('dt', null, '次回'), el('dd', null,
          next ? `${dateTime(next.scheduled_at)} ${next.title ?? ''}`.trim() : '予約なし')),
      channel.note ? el('p', { class: 'status-note' }, channel.note) : null,
      channel.url ? el('p', { class: 'status-link' }, externalLink('公開ページを開く', channel.url)) : null),
  );
}

const PLAN_STAGES = Object.freeze({
  SCHEDULED: { label: '予約済み', tone: 'scheduled' },
  APPROVAL: { label: '承認待ち', tone: 'attention' },
  READY: { label: '承認準備済み', tone: 'ready' },
  CREATING: { label: '未予約', tone: 'danger' },
});

function businessLabel(id) {
  if (id === 'news') return 'KIZASHI';
  if (id === 'creative') return 'REIKI';
  return id;
}

function relativeDayLabel(index) {
  if (index === 0) return '今日';
  if (index === 1) return '明日';
  return `${index}日後`;
}

function planItem(item, timeZone) {
  const stage = PLAN_STAGES[item.stage] ?? PLAN_STAGES.CREATING;
  const timeMs = Date.parse(item.scheduledAt ?? '');
  const time = Number.isFinite(timeMs) ? clockLabel(timeMs, timeZone) : '時刻未定';
  return el('li', { class: `status-plan-item is-${stage.tone}` },
    el('div', { class: 'status-plan-item-main' },
      el('span', { class: 'status-plan-platform' },
        platformBadge(item.platform, { size: 22, decorative: true }),
        el('span', null, platformName(item.platform))),
      el('strong', { class: 'status-plan-item-title' }, item.title),
      el('span', { class: 'status-plan-item-meta' },
        `${businessLabel(item.brandId)}｜${item.stage === 'SCHEDULED' ? '予約' : '予定'} ${time}`)),
    el('span', { class: `status-plan-state is-${stage.tone}` }, stage.label));
}

function planDay(day, timeZone) {
  const counts = day.counts;
  return el('section', { class: `status-plan-day${day.complete ? ' is-complete' : ' is-incomplete'}` },
    el('div', { class: 'status-plan-day-head' },
      el('h3', { class: 'status-plan-day-title' }, `${relativeDayLabel(day.index)}｜${dayHeading(day.dateKey)}`),
      el('span', { class: `status-plan-day-result${day.complete ? ' is-complete' : ' is-incomplete'}` }, day.complete ? '予約完了' : '未完了')),
    el('p', { class: 'status-plan-counts' },
      `予約 ${counts.SCHEDULED}件　承認待ち ${counts.APPROVAL}件　承認準備 ${counts.READY}件　未予約 ${counts.CREATING}件`),
    day.items.length
      ? el('ul', { class: 'status-plan-items' }, ...day.items.map((item) => planItem(item, timeZone)))
      : el('div', { class: 'status-plan-empty' },
        el('strong', null, '投稿が登録されていません'),
        el('span', null, '内容・媒体・時刻が未準備です。')));
}

function reservationPanel(plan, timeZone, app) {
  const incomplete = !plan.complete;
  return el('section', { class: `status-reservation${incomplete ? ' is-danger' : ' is-safe'}` },
    el('div', { class: 'status-reservation-head' },
      el('div', null,
        el('p', { class: 'status-eyebrow' }, '最優先'),
        el('h2', { class: 'status-reservation-title' }, incomplete ? '2日先までの予約が未完了です' : '2日先まで予約済みです')),
      el('span', { class: `status-pill status-pill-${incomplete ? 'danger' : 'healthy'}` }, incomplete ? '危険' : '安全')),
    el('p', { class: 'status-reservation-instruction' },
      `承認待ち ${plan.totals.APPROVAL}件・承認準備済み ${plan.totals.READY}件・未予約 ${plan.totals.CREATING}件・投稿未登録 ${plan.totals.UNPLANNED_DAYS}日`),
    el('div', { class: 'status-plan-days', 'aria-label': '今日から2日先までの投稿別予約状況' },
      ...plan.days.map((day) => planDay(day, timeZone))),
    el('div', { class: 'status-plan-actions' },
      button('3日予定を見る', { class: 'btn btn-outline', onClick: () => app.go('calendar', { selectedDateKey: plan.days[0].dateKey }) }),
      plan.totals.APPROVAL > 0
        ? button(`承認待ち ${plan.totals.APPROVAL}件を見る`, { class: 'btn btn-primary', onClick: () => app.go('approvals') })
        : null),
    el('p', { class: 'status-reservation-rule' }, '投稿ごとに「予約済み」になるまで危険表示を続けます。'));
}

function productionCard(production) {
  if (!production?.last_run) return null;
  const run = production.last_run;
  const state = run.state ?? 'UNKNOWN';
  const overview = productionOverview(production);
  return el('section', { class: 'card status-production' },
    el('div', { class: 'status-card-head' },
      el('div', null,
        el('p', { class: 'status-eyebrow' }, '次のニュース'),
        el('h2', { class: 'status-production-title' }, overview.headline)),
      el('span', { class: `status-pill status-pill-${state.toLowerCase()}` }, STATE_LABELS[state] ?? state)),
    el('div', { class: 'status-production-summary' },
      el('strong', null, overview.progress),
      el('span', null, overview.next)),
    el('details', { class: 'status-details' },
      el('summary', null, '詳しい理由'),
      el('dl', { class: 'status-kv' },
        el('dt', null, '現在'), el('dd', null, run.stage ?? '未確認'),
        el('dt', null, '実行日時'), el('dd', null, dateTime(run.finished_at ?? run.started_at))),
      run.reason ? el('p', { class: 'status-note' }, run.reason) : null,
      el('p', { class: 'status-note' }, production.policy ?? '品質確認後に公開します。')),
  );
}

function otherIssues(blockers) {
  if (!blockers.length) return null;
  return el('details', { class: 'status-actions status-other-issues' },
    el('summary', null, `その他の確認（${blockers.length}）`),
    el('ul', { class: 'status-action-list' }, ...blockers.map((item) => {
      const copy = blockerSummary(item);
      return el('li', null, el('strong', null, copy.title), el('span', null, copy.action));
    })));
}

function channelSection(channels) {
  return el('details', { class: 'status-service-details' },
    el('summary', null, `媒体の確認結果（${channels.length}）`),
    el('section', { class: 'status-grid', 'aria-label': '各サービスの状況' }, ...channels.map(channelCard)));
}

export async function renderStatusScreen(app) {
  const response = await fetch(`data/status.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`運用状況を取得できませんでした（HTTP ${response.status}）。`);
  const data = await response.json();
  const blockers = data.blockers ?? [];
  const channels = (data.channels ?? []).filter((channel) => channel.id !== 'radar');
  const [posts, postGroups, publicationPackages] = await Promise.all([
    app.ctx.repo.listPipelinePosts(),
    app.ctx.repo.listPostGroups(),
    app.ctx.repo.listPublicationPackages(),
  ]);
  const reservationPlan = buildReservationPlan({
    posts,
    postGroups,
    publicationPackages,
    todayKey: app.todayKey(),
    horizonDays: 2,
  });
  return el('div', { class: 'screen status-screen' },
    el('div', { class: 'screen-head status-head' },
      el('div', null,
        el('h1', { class: 'screen-title' }, '2日先までの予約'),
        el('p', { class: 'screen-desc' }, `${dayHeading(app.todayKey())}を基準｜媒体情報 ${dateTime(data.generated_at)} 更新`)),
      button('更新', { class: 'btn btn-outline status-refresh', onClick: () => app.refresh() })),
    reservationPanel(reservationPlan, app.timeZone, app),
    productionCard(data.production),
    otherIssues(blockers),
    channelSection(channels),
    el('p', { class: 'status-monitor-simple' },
      `自動確認：1時間ごと・${data.monitoring?.report_policy ?? '変化がある時だけ通知'}`),
  );
}
