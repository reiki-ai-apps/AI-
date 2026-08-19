// アプリシェル。§04「常設画面は4つ、作業面は2つ。入口を増やさない」を守る。
//
// 常設画面 : 状況 / 承認待ち / 投稿履歴 / 接続設定
// 作業面   : 登録・編集ドロワー / 投稿詳細（どちらもドロワーとして開く）

import { el, clear, replace, button, append, focus } from '../core/dom.js';
import { ApiRepo } from '../store/apiRepo.js';
import { openGithubDatabase } from '../store/githubdb.js';
import { openPublicDatabase } from '../store/publicdb.js';
import { Repo } from '../store/repo.js';
import { loadConnection, isStaticHost, loadLocalPref, saveLocalPref } from '../store/backend.js';
import { buildGithubSetupForm } from './connectionSetup.js';
import { systemClock } from '../core/clock.js';
import { dateKey, systemTimeZone } from '../core/tz.js';
import { ROLES, ROLE_ORDER, roleLabel } from '../domain/rbac.js';
import { seedSocialAccounts } from '../services/api.js';
import { renderApprovalsScreen } from './approvalsView.js?v=4';
import { renderHistoryScreen } from './historyView.js';
import { renderConnectionsScreen } from './connectionsView.js';
import { renderStatusScreen } from './statusView.js?v=14';
import { hasIntentLink, consumeIntentLink } from './intentLink.js';

const SCREENS = [
  { id: 'status', label: '状況', render: renderStatusScreen },
  { id: 'approvals', label: '承認', render: renderApprovalsScreen },
  { id: 'history', label: '履歴', render: renderHistoryScreen },
  { id: 'connections', label: '接続', render: renderConnectionsScreen },
];

const USER_ID = 'reiki';

const main = document.getElementById('main');
const navHost = document.getElementById('nav');
const overlayRoot = document.getElementById('overlay-root');
const toastRoot = document.getElementById('toast-root');
const roleSelect = document.getElementById('role-select');

const timeZone = systemTimeZone();
const clock = systemClock(timeZone);

const state = {
  route: 'status',
  /** 投稿確認は常に今日から3日間だけを扱う。 */
  view: 'week',
  role: 'ADMIN',
  selectedDateKey: dateKey(clock.nowMs(), timeZone),
  year: Number(dateKey(clock.nowMs(), timeZone).slice(0, 4)),
  month: Number(dateKey(clock.nowMs(), timeZone).slice(5, 7)),
  pendingCount: 0,
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
    // GitHubモードでは、他の端末やスキルの書き込みを拾ってから描く。
    if (app.ctx?.backend === 'github' || app.ctx?.backend === 'public') {
      await app.ctx.db.refreshIfStale(4_000).catch(() => {});
    }
    await render();
  },

  /** 表示単位などの軽い好みの保存先（GitHubモードはコミットを増やさない）。 */
  saveViewPref(mode) {
    if (app.ctx?.backend === 'github' || app.ctx?.backend === 'public') saveLocalPref('calendar_view', mode);
    else app.ctx.repo.setSetting('calendar_view', mode).catch(() => {});
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
      // close() は onClose を呼ぶので、決着は1回だけにする
      // (先に resolve(null) されて入力値が捨てられるのを防ぐ)。
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

// --- 起動 -------------------------------------------------------------------

async function boot() {
  renderSkeleton();
  const connection = loadConnection();
  try {
    if (connection) {
      // GitHubモード：保存先は非公開リポジトリの board.json。services はこの場で動く。
      const db = await openGithubDatabase(connection);
      app.ctx = { repo: new Repo(db, clock), clock, db, mode: 'SOLO', backend: 'github', actor: { userId: USER_ID, role: state.role } };
    } else if (isStaticHost()) {
      // 公開Pagesは合鍵不要の閲覧専用。更新はPC/Codex側のGit操作だけで行う。
      const db = await openPublicDatabase();
      state.role = 'VIEWER';
      app.ctx = { repo: new Repo(db, clock), clock, db, mode: 'SOLO', backend: 'public', actor: { userId: USER_ID, role: state.role } };
    } else {
      // ローカルサーバー（npm start）モード
      app.ctx = {
        repo: new ApiRepo(() => app.ctx.actor),
        clock,
        mode: 'SOLO',
        backend: 'server',
        actor: { userId: USER_ID, role: state.role },
      };
    }
    if (app.ctx.backend !== 'public' && (await app.ctx.repo.listSocialAccounts()).length === 0) {
      await seedSocialAccounts(app.ctx);
    }
    // 月表示の古い設定が端末に残っていても、投稿確認は常に3日表示で始める。
    state.view = 'week';
  } catch (error) {
    if (connection) {
      renderGithubSetup(error);
      return;
    }
    replace(
      main,
      el(
        'div',
        { class: 'screen' },
        el('div', { class: 'notice notice-danger' },
          el('div', null,
            el('div', { class: 'notice-title' },
              error?.code === 'SERVER_UNAVAILABLE' ? '司令盤のサーバーが動いていません' : 'データを読み込めませんでした'),
            el('div', { class: 'notice-body' }, error?.message ?? '不明なエラーです。'),
            error?.code === 'SERVER_UNAVAILABLE'
              ? el('div', { class: 'notice-body' }, 'reiki-post-board フォルダで npm start を実行してから、この画面を開き直してください。')
              : null)),
      ),
    );
    return;
  }

  buildNav();
  buildRoleSelect();

  const hash = location.hash.replace('#', '');
    if (visibleScreens().some((s) => s.id === hash)) state.route = hash;
  window.addEventListener('hashchange', async () => {
    // §26 スキルがURLで送ってきた意図。開いたままのタブへ届く場合もここを通る。
    if (app.ctx.backend !== 'public' && hasIntentLink()) {
      state.route = 'connections';
      await consumeIntentLink(app);
      await render();
      return;
    }
    const next = location.hash.replace('#', '');
    if (visibleScreens().some((s) => s.id === next) && next !== state.route) {
      state.route = next;
      render();
    }
  });

  if (app.ctx.backend !== 'public' && hasIntentLink()) {
    state.route = 'connections';
    await consumeIntentLink(app);
  }

  await render();
}

/** GitHub接続の初期設定画面（Pagesで開いた初回、または接続に失敗したとき）。 */
function renderGithubSetup(error = null) {
  replace(
    main,
    el('div', { class: 'screen' },
      el('div', { class: 'screen-head' },
        el('h1', { class: 'screen-title' }, 'はじめての設定'),
        el('p', { class: 'screen-desc' }, 'この司令盤のデータを保存する場所（自分のGitHub）を教えてください。1回だけの設定です。')),
      error
        ? el('div', { class: 'notice notice-danger' },
            el('div', null,
              el('div', { class: 'notice-title' }, '接続できませんでした'),
              el('div', { class: 'notice-body' }, error.message ?? '不明なエラーです。')))
        : null,
      el('div', { class: 'card' }, buildGithubSetupForm())),
  );
}

function renderSkeleton() {
  replace(
    main,
    el(
      'div',
      { class: 'screen' },
      el('div', { class: 'cal' }, el('div', { class: 'cal-week' }, ...Array.from({ length: 7 }, () =>
        el('div', { class: 'skeleton-cell' }, el('div', { class: 'skeleton-line' }))))),
    ),
  );
}

function buildNav() {
  clear(navHost);
  for (const screen of visibleScreens()) {
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
  roleSelect.parentElement.hidden = app.ctx.backend === 'public';
  const roles = app.ctx.backend === 'public' ? ['VIEWER'] : ROLE_ORDER;
  for (const id of roles) {
    roleSelect.appendChild(el('option', { value: id }, `役割：${roleLabel(id)}`));
  }
  roleSelect.value = state.role;
  roleSelect.disabled = app.ctx.backend === 'public';
  roleSelect.addEventListener('change', () => {
    state.role = roleSelect.value;
    app.ctx.actor = { userId: USER_ID, role: state.role };
    app.toast(`${ROLES[state.role].label}として操作します（権限：${ROLES[state.role].scope}）`);
    render();
  });
}

function visibleScreens() {
  return app.ctx?.backend === 'public'
    ? SCREENS.filter((screen) => screen.id !== 'connections')
    : SCREENS;
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
  const screens = visibleScreens();
  const screen = screens.find((s) => s.id === state.route) ?? screens[0];
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

/** PWA。アプリシェルを変えたら sw.js の CACHE_NAME を必ず上げること。 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').catch((error) => {
    console.warn('Service Worker を登録できませんでした:', error);
  });
}

export { app };
void append;
boot();
registerServiceWorker();
