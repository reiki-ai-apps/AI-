// アプリシェル（デモ版）。§04「常設画面は少なく、作業面はドロワー」を守る。
//
// 常設画面 : 予定（3日／月） / 承認 / 履歴
// 作業面   : 登録・編集ドロワー / 投稿詳細（どちらもドロワーとして開く）
//
// デモ版の違い: 保存先はこのブラウザの localStorage だけ。サーバー・GitHub・
// 承認用の外部窓口へは一切つながない。見本データは架空の「見本チャンネル」。

import { el, clear, replace, button, focus } from '../core/dom.js';
import { Repo } from '../store/repo.js';
import { DemoDatabase } from '../store/demodb.js';
import { buildDemoData } from '../store/seed.js';
import { loadLocalPref, saveLocalPref } from '../store/backend.js';
import { systemClock } from '../core/clock.js';
import { dateKey, systemTimeZone } from '../core/tz.js';
import { ROLES, ROLE_ORDER, roleLabel } from '../domain/rbac.js';
import { seedSocialAccounts } from '../services/api.js';
import { renderApprovalsScreen } from './approvalsView.js';
import { renderCalendarScreen } from './calendarView.js';
import { renderHistoryScreen } from './historyView.js';

const SCREENS = [
  { id: 'calendar', label: '予定', render: renderCalendarScreen },
  { id: 'approvals', label: '承認', render: renderApprovalsScreen },
  { id: 'history', label: '履歴', render: renderHistoryScreen },
];

const USER_ID = 'demo-owner';
const SEED_DAY_KEY = 'demo-post-board-seed-day';

const main = document.getElementById('main');
const navHost = document.getElementById('nav');
const overlayRoot = document.getElementById('overlay-root');
const toastRoot = document.getElementById('toast-root');
const roleSelect = document.getElementById('role-select');

const timeZone = systemTimeZone();
const clock = systemClock(timeZone);

const state = {
  route: 'calendar',
  /** 'week' = 今日から3日 / 'month' = 月表示（?view=month でも開ける） */
  view: (new URLSearchParams(location.search).get('view') ?? loadLocalPref('calendar_view', 'week')) === 'month' ? 'month' : 'week',
  role: 'ADMIN',
  selectedDateKey: dateKey(clock.nowMs(), timeZone),
  year: Number(dateKey(clock.nowMs(), timeZone).slice(0, 4)),
  month: Number(dateKey(clock.nowMs(), timeZone).slice(5, 7)),
  pendingCount: 0,
  approvalSyncKeys: new Set(),
};

let overlayStack = [];

const app = {
  state,
  clock,
  timeZone,
  ctx: null,

  todayKey: () => dateKey(clock.nowMs(), timeZone),

  go(route, patch = {}) {
    Object.assign(state, patch, { route });
    location.hash = route;
    render();
  },

  update(patch = {}) {
    Object.assign(state, patch);
    render();
  },

  async refresh() {
    await render();
  },

  /** 3日／月の切り替えは、この端末の好みとして残す。 */
  saveViewPref(mode) {
    saveLocalPref('calendar_view', mode);
  },

  toast(message, kind = 'info') {
    const node = el('div', { class: kind === 'error' ? 'toast toast-error' : 'toast' }, message);
    toastRoot.appendChild(node);
    setTimeout(() => node.remove(), kind === 'error' ? 7000 : 4000);
  },

  /** エラーを人が読める日本語で伝える。原因が分からない例外も握りつぶさない。 */
  fail(error) {
    console.error(error);
    app.toast(error?.message ?? '操作に失敗しました。', 'error');
  },

  /**
   * ドロワーを開く。§04 の作業面はすべてこれ。
   * Escapeで閉じ、背景へフォーカスが漏れないようにする (§32 キーボード操作)。
   */
  openDrawer({ title, body, footer, onClose }) {
    const previouslyFocused = document.activeElement;
    const titleId = `drawer-title-${overlayStack.length}`;

    const closeBtn = button('閉じる', { class: 'btn btn-quiet btn-sm', onClick: () => close() });
    const drawer = el(
      'div',
      { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      el('div', { class: 'drawer-head' }, el('h2', { class: 'drawer-title', id: titleId }, title), closeBtn),
      el('div', { class: 'drawer-body' }, body),
      footer ? el('div', { class: 'drawer-foot' }, footer) : null,
    );
    const scrim = el('div', { class: 'scrim', onClick: () => close() });

    const onKeydown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = drawer.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    drawer.addEventListener('keydown', onKeydown);

    overlayRoot.append(scrim, drawer);
    const entry = { scrim, drawer };
    overlayStack.push(entry);

    const target = drawer.querySelector('input, textarea, select, button:not(.btn-quiet)') ?? closeBtn;
    focus(target);

    function close() {
      scrim.remove();
      drawer.remove();
      overlayStack = overlayStack.filter((o) => o !== entry);
      focus(previouslyFocused);
      onClose?.();
    }
    return close;
  },

  /** 破壊的な操作の前に理由を必ず聞く (§16 取消・削除)。 */
  askReason({ title, message, confirmLabel, tone = 'primary', placeholder = '理由' }) {
    return new Promise((resolve) => {
      const input = el('textarea', { rows: 3, placeholder, required: true });
      const error = el('p', { class: 'form-error' });
      let close;
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const submit = () => {
        const value = input.value.trim();
        if (!value) {
          error.textContent = '理由を入力してください。記録に残ります。';
          focus(input);
          return;
        }
        finish(value);
        close();
      };
      close = app.openDrawer({
        title,
        body: [
          message ? el('p', null, message) : null,
          el('div', { class: 'field' }, el('label', { class: 'field-label' }, '理由'), input),
          error,
        ],
        footer: [
          button('やめる', { class: 'btn btn-quiet', onClick: () => close() }),
          button(confirmLabel, { class: tone === 'danger' ? 'btn btn-danger' : 'btn btn-primary', onClick: submit }),
        ],
        onClose: () => finish(null),
      });
    });
  },
};

// --- 見本データ -------------------------------------------------------------

/** 見本データを作り直す（保存は最後に1回）。 */
async function seedDemo(ctx) {
  ctx.db.persist = false;
  try {
    await seedSocialAccounts(ctx);
    await buildDemoData(ctx);
  } finally {
    ctx.db.persist = true;
    ctx.db.save();
  }
  try { localStorage.setItem(SEED_DAY_KEY, app.todayKey()); } catch {}
}

async function resetDemo() {
  if (!confirm('見本データに戻します。この端末で追加・変更した内容は消えます。よろしいですか？')) return;
  for (const o of [...overlayStack]) { o.scrim.remove(); o.drawer.remove(); }
  overlayStack = [];
  renderSkeleton('見本データを用意しています…');
  await app.ctx.db.clearAll();
  await seedDemo(app.ctx);
  const today = app.todayKey();
  Object.assign(state, {
    selectedDateKey: today,
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
  });
  await render();
  app.toast('見本データに戻しました。');
}

// --- 起動 -------------------------------------------------------------------

async function boot() {
  renderSkeleton('見本データを用意しています…');
  const db = new DemoDatabase();
  const restored = db.restore();
  app.ctx = { repo: new Repo(db, clock), clock, db, mode: 'SOLO', backend: 'demo', actor: { userId: USER_ID, role: state.role } };

  let seedDay = null;
  try { seedDay = localStorage.getItem(SEED_DAY_KEY); } catch {}
  try {
    if (!restored || seedDay !== app.todayKey()) {
      // 見本は「今日」を基準に作るので、日付が変わっていたら作り直す。
      if (restored) await db.clearAll();
      await seedDemo(app.ctx);
    }
  } catch (error) {
    replace(main, el('div', { class: 'screen' },
      el('div', { class: 'notice notice-danger' },
        el('div', null,
          el('div', { class: 'notice-title' }, '見本データを用意できませんでした'),
          el('div', { class: 'notice-body' }, error?.message ?? '不明なエラーです。')))));
    return;
  }

  buildNav();
  buildRoleSelect();
  document.getElementById('demo-reset')?.addEventListener('click', () => resetDemo().catch(app.fail));

  const hash = location.hash.replace('#', '');
  if (SCREENS.some((s) => s.id === hash)) state.route = hash;
  window.addEventListener('hashchange', () => {
    const next = location.hash.replace('#', '');
    if (SCREENS.some((s) => s.id === next) && next !== state.route) {
      state.route = next;
      render();
    }
  });

  await render();
}

function renderSkeleton(message = '') {
  replace(
    main,
    el(
      'div',
      { class: 'screen' },
      message ? el('p', { class: 'screen-desc', role: 'status' }, message) : null,
      el('div', { class: 'cal' }, el('div', { class: 'cal-week' }, ...Array.from({ length: 7 }, () =>
        el('div', { class: 'skeleton-cell' }, el('div', { class: 'skeleton-line' }))))),
    ),
  );
}

function buildNav() {
  clear(navHost);
  for (const screen of SCREENS) {
    const badge = el('span', { class: 'nav-badge', hidden: true });
    const item = button(screen.label, {
      class: 'nav-item',
      dataset: { screen: screen.id },
      onClick: () => app.go(screen.id),
    });
    if (screen.id === 'approvals') {
      item.appendChild(badge);
      item.dataset.badge = 'pending';
    }
    navHost.appendChild(item);
  }
}

function buildRoleSelect() {
  clear(roleSelect);
  for (const id of ROLE_ORDER) {
    roleSelect.appendChild(el('option', { value: id }, `役割：${roleLabel(id)}`));
  }
  roleSelect.value = state.role;
  roleSelect.addEventListener('change', () => {
    state.role = roleSelect.value;
    app.ctx.actor = { userId: USER_ID, role: state.role };
    app.toast(`${ROLES[state.role].label}として操作します（権限：${ROLES[state.role].scope}）`);
    render();
  });
}

function syncNav() {
  for (const item of navHost.querySelectorAll('.nav-item')) {
    const isCurrent = item.dataset.screen === state.route;
    if (isCurrent) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
    if (item.dataset.badge === 'pending') {
      const badge = item.querySelector('.nav-badge');
      badge.textContent = String(state.pendingCount);
      badge.hidden = state.pendingCount === 0;
    }
  }
}

let renderToken = 0;

async function render() {
  const token = ++renderToken;
  const screen = SCREENS.find((s) => s.id === state.route) ?? SCREENS[0];
  state.route = screen.id;

  try {
    state.pendingCount = (await app.ctx.repo.listPendingApprovals()).length;
  } catch {
    state.pendingCount = 0;
  }
  if (token !== renderToken) return;
  syncNav();

  try {
    const node = await screen.render(app);
    if (token !== renderToken) return;
    replace(main, node);
  } catch (error) {
    if (token !== renderToken) return;
    console.error(error);
    replace(
      main,
      el('div', { class: 'screen' },
        el('div', { class: 'notice notice-danger' },
          el('div', null,
            el('div', { class: 'notice-title' }, '画面を表示できませんでした'),
            el('div', { class: 'notice-body' }, error?.message ?? '不明なエラーです。')))),
    );
  }
}

// デモ版: Service Worker は登録しない（静的ホスティングのサブパスで常に最新ファイルを読む）

export { app };
boot();
