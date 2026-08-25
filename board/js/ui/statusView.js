import { el } from '../core/dom.js';
import { dayHeading } from '../core/fmt.js';
import { platformBadge } from './platformBadge.js';
import { buildReservationPlan } from '../domain/reservationPlan.js';

const STATE_LABELS = {
  HEALTHY: '問題なし',
  ATTENTION: '確認あり',
  BLOCKED: '停止中',
  HOLD: '待機中',
  DANGER: '予約不足',
  UNKNOWN: '未確認',
  EXECUTING: '進行中',
  PRODUCTION: '制作中',
  APPROVAL_WAIT: '確認待ち',
  EXTERNAL_WAIT: '外部予約待ち',
  AUTH_WAIT: '接続・認証待ち',
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

function todayStatePill(state) {
  const tone = ({
    PUBLISHED: 'healthy', SCHEDULED: 'healthy', PRODUCTION: 'progress',
    EXECUTING: 'progress', APPROVAL_WAIT: 'attention', EXTERNAL_WAIT: 'attention', AUTH_WAIT: 'blocked',
  })[state] ?? 'unknown';
  return el('span', { class: `status-pill status-pill-${tone}` }, STATE_LABELS[state] ?? state ?? '未確認');
}

function todaySummary(today) {
  if (!today) return null;
  const done = Number(today.completed ?? 0);
  const target = Number(today.target ?? 0);
  const percent = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  return el('section', { class: 'today-command', 'aria-label': '今日の投稿状況' },
    el('div', { class: 'today-command-main' },
      el('p', { class: 'today-command-kicker' }, `${today.date ?? '今日'}の投稿`),
      el('div', { class: 'today-command-count' }, el('strong', null, `${done}/${target}`), el('span', null, '公開・予約receipt確認済み')),
      el('div', { class: 'today-command-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(target), 'aria-valuenow': String(done) },
        el('span', { style: `width:${percent}%` })),
      el('p', { class: 'today-command-headline' }, today.headline ?? '状態を確認中です。')),
    el('div', { class: 'today-command-next' },
      el('span', null, '次にやること'),
      el('strong', null, today.next_action ?? '未設定'),
      today.next_deadline ? el('small', null, `次回確認 ${dateTime(today.next_deadline)}`) : null,
      el('em', { class: today.owner_action_required ? 'is-required' : '' }, `あなたの操作：${today.owner_action ?? '今はありません'}`)),
    el('div', { class: 'today-command-channels' }, ...(today.channels ?? []).map((channel) => {
      const channelDone = Number(channel.done ?? 0);
      const channelTarget = Number(channel.target ?? 0);
      return el('article', { class: 'today-command-channel' },
        el('div', { class: 'today-command-channel-head' },
          el('h2', null, channel.label ?? channel.id),
          el('strong', null, `${channelDone}/${channelTarget}`),
          todayStatePill(channel.state)),
        el('p', { class: 'today-command-status' }, channel.status ?? '確認中'),
        el('p', { class: 'today-command-action' }, `次：${channel.next ?? '未設定'}`),
        el('p', { class: 'today-command-blocker' }, `停止理由：${channel.blocker ?? 'なし'}`),
        channel.url ? externalLink(channel.state === 'APPROVAL_WAIT' ? '完成物を確認する' : '公開物を開く', channel.url) : null);
    })));
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
  PUBLISHED: { label: '投稿済み', mark: '✓', tone: 'published' },
  SCHEDULED: { label: '予約済み', mark: '◎', tone: 'scheduled' },
  EXTERNAL_PENDING: { label: '外部予約待ち', mark: '◷', tone: 'attention' },
  CONNECTION_REQUIRED: { label: '初回接続が必要', mark: '↗', tone: 'attention' },
  APPROVAL: { label: '承認待ち', mark: '◷', tone: 'attention' },
  READY: { label: '承認待ち', mark: '◷', tone: 'attention' },
  CREATING: { label: '作成中', mark: '×', tone: 'danger' },
  MISSING: { label: '未登録', mark: '＋', tone: 'danger' },
});

function relativeDayLabel(index) {
  if (index === 0) return '今日';
  if (index === 1) return '明日';
  return `${index}日後`;
}

const STATUS_BADGES = Object.freeze([
  { platform: 'NOTE', label: 'note' },
  { platform: 'X', label: 'X' },
  { platform: 'INSTAGRAM', label: 'Instagram' },
  { platform: 'YOUTUBE', label: 'YouTube' },
  { platform: 'YOUTUBE_SHORTS', label: 'Shorts' },
]);

function badgesForDay(day) {
  return STATUS_BADGES
    .map((badge) => ({ ...badge, required: day.requirements?.[badge.platform] ?? 0 }))
    .filter((badge) => badge.required > 0);
}

export function badgeProgressSummary(items, badge) {
  const matching = items.filter((item) => item.platform === badge.platform);
  const registered = matching.length;
  const published = matching.filter((item) => item.stage === 'PUBLISHED').length;
  const scheduled = matching.filter((item) => item.stage === 'SCHEDULED').length;
  const confirmed = published + scheduled;
  const required = badge.required ?? 1;
  const counts = matching.reduce((result, item) => {
    result[item.stage] = (result[item.stage] ?? 0) + 1;
    return result;
  }, {});
  let stage = PLAN_STAGES.CREATING;
  if (confirmed >= required) stage = published >= required ? PLAN_STAGES.PUBLISHED : PLAN_STAGES.SCHEDULED;
  else if (matching.some((item) => item.stage === 'EXTERNAL_PENDING')) stage = PLAN_STAGES.EXTERNAL_PENDING;
  else if (matching.some((item) => item.stage === 'CONNECTION_REQUIRED')) stage = PLAN_STAGES.CONNECTION_REQUIRED;
  else if (matching.some((item) => item.stage === 'APPROVAL' || item.stage === 'READY')) stage = PLAN_STAGES.APPROVAL;
  else if (registered === 0) stage = PLAN_STAGES.MISSING;
  const mark = confirmed >= required
    ? (published >= required ? `${required}済` : `${required}予約`)
    : `${Math.min(confirmed, required)}/${required}`;

  const progress = [];
  if (confirmed >= required) {
    progress.push({
      tone: stage.tone,
      mark: stage.mark,
      label: published >= required ? '公開済' : '予約済',
    });
  } else {
    const missing = Math.max(required - registered, 0);
    if (missing > 0) progress.push({ tone: 'danger', mark: '＋', label: `未登録 ${missing}` });
    if ((counts.CREATING ?? 0) > 0) progress.push({ tone: 'creating', mark: '●', label: `制作中 ${counts.CREATING}` });
    const approval = (counts.APPROVAL ?? 0) + (counts.READY ?? 0);
    if (approval > 0) progress.push({ tone: 'approval', mark: '!', label: `承認待ち ${approval}` });
    if ((counts.CONNECTION_REQUIRED ?? 0) > 0) {
      progress.push({ tone: 'external', mark: '↗', label: `接続のみ ${counts.CONNECTION_REQUIRED}` });
    }
    if ((counts.EXTERNAL_PENDING ?? 0) > 0) {
      progress.push({ tone: 'external', mark: '◷', label: `予約待ち ${counts.EXTERNAL_PENDING}` });
    }
    if (!progress.length) progress.push({ tone: 'danger', mark: '＋', label: `未登録 ${required}` });
  }
  return { stage, mark, confirmed, registered, required, progress };
}

function statusBadge(item, items) {
  const { stage, mark, confirmed, registered, required, progress } = badgeProgressSummary(items, item);
  const progressLabel = progress.map((part) => part.label).join('、');
  return el('div', {
    class: `status-sns-badge is-${stage.tone}`,
    'aria-label': `${item.label} ${confirmed}/${required}件完了、${progressLabel}`,
    title: `${item.label}：${confirmed}/${required}件完了（${registered}件登録）、${progressLabel}`,
  },
  platformBadge(item.platform, { size: 38, decorative: true }),
  el('span', { class: 'status-sns-name' }, item.label),
  el('span', { class: 'status-sns-progress', 'aria-hidden': 'true' },
    ...progress.map((part) => el('span', { class: `status-sns-progress-badge is-${part.tone}` },
      el('span', { class: 'status-sns-progress-symbol' }, part.mark),
      part.label))),
  el('span', { class: 'status-sns-count', 'aria-hidden': 'true' },
    el('span', { class: 'status-sns-count-label' }, '完了'),
    el('strong', { class: 'status-sns-mark' }, mark)));
}

export function planDayResultLabel(day) {
  if ((day.publishedCount ?? 0) > 0) return `${day.publishedCount}済`;
  return day.complete ? '予約完了' : '未完了';
}

function planDay(day) {
  const resultLabel = planDayResultLabel(day);
  const resultState = (day.publishedCount ?? 0) > 0
    ? 'is-published'
    : day.complete ? 'is-complete' : 'is-incomplete';
  return el('section', { class: `status-plan-day${day.complete ? ' is-complete' : ' is-incomplete'}` },
    el('div', { class: 'status-plan-day-head' },
      el('h3', { class: 'status-plan-day-title' }, `${relativeDayLabel(day.index)}｜${dayHeading(day.dateKey)}`),
      el('span', {
        class: `status-plan-day-result ${resultState}`,
        'aria-label': (day.publishedCount ?? 0) > 0 ? `${day.publishedCount}件投稿済み` : resultLabel,
      }, resultLabel)),
    el('div', { class: 'status-sns-grid' }, ...badgesForDay(day).map((item) => statusBadge(item, day.items))));
}

function reservationPanel(plan) {
  return el('section', { class: 'status-reservation status-reservation-simple' },
    el('div', { class: 'status-plan-days', 'aria-label': '今日から2日先までの投稿別予約状況' },
      ...plan.days.map((day) => planDay(day))));
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
  const [posts, postGroups, publicationPackages, statusResponse] = await Promise.all([
    app.ctx.repo.listPostsForReservationPlan(),
    app.ctx.repo.listPostGroups(),
    app.ctx.repo.listPublicationPackages(),
    fetch(`data/status.json?t=${Date.now()}`, { cache: 'no-store' }),
  ]);
  const status = statusResponse.ok ? await statusResponse.json() : {};
  const reservationPlan = buildReservationPlan({
    posts,
    postGroups,
    publicationPackages,
    todayKey: app.todayKey(),
    horizonDays: 2,
  });
  return el('div', { class: 'screen status-screen' },
    el('div', { class: 'screen-head' },
      el('div', null,
        el('h1', { class: 'screen-title' }, '今日の投稿状況'),
        el('p', { class: 'screen-desc' }, `正本同期 ${dateTime(status.generated_at)}｜公開・予約は外部receipt確認分のみ`))),
    todaySummary(status.today),
    el('h2', { class: 'status-channels-title' }, '今日・明日・2日後の枠'),
    reservationPanel(reservationPlan),
    productionCard(status.production),
    otherIssues(status.blockers ?? []),
    channelSection((status.channels ?? []).filter((channel) => channel.id !== 'radar')));
}
