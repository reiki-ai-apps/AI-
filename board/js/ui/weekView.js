// 週表示 — 1週間を7列で並べ、投稿を1件ずつ時刻順に出す。
//
// 月表示は「月を直読する」ための要約（状態＋件数）だが、週表示は
// 「その週を管理する」ための面なので、時刻・SNS・タイトル・状態をそのまま見せる。
// 1日あたりの面積が月表示の6倍以上あるので、省略しなくても収まる。

import { el, button, onKeys, focus } from '../core/dom.js';
import { clockLabel } from '../core/fmt.js';
import { shiftDateKey } from '../core/tz.js';
import { displayState } from '../domain/state.js';
import { platformBadge } from './platformBadge.js';
import { guardedButton } from './states.js';
import { openPostDetail } from './postDetail.js';
import { openCreateDrawer } from './editDrawer.js';
import { pauseDay, releaseDay } from '../services/api.js';

/**
 * 週グリッドを組み立てる。
 * @param {object} app
 * @param {object} view buildWeekView の戻り値
 * @param {string} selected 選択日
 */
export function buildWeekGrid(app, view, selected) {
  const grid = el('div', {
    class: 'wk',
    role: 'grid',
    'aria-labelledby': 'week-title',
  });

  const row = el('div', { class: 'wk-row', role: 'row' });
  for (const day of view.days) row.appendChild(buildColumn(app, day, selected, view));
  grid.appendChild(row);
  return grid;
}

function buildColumn(app, day, selected, view) {
  const tz = app.timeZone;
  const classes = ['wk-col'];
  if (day.isToday) classes.push('today');
  if (day.weekday === 6) classes.push('sat');
  if (day.weekday === 0) classes.push('sun');
  if (day.dateKey === selected) classes.push('selected');

  const col = el('div', {
    class: classes.join(' '),
    role: 'gridcell',
    tabindex: day.dateKey === selected ? '0' : '-1',
    'aria-selected': day.dateKey === selected ? 'true' : 'false',
    'aria-label': day.ariaLabel,
    dataset: { date: day.dateKey },
  });

  // 見出し: 曜日 → 日付 →（今日）
  col.appendChild(
    el('div', { class: 'wk-head' },
      el('span', { class: 'wk-weekday' }, day.weekdayLabel),
      el('span', { class: 'wk-day' }, String(day.day)),
      day.isToday ? el('span', { class: 'today-flag' }, '今日') : null,
      day.totalCount > 0 ? el('span', { class: 'wk-count' }, `${day.totalCount}件`) : null),
  );

  const body = el('div', { class: 'wk-body' });

  if (day.entries.length) {
    for (const entry of day.entries) {
      body.appendChild(buildEntry(app, entry, tz));
    }
  } else if (day.emptyLabel) {
    body.appendChild(
      el('div', { class: `wk-empty ${day.paused ? 'tone-PAUSED' : 'tone-EMPTY'}` },
        el('div', { class: 'wk-empty-label' }, day.emptyLabel),
        day.paused?.reason ? el('div', { class: 'wk-empty-why' }, day.paused.reason) : null),
    );
  }
  col.appendChild(body);

  // 列ごとの操作。空の日は §09 のとおり2択だけ。
  const foot = el('div', { class: 'wk-foot' });
  if (day.entries.length === 0 && !day.paused) {
    foot.append(
      guardedButton(app, 'post.create', '＋ 追加', {
        class: 'btn btn-sm btn-quiet',
        onClick: () => openCreateDrawer(app, { dateKey: day.dateKey }),
      }),
      guardedButton(app, 'post.edit', '休止', {
        class: 'btn btn-sm btn-quiet',
        onClick: async () => {
          const reason = await app.askReason({
            title: 'この日は休止',
            message: '理由・設定者・日時を記録します。「予定なし」とは別のものとして扱います。',
            confirmLabel: '休止として記録',
          });
          if (!reason) return;
          await pauseDay(app.ctx, day.dateKey, { reason });
          app.toast('休止として記録しました。');
          await app.refresh();
        },
      }),
    );
  } else if (day.paused) {
    foot.appendChild(
      guardedButton(app, 'post.edit', '休止を解除', {
        class: 'btn btn-sm btn-quiet',
        onClick: async () => {
          await releaseDay(app.ctx, day.dateKey);
          app.toast('休止を解除しました。');
          await app.refresh();
        },
      }),
    );
  } else {
    foot.appendChild(
      guardedButton(app, 'post.create', '＋ 追加', {
        class: 'btn btn-sm btn-quiet',
        onClick: () => openCreateDrawer(app, { dateKey: day.dateKey }),
      }),
    );
  }
  col.appendChild(foot);

  const select = () => app.update({ selectedDateKey: day.dateKey });
  col.addEventListener('click', (event) => {
    // 中のボタンを押したときは選択に反応しない
    if (event.target.closest('button')) return;
    select();
  });
  onKeys(col, {
    Enter: select,
    ' ': select,
    ArrowLeft: () => move(app, day.dateKey, -1, view),
    ArrowRight: () => move(app, day.dateKey, 1, view),
    Home: () => move(app, day.dateKey, -day.weekdayIndexFromMonday ?? 0, view),
    PageUp: () => app.update({ selectedDateKey: shiftDateKey(day.dateKey, -7) }),
    PageDown: () => app.update({ selectedDateKey: shiftDateKey(day.dateKey, 7) }),
  });

  return col;
}

/** 投稿1件のカード。時刻・SNSバッジ（進捗つき）・タイトル・状態を全部出す。 */
function buildEntry(app, entry, tz) {
  const s = displayState(entry.displayState);
  const card = button('', {
    class: `wk-item tone-edge-${s.tone}`,
    onClick: () => openPostDetail(app, entry.id),
    'aria-label': `${clockLabel(entry.atMs, tz)} ${entry.title} ${entry.platformName} ${entry.brandName} ${entry.stateLabel}`,
  });

  card.append(
    el('div', { class: 'wk-item-top' },
      el('span', { class: 'wk-item-time' }, clockLabel(entry.atMs, tz)),
      entry.platform
        ? platformBadge(entry.platform, {
            decorative: true,
            size: 18,
            state: { displayState: entry.displayState, stateLabel: entry.stateLabel, terms: [] },
          })
        : null),
    el('div', { class: 'wk-item-title' }, entry.title || '（無題）'),
    el('div', { class: 'wk-item-meta' },
      el('span', { class: `wk-item-state tone-${s.tone}` }, entry.stateLabel),
      el('span', { class: `wk-item-brand tone-${entry.brandTone}` }, entry.brandLabel)),
  );
  return card;
}

function move(app, fromKey, delta, view) {
  const next = shiftDateKey(fromKey, delta);
  app.update({ selectedDateKey: next });
  requestAnimationFrame(() => focus(document.querySelector(`.wk-col[data-date="${next}"]`)));
  void view;
}
