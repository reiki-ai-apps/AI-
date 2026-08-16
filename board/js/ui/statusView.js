import { el, button } from '../core/dom.js';

const STATE_LABELS = {
  HEALTHY: '正常',
  ATTENTION: '要確認',
  BLOCKED: '停止中',
  UNKNOWN: '未確認',
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

function channelCard(channel) {
  const state = channel.state ?? 'UNKNOWN';
  const latest = channel.latest_published ?? null;
  const next = channel.next_scheduled ?? null;
  return el('article', { class: 'status-card' },
    el('div', { class: 'status-card-head' },
      el('div', null,
        el('h2', { class: 'status-card-title' }, channel.label),
        el('p', { class: 'status-account' }, channel.account ?? '')),
      el('span', { class: `status-pill status-pill-${state.toLowerCase()}` }, STATE_LABELS[state] ?? state)),
    el('dl', { class: 'status-kv' },
      el('dt', null, '最終確認'), el('dd', null, dateTime(channel.last_verified_at)),
      el('dt', null, '最新公開'), el('dd', null,
        latest
          ? el('span', null, latest.title ?? '公開済み', latest.url ? ' ' : '', externalLink('開く', latest.url))
          : '確認できる公開証跡なし'),
      el('dt', null, '次回予定'), el('dd', null,
        next ? `${dateTime(next.scheduled_at)} ${next.title ?? ''}`.trim() : '予約なし')),
    channel.note ? el('p', { class: 'status-note' }, channel.note) : null,
    channel.url ? el('p', { class: 'status-link' }, externalLink('公開ページを確認', channel.url)) : null,
  );
}

function productionCard(production) {
  if (!production?.last_run) return null;
  const run = production.last_run;
  const state = run.state ?? 'UNKNOWN';
  return el('section', { class: 'card status-production' },
    el('div', { class: 'status-card-head' },
      el('div', null,
        el('h2', { class: 'card-title' }, '次回コンテンツ制作'),
        el('p', { class: 'screen-desc' }, `実行ID ${run.run_id ?? '未確認'}｜${dateTime(run.finished_at ?? run.started_at)}`)),
      el('span', { class: `status-pill status-pill-${state.toLowerCase()}` }, STATE_LABELS[state] ?? (state === 'HOLD' ? '品質保留' : state))),
    el('dl', { class: 'status-kv' },
      el('dt', null, '現在工程'), el('dd', null, run.stage ?? '未確認'),
      el('dt', null, '一次情報'), el('dd', null, `${run.verified_primary_count ?? '未確認'} / ${run.required_primary_count ?? '未確認'}件`),
      el('dt', null, '次の対応'), el('dd', null, run.next_action ?? '未設定')),
    run.reason ? el('p', { class: 'status-note' }, run.reason) : null,
    el('p', { class: 'screen-desc' }, production.policy ?? '品質ゲート通過後に公開工程へ進みます。'));
}

export async function renderStatusScreen(app) {
  const response = await fetch(`data/status.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`運用状況を取得できませんでした（HTTP ${response.status}）。`);
  const data = await response.json();
  const blockers = data.blockers ?? [];
  return el('div', { class: 'screen status-screen' },
    el('div', { class: 'screen-head status-head' },
      el('div', null,
        el('h1', { class: 'screen-title' }, 'KIZASHI 運用状況'),
        el('p', { class: 'screen-desc' }, `最終同期 ${dateTime(data.generated_at)}｜${data.time_zone ?? 'Asia/Tokyo'}`)),
      button('最新状態を確認', { class: 'btn btn-primary', onClick: () => app.refresh() })),
    el('div', { class: blockers.length ? 'notice notice-attention' : 'notice' },
      el('div', null,
        el('div', { class: 'notice-title' }, blockers.length ? `要確認 ${blockers.length}件` : '現在、重大な停止はありません'),
        el('div', { class: 'notice-body' }, blockers.length
          ? blockers.map((item) => item.message).join('／')
          : '変化または停止理由が見つかったときだけ、このタスクへ報告します。'))),
    el('section', { class: 'status-summary', 'aria-label': '全体状況' },
      el('div', { class: 'status-metric' }, el('strong', null, String(data.summary?.published_confirmed ?? 0)), el('span', null, '公開確認済み')),
      el('div', { class: 'status-metric' }, el('strong', null, String(data.summary?.scheduled ?? 0)), el('span', null, '予約済み')),
      el('div', { class: 'status-metric' }, el('strong', null, String(data.summary?.attention ?? blockers.length)), el('span', null, '要確認'))),
    productionCard(data.production),
    el('section', { class: 'status-grid', 'aria-label': '媒体別の状況' }, ...(data.channels ?? []).map(channelCard)),
    el('section', { class: 'card status-monitor' },
      el('h2', { class: 'card-title' }, '自動監視'),
      el('p', null, data.monitoring?.description ?? '定期監視は未設定です。'),
      el('p', { class: 'screen-desc' }, `報告条件：${data.monitoring?.report_policy ?? '変化・障害のみ'}`)),
  );
}
