// 進捗パネル — 「今日できたこと」と「いま止まっているもの」。
//
// 実際の報告は必ずこの2つで書かれる。カレンダーは日付で並ぶので、
// 「何が終わって、何が止まっていて、次に何をするか」は別に立てないと読み取れない。
//
// 止まっている理由は domain/production.js が出す。ここは並べるだけ。

import { el } from '../core/dom.js';
import { clockLabel } from '../core/fmt.js';
import { platformName } from '../domain/platforms.js';
import { displayLabel } from '../domain/state.js';
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
    el('h2', { class: 'card-title' }, '進み具合'),
    buildDoneBlock(done, timeZone),
    buildBlockedBlock(app, blocked, timeZone),
  );
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
  const table = el('table', null,
    el('thead', null,
      el('tr', null,
        el('th', null, '公開予定'),
        el('th', null, '媒体'),
        el('th', null, '投稿'),
        el('th', null, '止まっている理由'),
        el('th', null, '次の一手'))),
    el('tbody', null,
      ...shown.map(({ post, production, block }) => {
        const progress = productionProgress(production);
        return el('tr', null,
          el('td', null, clockLabel(post.scheduledAtMs, timeZone)),
          el('td', null,
            el('span', { class: 'progress-media' },
              platformBadge(post.platform, { size: 18, decorative: true }),
              platformName(post.platform))),
          el('td', null,
            el('button', {
              type: 'button', class: 'btn btn-sm btn-quiet',
              onClick: () => openPostDetail(app, post.id),
            }, post.title || '（無題）'),
            el('div', { class: 'field-hint' },
              displayLabel(post.displayState),
              production ? `・制作 ${progress.label}` : '・制作の申告なし')),
          el('td', null, el('span', { class: `tone-${BLOCK_TONE[block.kind] ?? 'neutral'}` }, block.reason)),
          el('td', null, block.next));
      })));

  box.appendChild(el('div', { class: 'table-wrap', style: { 'margin-top': '6px' } }, table));
  if (blocked.length > shown.length) {
    box.appendChild(el('p', { class: 'field-hint' }, `ほか${blocked.length - shown.length}件あります。`));
  }
  return box;
}
