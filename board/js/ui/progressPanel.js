// 進捗パネル — 「今日できたこと」と「いま止まっているもの」。
//
// 実際の報告は必ずこの2つで書かれる。カレンダーは日付で並ぶので、
// 「何が終わって、何が止まっていて、次に何をするか」は別に立てないと読み取れない。
//
// 止まっている理由は domain/production.js が出す。ここは並べるだけ。

import { el } from '../core/dom.js';
import { clockLabel } from '../core/fmt.js';
import { platformName } from '../domain/platforms.js';
import { displayLabel, displayState } from '../domain/state.js';
import { blockedList, productionProgress } from '../domain/production.js';
import { toPostView } from '../store/repo.js';
import { platformBadge } from './platformBadge.js';
import { openPostDetail } from './postDetail.js';

const BLOCK_TONE = Object.freeze({
  ACTION_REQUIRED: 'danger',
  REAPPROVAL: 'attention',
  APPROVAL: 'attention',
  PRODUCTION: 'progress',
  SCHEDULE: 'scheduled',
  PUBLISH: 'progress',
});

const MAX_ROWS = 8;

const STAGE_DEFINITIONS = Object.freeze([
  { id: 'WORKING', label: '制作中', tone: 'progress' },
  { id: 'COMPLETE', label: '制作完了', tone: 'published' },
  { id: 'PENDING_APPROVAL', label: '確認待ち', tone: 'attention' },
  { id: 'SCHEDULED', label: '予約済み', tone: 'scheduled' },
  { id: 'PUBLISHED', label: '投稿済み', tone: 'published' },
  { id: 'ACTION_REQUIRED', label: '要対応', tone: 'danger' },
]);

function stageOf(post) {
  if (post.display_state === 'PUBLISHED') return 'PUBLISHED';
  if (post.display_state === 'SCHEDULED' || post.display_state === 'PUBLISHING') return 'SCHEDULED';
  if (post.display_state === 'PENDING_APPROVAL') return 'PENDING_APPROVAL';
  if (post.display_state === 'ACTION_REQUIRED') return 'ACTION_REQUIRED';
  return productionProgress(post.production ?? null).complete ? 'COMPLETE' : 'WORKING';
}

export function progressStageSummary(posts = []) {
  const counts = Object.fromEntries(STAGE_DEFINITIONS.map((stage) => [stage.id, 0]));
  for (const post of posts.filter((row) => !row.deleted_at && !row.cancelled_at)) {
    counts[stageOf(post)] += 1;
  }
  return STAGE_DEFINITIONS.map((stage) => ({ ...stage, count: counts[stage.id] }));
}

/**
 * @param {object} app
 * @param {{posts:Array, todayKey:string, timeZone:string}} input posts は channelPosts の生の行
 */
export function buildProgressPanel(app, { posts, todayKey, timeZone }) {
  const nowMs = app.clock.nowMs();
  const done = posts.filter((p) => p.display_state === 'PUBLISHED' && p.calendar_date_key === todayKey);
  const blocked = blockedList(
    posts
      .filter((p) => !p.deleted_at && !p.cancelled_at)
      .map((p) => ({ post: toPostView(p, nowMs), production: p.production ?? null })),
  );

  return el('div', { class: 'card', style: { 'margin-bottom': '14px' } },
    el('h2', { class: 'card-title' }, 'いまの投稿状況'),
    buildStageOverview(progressStageSummary(posts)),
    buildDoneBlock(done, timeZone),
    buildBlockedBlock(app, blocked, timeZone),
  );
}

function buildStageOverview(stages) {
  return el('section', { class: 'progress-stage-grid', 'aria-label': '投稿工程ごとの件数' },
    ...stages.map((stage) =>
      el('div', { class: `progress-stage progress-stage-${stage.tone}` },
        el('span', { class: 'progress-stage-label' }, stage.label),
        el('strong', { class: 'progress-stage-count' }, String(stage.count)),
        el('span', { class: 'progress-stage-unit' }, '件'))));
}

// --- 今日できたこと ----------------------------------------------------------

function buildDoneBlock(done, timeZone) {
  const box = el('div', { style: { 'margin-top': '10px' } },
    el('div', { class: 'field-label' }, `今日できたこと（${done.length}件）`));

  if (!done.length) {
    box.appendChild(el('p', { class: 'field-hint' }, 'まだ今日の公開はありません。'));
    return box;
  }

  const list = el('ul', { class: 'plain-list' });
  for (const post of done) {
    list.appendChild(
      el('li', { class: 'progress-row' },
        platformBadge(post.platform, { size: 18, decorative: true }),
        el('span', { class: 'progress-time' }, clockLabel(Date.parse(post.published_at ?? post.scheduled_at), timeZone)),
        el('span', { class: 'progress-title' }, post.title || '（無題）'),
        el('span', { class: 'tag tone-published' }, '投稿済み'),
        post.public_url
          ? el('a', { href: post.public_url, target: '_blank', rel: 'noreferrer noopener' }, '投稿を見る')
          : el('span', { class: 'field-hint' }, `外部ID ${post.external_post_id ?? '—'}`)),
    );
  }
  box.appendChild(list);
  return box;
}

// --- 止まっているもの --------------------------------------------------------

function buildBlockedBlock(app, blocked, timeZone) {
  const box = el('div', { style: { 'margin-top': '14px' } },
    el('div', { class: 'field-label' }, `いま止まっているもの（${blocked.length}件）`));

  if (!blocked.length) {
    box.appendChild(el('p', { class: 'field-hint' }, '手当てが要るものはありません。'));
    return box;
  }

  const shown = blocked.slice(0, MAX_ROWS);
  box.appendChild(el('div', { class: 'progress-card-list' },
    ...shown.map(({ post, production, block }) => {
      const progress = productionProgress(production);
      return el('article', { class: 'progress-card' },
        el('div', { class: 'progress-card-head' },
          el('span', { class: 'progress-media' },
            platformBadge(post.platform, { size: 18, decorative: true }),
            platformName(post.platform)),
          el('span', { class: 'progress-time' }, clockLabel(post.scheduledAtMs, timeZone)),
          el('span', { class: `tag tone-${displayState(post.displayState).tone}` }, displayLabel(post.displayState))),
        el('button', {
          type: 'button', class: 'progress-card-title',
          onClick: () => openPostDetail(app, post.id),
        }, post.title || '（無題）'),
        el('div', { class: 'progress-card-progress' },
          production ? `制作 ${progress.label}` : '制作状況の申告なし'),
        el('div', { class: 'progress-card-reason' },
          el('span', { class: 'progress-card-key' }, '停止理由'),
          el('span', { class: `tone-${BLOCK_TONE[block.kind] ?? 'neutral'}` }, block.reason)),
        el('div', { class: 'progress-card-next' },
          el('span', { class: 'progress-card-key' }, '次の一手'),
          el('strong', null, block.next)));
    })),
  );
  if (blocked.length > shown.length) {
    box.appendChild(el('p', { class: 'field-hint' }, `ほか${blocked.length - shown.length}件あります。`));
  }
  return box;
}
