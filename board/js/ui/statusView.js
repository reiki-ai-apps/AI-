import { el, button } from '../core/dom.js';

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

function shortDate(value) {
  const match = String(value ?? '').match(/^\d{4}-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[1])}/${Number(match[2])}` : String(value ?? '日付未確認');
}

export function reservationOverview(reservation = {}) {
  const horizonDays = Number(reservation.horizon_days ?? 2);
  const requiredCount = horizonDays + 1;
  const days = Array.isArray(reservation.days) ? reservation.days.slice(0, requiredCount) : [];
  const missingCount = days.filter((day) => day.state !== 'RESERVED').length + Math.max(0, requiredCount - days.length);
  const complete = days.length === requiredCount && missingCount === 0;
  return {
    complete,
    missingCount,
    headline: complete ? '2日先まで予約済みです' : `危険：${missingCount}日分が未予約です`,
    instruction: complete
      ? '今日・明日・2日後の予約を確認できました。'
      : '今日・明日・2日後の予約をすべて完了してください。',
    days: days.map((day, index) => ({
      label: index === 0 ? '今日' : index === 1 ? '明日' : `${index}日後`,
      date: shortDate(day.date),
      reserved: day.state === 'RESERVED',
    })),
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

function reservationPanel(reservation) {
  const overview = reservationOverview(reservation);
  return el('section', { class: `status-reservation${overview.complete ? ' is-safe' : ' is-danger'}` },
    el('div', { class: 'status-reservation-head' },
      el('div', null,
        el('p', { class: 'status-eyebrow' }, '最優先'),
        el('h2', { class: 'status-reservation-title' }, overview.headline)),
      el('span', { class: `status-pill status-pill-${overview.complete ? 'healthy' : 'danger'}` }, overview.complete ? '安全' : '危険')),
    el('p', { class: 'status-reservation-instruction' }, overview.instruction),
    el('div', { class: 'status-day-grid', 'aria-label': '今日から2日先までの予約状況' },
      ...overview.days.map((day) => el('div', { class: `status-day${day.reserved ? ' is-reserved' : ' is-missing'}` },
        el('span', { class: 'status-day-label' }, day.label),
        el('strong', null, day.date),
        el('span', { class: 'status-day-state' }, day.reserved ? '予約済み' : '未予約')))),
    el('p', { class: 'status-reservation-rule' }, '1日でも未予約なら「危険」のままです。'));
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

export async function renderStatusScreen(app) {
  const response = await fetch(`data/status.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`運用状況を取得できませんでした（HTTP ${response.status}）。`);
  const data = await response.json();
  const blockers = data.blockers ?? [];
  const channels = (data.channels ?? []).filter((channel) => channel.id !== 'radar');
  return el('div', { class: 'screen status-screen' },
    el('div', { class: 'screen-head status-head' },
      el('div', null,
        el('h1', { class: 'screen-title' }, '2日先までの予約'),
        el('p', { class: 'screen-desc' }, `${dateTime(data.generated_at)} 更新`)),
      button('更新', { class: 'btn btn-outline status-refresh', onClick: () => app.refresh() })),
    reservationPanel(data.reservation_horizon),
    productionCard(data.production),
    otherIssues(blockers),
    el('h2', { class: 'status-section-title status-channels-title' }, '各サービス'),
    el('section', { class: 'status-grid', 'aria-label': '各サービスの状況' }, ...channels.map(channelCard)),
    el('p', { class: 'status-monitor-simple' },
      `自動確認：1時間ごと・${data.monitoring?.report_policy ?? '変化がある時だけ通知'}`),
  );
}
