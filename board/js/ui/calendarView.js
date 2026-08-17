// §05–06 採用ホーム: 投稿カレンダー。この画面を製品の基準面とする。
//
// 守ること (§37 変更禁止の基準):
//   ・カレンダーを唯一のホームにする
//   ・月セルは日本語2行以内。凡例・SNS略称を置かない
//   ・右詳細の「次に確認すること」を最強の焦点にし、登録CTAを競合させない

import { el, button, onKeys, focus } from '../core/dom.js';
import { WEEK_COLUMNS_JA, monthTitle } from '../core/fmt.js';
import { shiftDateKey, daysInMonth } from '../core/tz.js';
import { buildMonthView, buildWeekView, rollingWeekStartKey } from '../domain/calendar.js';
import { toDayPlanView } from '../services/dayplans.js';
import { buildDayPanel, buildNextActionBar } from './dayPanel.js';
import { buildWeekGrid } from './weekView.js';
import { openCreateDrawer } from './editDrawer.js';
import { guardedButton } from './states.js';
import { tierForWidth } from './responsive.js';
import { platformBadges } from './platformBadge.js';
import { buildProgressPanel } from './progressPanel.js';
import { buildBusinessPipelinePanel } from './businessPipelinePanel.js?v=2';

export async function renderCalendarScreen(app) {
  return app.state.view === 'month' ? renderMonth(app) : renderWeek(app);
}

// ---------------------------------------------------------------------------
// 週表示（既定）— その週を管理する面。投稿を1件ずつ出す。
// ---------------------------------------------------------------------------

async function renderWeek(app) {
  const { repo } = app.ctx;
  const tz = app.timeZone;
  const selected = app.state.selectedDateKey;
  const dayCount = 3;
  const start = rollingWeekStartKey(selected, app.todayKey(), dayCount);
  const end = shiftDateKey(start, dayCount - 1);

  const [posts, pipelinePosts, dayPlanRows, accounts, postGroups, publicationPackages] = await Promise.all([
    repo.listPostsBetween(start, end),
    repo.listPipelinePosts(),
    repo.listDayPlans(),
    repo.listSocialAccounts(),
    repo.listPostGroups(),
    repo.listPublicationPackages(),
  ]);

  const view = buildWeekView({
    startDateKey: start,
    timeZone: tz,
    todayKey: app.todayKey(),
    items: posts.map(toCalendarItem),
    dayPlans: dayPlanRows.map(toDayPlanView),
    dayCount,
  });

  const upcoming = await repo.listUpcomingPosts(app.clock.nowMs(), 10);
  const pipelineWindowPosts = pipelinePosts.filter((post) => {
    if (post.internal?.tags?.includes('production-run')) return true;
    return post.calendar_date_key >= start && post.calendar_date_key <= end;
  });
  const screen = el('div', { class: 'screen' });

  screen.appendChild(
    buildToolbar(app, {
      titleId: 'week-title',
      title: view.title,
      prevLabel: '前の3日',
      nextLabel: '次の3日',
      onPrev: () => app.update({ selectedDateKey: shiftDateKey(selected, -dayCount) }),
      onNext: () => app.update({ selectedDateKey: shiftDateKey(selected, dayCount) }),
      todayLabel: '今日から',
      selected,
    }),
  );

  screen.appendChild(buildBusinessPipelinePanel({ posts: pipelineWindowPosts, postGroups, publicationPackages }));
  screen.appendChild(buildProgressPanel(app, { posts, todayKey: app.todayKey(), timeZone: tz }));

  // 「次に確認すること」は週表示では画面幅いっぱいの帯にする。
  // 右詳細を持たないぶん、ここが最強の焦点になる (§37)。
  const dayPosts = await repo.listPostsForDay(selected);
  const dayPlan = dayPlanRows.find((p) => p.date_key === selected) ?? null;
  screen.appendChild(
    buildNextActionBar(app, { dateKey: selected, posts: dayPosts, dayPlan, upcoming, accounts }),
  );

  screen.appendChild(el('div', { class: 'wk-wrap' }, buildWeekGrid(app, view, selected)));

  return screen;
}

// ---------------------------------------------------------------------------
// 月表示 — 月を直読するための要約面（設計書 図2）。
// ---------------------------------------------------------------------------

async function renderMonth(app) {
  const { repo } = app.ctx;
  const tz = app.timeZone;
  const { year, month } = app.state;

  // 選択日が表示中の月から外れていたら、その月の1日へ寄せる。
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  if (!app.state.selectedDateKey.startsWith(monthPrefix)) {
    app.state.selectedDateKey = `${monthPrefix}-01`;
  }
  const selected = app.state.selectedDateKey;

  const [posts, dayPlanRows, accounts, postGroups, publicationPackages] = await Promise.all([
    repo.listPostsForMonth(year, month),
    repo.listDayPlans(),
    repo.listSocialAccounts(),
    repo.listPostGroups(),
    repo.listPublicationPackages(),
  ]);

  const dayPlans = dayPlanRows.map(toDayPlanView);
  const view = buildMonthView({
    year,
    month,
    timeZone: tz,
    todayKey: app.todayKey(),
    items: posts.map(toCalendarItem),
    dayPlans,
  });

  const dayPosts = await repo.listPostsForDay(selected);
  const upcoming = await repo.listUpcomingPosts(app.clock.nowMs(), 10);
  const dayPlan = dayPlanRows.find((p) => p.date_key === selected) ?? null;

  const dayPanel = buildDayPanel(app, { dateKey: selected, posts: dayPosts, dayPlan, upcoming, accounts });

  const screen = el('div', { class: 'screen' });

  screen.appendChild(
    buildToolbar(app, {
      titleId: 'month-title',
      title: monthTitle(year, month),
      prevLabel: '前の月',
      nextLabel: '次の月',
      onPrev: () => step(app, -1),
      onNext: () => step(app, 1),
      todayLabel: '今日',
      selected,
    }),
  );

  screen.appendChild(buildBusinessPipelinePanel({ posts, postGroups, publicationPackages }));
  screen.appendChild(buildProgressPanel(app, { posts, todayKey: app.todayKey(), timeZone: tz }));
  const board = el('div', { class: 'board' });
  board.append(
    el('div', { class: 'cal-month' }, buildMonthGrid(app, view, selected)),
    el('div', { class: 'cal-strip' }, buildWeekStrip(app, view, selected)),
    el('div', { class: 'day-panel-inline' }, dayPanel),
  );
  screen.appendChild(board);

  // 1280px未満では右詳細をドロワーで開けるようにする (§09)
  if (tierForWidth(globalThis.innerWidth ?? 1440).id !== 'WIDE') {
    screen.appendChild(
      el('div', { class: 'day-actions', style: { 'margin-top': '16px' } },
        button('選択した日の詳細を開く', {
          class: 'btn',
          onClick: () => app.openDrawer({ title: '選択した日の詳細', body: buildDayPanel(app, { dateKey: selected, posts: dayPosts, dayPlan, upcoming, accounts }) }),
        })),
    );
  }

  return screen;
}

// ---------------------------------------------------------------------------
// 週・月で共通の部品
// ---------------------------------------------------------------------------

function toCalendarItem(p) {
  return {
    id: p.channel_post_id,
    brandId: p.brand_id,
    platform: p.platform,
    displayState: p.display_state,
    title: p.title,
    scheduledAtMs: Date.parse(p.scheduled_at),
    publishedAtMs: p.published_at ? Date.parse(p.published_at) : undefined,
  };
}

function buildToolbar(app, o) {
  return el(
    'div',
    { class: 'cal-toolbar' },
    el('h1', { class: 'screen-title' }, 'SNS投稿カレンダー'),
    el('div', { class: 'view-switch', role: 'group', 'aria-label': '表示の単位' },
      viewButton(app, 'week', '3日'),
      viewButton(app, 'month', '月')),
    el('div', { class: 'month-nav' },
      button('‹', { class: 'month-step', 'aria-label': o.prevLabel, onClick: o.onPrev }),
      el('div', { class: 'month-title', id: o.titleId }, o.title),
      button('›', { class: 'month-step', 'aria-label': o.nextLabel, onClick: o.onNext })),
    button(o.todayLabel, { class: 'btn btn-quiet', onClick: () => goToday(app) }),
    guardedButton(app, 'post.create', '＋ 投稿を登録', {
      class: 'btn btn-outline',
      onClick: () => openCreateDrawer(app, { dateKey: o.selected }),
    }),
  );
}

function viewButton(app, mode, label) {
  const active = app.state.view === mode;
  return button(label, {
    class: 'view-switch-btn',
    'aria-pressed': active ? 'true' : 'false',
    onClick: () => {
      if (app.state.view === mode) return;
      app.saveViewPref(mode);
      app.update({ view: mode });
    },
  });
}

function step(app, delta) {
  let { year, month } = app.state;
  month += delta;
  if (month < 1) { month = 12; year -= 1; }
  if (month > 12) { month = 1; year += 1; }
  const day = Math.min(Number(app.state.selectedDateKey.slice(8, 10)), daysInMonth(year, month));
  app.update({
    year,
    month,
    selectedDateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  });
}

function goToday(app) {
  const today = app.todayKey();
  app.update({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
    selectedDateKey: today,
  });
}

// --- 月グリッド ---------------------------------------------------------------

function buildMonthGrid(app, view, selected) {
  const grid = el('div', {
    class: 'cal',
    role: 'grid',
    'aria-labelledby': 'month-title',
  });

  const header = el('div', { class: 'cal-weekdays', role: 'row' });
  for (const [i, label] of WEEK_COLUMNS_JA.entries()) {
    header.appendChild(
      el('div', {
        class: `cal-weekday${i === 5 ? ' sat' : i === 6 ? ' sun' : ''}`,
        role: 'columnheader',
      }, label),
    );
  }
  grid.appendChild(header);

  for (const week of view.weeks) {
    const row = el('div', { class: 'cal-week', role: 'row' });
    for (const cell of week) row.appendChild(buildCell(app, cell, selected, view));
    grid.appendChild(row);
  }
  return grid;
}

/** 7日ストリップ (767px以下 §09)。選択日を中心に前後3日を出す。 */
function buildWeekStrip(app, view, selected) {
  const strip = el('div', { class: 'cal', role: 'grid', 'aria-labelledby': 'month-title' });
  const days = el('div', { class: 'cal-strip-days', role: 'row' });
  const byKey = new Map(view.cells.map((c) => [c.dateKey, c]));
  for (let offset = -3; offset <= 3; offset += 1) {
    const key = shiftDateKey(selected, offset);
    const cell = byKey.get(key) ?? { dateKey: key, day: Number(key.slice(8, 10)), inMonth: false, rows: [], platforms: [], platformStates: [], emptyLabel: null, isToday: key === app.todayKey(), ariaLabel: key };
    days.appendChild(buildCell(app, cell, selected, view, { compact: true }));
  }
  strip.appendChild(days);
  return strip;
}

/**
 * @param {object} options
 * @param {boolean} [options.compact]
 *   7日ストリップ用。1セル約49pxしかないので、日本語の本文は入れずに
 *   「日付・SNSバッジ・件数」だけにする。内容は上の右詳細が受け持つ (§09)。
 */
function buildCell(app, cell, selected, view, { compact = false } = {}) {
  const weekday = new Date(`${cell.dateKey}T00:00:00Z`).getUTCDay();
  const classes = ['cal-cell'];
  if (!cell.inMonth) classes.push('outside');
  if (cell.isToday) classes.push('today');
  if (weekday === 6) classes.push('sat');
  if (weekday === 0) classes.push('sun');

  const node = el('div', {
    class: classes.join(' '),
    role: 'gridcell',
    tabindex: cell.dateKey === selected ? '0' : '-1',
    'aria-selected': cell.dateKey === selected ? 'true' : 'false',
    'aria-label': cell.ariaLabel,
    dataset: { date: cell.dateKey },
  });

  // SNSバッジは日付と同じ行の右端へ。入りきらない日だけ折り返す（CSS側で wrap）。
  // SNS＝図形と色、進捗＝右下の印。文言ではなく図形なので、セルの日本語は§06のまま。
  // SNS名と進捗はセル全体の aria-label が持つので、バッジ自体は読み上げから外す。
  node.appendChild(
    el('div', { class: 'cal-daynum' },
      String(cell.day),
      cell.isToday ? el('span', { class: 'today-flag' }, '今日') : null,
      cell.platformStates?.length
        ? platformBadges(cell.platformStates, { decorative: true, size: compact ? 17 : 20 })
        : null),
  );

  if (cell.inMonth) {
    if (compact) {
      // 件数だけ。系統ごとの内訳は右詳細で見る。
      if (cell.totalCount > 0) {
        node.appendChild(el('div', { class: 'cal-compact-count' }, `${cell.totalCount}件`));
      } else if (cell.emptyLabel) {
        node.appendChild(
          el('div', { class: `cal-empty ${cell.emptyLabel === '休止' ? 'tone-PAUSED' : 'tone-EMPTY'}` }, cell.emptyLabel),
        );
      }
    } else if (cell.rows.length) {
      const rows = el('div', { class: 'cal-rows' });
      for (const row of cell.rows) {
        rows.appendChild(
          el('div', { class: 'cal-row' },
            el('span', { class: `cal-row-brand tone-${row.tone}` }, row.brandLabel),
            el('span', { class: 'cal-row-count' }, row.text)),
        );
      }
      node.appendChild(rows);
    } else if (cell.emptyLabel) {
      node.appendChild(
        el('div', { class: `cal-empty ${cell.emptyLabel === '休止' ? 'tone-PAUSED' : 'tone-EMPTY'}` }, cell.emptyLabel),
      );
    }

    const select = () => app.update({ selectedDateKey: cell.dateKey });
    node.addEventListener('click', select);
    onKeys(node, {
      Enter: select,
      ' ': select,
      ArrowLeft: () => move(app, cell.dateKey, -1, view),
      ArrowRight: () => move(app, cell.dateKey, 1, view),
      ArrowUp: () => move(app, cell.dateKey, -7, view),
      ArrowDown: () => move(app, cell.dateKey, 7, view),
      Home: () => move(app, cell.dateKey, -((new Date(`${cell.dateKey}T00:00:00Z`).getUTCDay() + 6) % 7), view),
      End: () => move(app, cell.dateKey, 6 - ((new Date(`${cell.dateKey}T00:00:00Z`).getUTCDay() + 6) % 7), view),
      PageUp: () => step(app, -1),
      PageDown: () => step(app, 1),
    });
  }

  return node;
}

/** 矢印キーでの移動。月をまたぐときは月表示ごと切り替える。 */
function move(app, fromKey, delta, view) {
  const next = shiftDateKey(fromKey, delta);
  const year = Number(next.slice(0, 4));
  const month = Number(next.slice(5, 7));
  if (year !== view.year || month !== view.month) {
    app.update({ year, month, selectedDateKey: next });
    return;
  }
  app.update({ selectedDateKey: next });
  // 再描画後に同じ日へフォーカスを戻す (ローミングtabindex)
  requestAnimationFrame(() => focus(document.querySelector(`.cal-cell[data-date="${next}"]`)));
}
