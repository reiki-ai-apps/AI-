// §18 通知 / §31 監査・保持
//
// 通知は「原因＋次の一手」を持つものだけを作る。
// dedupe_key の一意インデックスが、同一事象の重複通知を構造的に防ぐ (§18 通知の契約)。
// 監査は追記専用。ここには更新・削除のAPIを置かない。

import { uuid } from '../core/ids.js';
import { evaluatePost, evaluateEmptyDay, dedupe, sortNotifications, isWellFormed } from '../domain/notify.js';
import { toPostView } from '../store/repo.js';
import { ConstraintError } from '../store/memdb.js';

/**
 * いまの状態から通知を作り直す。
 * すでに同じ事象で作られている通知は作らない。
 */
export async function refreshNotifications(ctx, { dateKeys = [] } = {}) {
  const nowMs = ctx.clock.nowMs();
  const posts = await ctx.repo.read(['channelPosts'], (tx) => tx.getAll('channelPosts'));
  const live = posts.filter((p) => !p.deleted_at && !p.cancelled_at);

  const candidates = [];
  for (const post of live) {
    candidates.push(...evaluatePost(toPostView(post, nowMs), nowMs));
  }

  // 「予定なし」は日に対する通知。呼び出し側が対象日を指定したときだけ評価する。
  const plans = await ctx.repo.listDayPlans();
  const pausedKeys = new Set(plans.filter((p) => p.paused).map((p) => p.date_key));
  const occupied = new Set(live.map((p) => p.calendar_date_key));
  for (const key of dateKeys) {
    if (occupied.has(key) || pausedKeys.has(key)) continue;
    candidates.push(evaluateEmptyDay(key));
  }

  const existing = await ctx.repo.listNotifications();
  const known = new Set(existing.map((n) => n.dedupe_key));
  const fresh = dedupe(candidates.filter(isWellFormed), known);

  if (!fresh.length) return { created: 0 };

  const now = ctx.clock.nowIso();
  let created = 0;
  await ctx.repo.write(['notifications'], async (tx) => {
    for (const n of fresh) {
      try {
        await tx.add('notifications', {
          notification_id: uuid(),
          dedupe_key: n.dedupeKey,
          condition: n.condition,
          severity: n.severity,
          subject: n.subject,
          cause: n.cause,
          next_step: n.nextStep,
          action: n.action,
          post_id: n.postId ?? null,
          date_key: n.dateKey ?? null,
          created_at: now,
          read_at: null,
          acknowledged_by: null,
        });
        created += 1;
      } catch (error) {
        // 一意制約に当たったなら、すでに同じ事象の通知がある。それが正しい挙動。
        if (!(error instanceof ConstraintError)) throw error;
      }
    }
  });

  return { created };
}

/** 通知の一覧 (重要度順)。 */
export async function listNotifications(ctx, { unreadOnly = false } = {}) {
  const rows = await ctx.repo.listNotifications();
  const filtered = unreadOnly ? rows.filter((n) => !n.read_at) : rows;
  return sortNotifications(
    filtered.map((n) => ({
      ...n,
      cause: n.cause,
      nextStep: n.next_step,
      dedupeKey: n.dedupe_key,
    })),
  );
}

/** §18「確認済みを通知内から実行できる」 */
export async function acknowledgeNotification(ctx, notificationId) {
  const rows = await ctx.repo.listNotifications();
  const target = rows.find((n) => n.notification_id === notificationId);
  if (!target) return { acknowledged: false };
  await ctx.repo.write(['notifications'], (tx) =>
    tx.put('notifications', {
      ...target,
      read_at: ctx.clock.nowIso(),
      acknowledged_by: ctx.actor.userId,
    }),
  );
  return { acknowledged: true };
}

/**
 * 監査の読み出し。追記専用なので書き換えの入口は用意しない (§31 保持)。
 */
export async function listAuditFor(ctx, targetId, { limit = 100 } = {}) {
  return ctx.repo.listAudit({ targetId, limit });
}

export async function listRecentAudit(ctx, { limit = 200 } = {}) {
  return ctx.repo.listAudit({ limit });
}

/**
 * 監査記録の日本語表示。誰が・いつ・何を・なぜ を1行にする。
 */
export const AUDIT_ACTION_LABELS = Object.freeze({
  'post.create': '投稿を登録',
  'post.edit': '内容を編集',
  'post.edit.invalidated_approval': '内容を編集（承認を無効化）',
  'post.edit.internal': '内部情報を編集',
  'post.delete': '投稿を削除',
  'post.restore': '投稿を復元',
  'approval.submit': '確認を依頼',
  'approval.approve': '公開を承認',
  'approval.approve.self': '公開を承認（単独運用・本人承認）',
  'approval.reject': '差し戻し',
  'schedule.cancel': '予約を取消',
  'execution.manual.claim': '手動投稿を開始',
  'execution.manual.confirm': '手動投稿を確認',
  'execution.manual.release': '手動投稿を取りやめ',
  'execution.outcome_unknown': '結果不明として記録',
  'emergency.stop': '緊急停止',
  'emergency.release': '緊急停止を解除',
  'package.accepted': 'Packageを受理',
  'dayplan.pause': '休止を設定',
  'dayplan.release': '休止を解除',
  // §26/§28A Action Gateway
  'action.key.register': '発行者の公開鍵を登録',
  'action.key.revoke': '発行者の公開鍵を失効',
  'action.intent.consume': '署名された意図を受理',
  'action.intent.complete': '意図の操作を実行',
  'action.intent.fail': '意図の操作が失敗',
  'action.intent.prune': '期限切れの意図を削除',
});

export function auditActionLabel(action) {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
