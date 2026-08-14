// §09 必須状態 — 初回・空 / 読み込み中 / 同期遅延 / 権限不足 / 投稿失敗 / 結果不明。
//
// どの状態でも「原因」と「次の操作」を必ず一緒に出す。
// 無効なボタンだけを見せて終わりにしない。

import { el, button } from '../core/dom.js';
import { displayState } from '../domain/state.js';
import { failureKind } from '../domain/state.js';
import { syncStatus } from '../domain/invariants.js';
import { can } from '../domain/rbac.js';
import { relativeLabel, stampLabel } from '../core/fmt.js';

/** 状態バッジ。色に加えて必ず日本語ラベルを出す (§32 色だけで伝えない)。 */
export function stateTag(id) {
  const s = displayState(id);
  return el('span', { class: `day-item-state tone-${s.tone}` }, s.label);
}

/** §09 読み込み中: 月グリッドの骨格を保ち、レイアウトを跳ねさせない。 */
export function calendarSkeleton() {
  return el(
    'div',
    { class: 'cal', 'aria-busy': 'true', 'aria-label': '読み込み中' },
    ...Array.from({ length: 6 }, () =>
      el('div', { class: 'cal-week' }, ...Array.from({ length: 7 }, () =>
        el('div', { class: 'skeleton-cell' }, el('div', { class: 'skeleton-line' })))),
    ),
  );
}

/** §09 同期遅延: 15分を超えたら最終同期時刻と一緒に伝える (G05)。閲覧・編集は止めない。 */
export function syncNotice(lastSyncedAtMs, nowMs) {
  const status = syncStatus(lastSyncedAtMs, nowMs);
  if (!status.stale) return null;
  return el(
    'div',
    { class: 'notice notice-attention' },
    el(
      'div',
      null,
      el('div', { class: 'notice-title' }, status.message),
      el(
        'div',
        { class: 'notice-body' },
        status.lastSyncedAtMs
          ? `最終同期：${stampLabel(status.lastSyncedAtMs, Intl.DateTimeFormat().resolvedOptions().timeZone)}（${relativeLabel(status.lastSyncedAtMs, nowMs)}）。表示は古い可能性がありますが、台帳と承認はそのまま使えます。`
          : 'まだ一度も同期していません。台帳と承認はそのまま使えます。',
      ),
    ),
  );
}

/** §09 権限不足: 理由と申請先を出す。無効ボタンだけにしない。 */
export function permissionNotice(role, operation) {
  const verdict = can(role, operation);
  if (verdict.allowed) return null;
  return el(
    'div',
    { class: 'notice' },
    el(
      'div',
      null,
      el('div', { class: 'notice-title' }, verdict.requestOnly ? 'この操作は申請が必要です' : 'この操作の権限がありません'),
      el('div', { class: 'notice-body' }, verdict.message),
    ),
  );
}

/** §09 投稿失敗 / 結果不明: 失敗分類と推奨操作を一件だけ出す。 */
export function failureNotice(post, actions = []) {
  if (!post.failure_kind) return null;
  const kind = failureKind(post.failure_kind);
  const isUnknown = post.failure_kind === 'UNKNOWN_OUTCOME';
  return el(
    'div',
    { class: isUnknown ? 'notice notice-danger' : 'notice notice-attention' },
    el(
      'div',
      null,
      el('div', { class: 'notice-title' }, kind.label),
      el('div', { class: 'notice-body' }, `${kind.cause}。${kind.recommend}。`),
    ),
    actions.length ? el('div', { class: 'notice-actions' }, ...actions) : null,
  );
}

/** §09 初回・空: 選べるのは「投稿を追加」と「この日は休止」の2つだけ。 */
export function emptyState({ title, description, actions = [] }) {
  return el(
    'div',
    { class: 'empty-state' },
    el('p', { style: { 'font-weight': '700', color: 'var(--ink)' } }, title),
    description ? el('p', null, description) : null,
    actions.length ? el('div', { class: 'empty-state-actions' }, ...actions) : null,
  );
}

/** 一覧が空のときの短い表示。 */
export function emptyList(message) {
  return el('div', { class: 'empty-state' }, el('p', null, message));
}

/**
 * 権限があるときだけ動くボタン。無い場合は理由を伝える。
 *
 * 判定は描画時ではなく**押した瞬間**に行う。役割を切り替えた直後の再描画が
 * 間に合わなくても、古い判定のまま実行されないようにするため。
 * (service層でも403で拒否されるが、画面が先に理由を出すほうが親切)
 */
export function guardedButton(app, operation, label, options = {}) {
  const b = button(label, {
    class: options.class ?? 'btn',
    onClick: async () => {
      const verdict = can(app.state.role, operation);
      if (!verdict.allowed) {
        app.toast(verdict.message, 'error');
        return;
      }
      try {
        await options.onClick?.();
      } catch (error) {
        app.fail(error);
      }
    },
  });
  const initial = can(app.state.role, operation);
  if (!initial.allowed) {
    b.title = initial.message;
    b.classList.add('btn-quiet');
  }
  return b;
}
