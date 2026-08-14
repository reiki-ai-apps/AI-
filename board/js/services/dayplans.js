// §07 空白日の選択 — 「この日は休止」を理由・設定者・日時つきで記録する (G06)。
//
// 「投稿がない」と「意図的に休む」を同じ表示にしないために、休止は必ずデータとして残す。

import { uuid } from '../core/ids.js';
import { domainDigest } from '../core/digest.js';
import { assertCan } from '../domain/rbac.js';
import { createPause, releasePause } from '../domain/dayplan.js';
import { InvariantError } from '../domain/invariants.js';

const SNAPSHOT_DOMAIN = 'REIKI-AUDIT-SNAPSHOT-V1';

async function snapshotHash(value) {
  return value == null ? null : domainDigest(SNAPSHOT_DOMAIN, value);
}

/** その日を意図的な休止にする。 */
export async function pauseDay(ctx, dateKey, { reason }) {
  assertCan(ctx.actor.role, 'post.edit');

  const posts = await ctx.repo.listPostsForDay(dateKey);
  if (posts.length > 0) {
    throw new InvariantError(
      'DAY_NOT_EMPTY',
      'この日には投稿があります。先に投稿を取消してから休止にしてください。',
    );
  }

  const existing = await ctx.repo.getDayPlan(dateKey);
  if (existing?.paused) throw new InvariantError('STATE_CONFLICT', 'すでに休止として記録されています。');

  const plan = createPause({
    dateKey,
    reason,
    setBy: ctx.actor.userId,
    setAtIso: ctx.clock.nowIso(),
  });

  const record = {
    day_plan_id: existing?.day_plan_id ?? uuid(),
    date_key: plan.dateKey,
    brand_id: plan.brandId,
    paused: true,
    reason: plan.reason,
    set_by: plan.setBy,
    set_at: plan.setAtIso,
    released_by: null,
    released_at: null,
  };

  await ctx.repo.change(['dayPlans'], async (tx, audit) => {
    await tx.put('dayPlans', record);
    await audit({
      actor: ctx.actor.userId,
      target_type: 'dayPlan',
      target_id: dateKey,
      action: 'dayplan.pause',
      before_hash: await snapshotHash(existing ?? null),
      after_hash: await snapshotHash(record),
      reason: plan.reason,
    });
  });

  return { dateKey, paused: true, reason: plan.reason };
}

/** 休止の解除。記録は消さず、解除の事実を残す。 */
export async function releaseDay(ctx, dateKey, { reason = '休止を解除' } = {}) {
  assertCan(ctx.actor.role, 'post.edit');

  const existing = await ctx.repo.getDayPlan(dateKey);
  if (!existing?.paused) throw new InvariantError('STATE_CONFLICT', '休止していない日です。');

  const next = releasePause(
    { ...existing, paused: true },
    { by: ctx.actor.userId, atIso: ctx.clock.nowIso() },
  );
  const record = {
    ...existing,
    paused: false,
    released_by: next.releasedBy,
    released_at: next.releasedAtIso,
  };

  await ctx.repo.change(['dayPlans'], async (tx, audit) => {
    await tx.put('dayPlans', record);
    await audit({
      actor: ctx.actor.userId,
      target_type: 'dayPlan',
      target_id: dateKey,
      action: 'dayplan.release',
      before_hash: await snapshotHash(existing),
      after_hash: await snapshotHash(record),
      reason,
    });
  });

  return { dateKey, paused: false };
}

/** カレンダーが使う形へ。 */
export function toDayPlanView(record) {
  return {
    dateKey: record.date_key,
    paused: record.paused === true,
    reason: record.reason ?? '',
    setBy: record.set_by ?? '',
    setAtIso: record.set_at ?? null,
  };
}
