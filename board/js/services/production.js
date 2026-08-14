// 制作の進み具合の申告 (§10 内部情報)。
//
// 台本・音声・画像・検査といった作業は盤面の外で進むので、盤面には確かめようがない。
// だから「申告されたもの」として持ち、承認や公開の代わりには決してしない。
//
// 承認根拠 (§14) には**構造的に入らない**。
//   ・承認根拠は版(postRevisions)と予約から組み立てる
//   ・進み具合は ChannelPost 側に持つ
// つまりチェックを付けても承認は外れない（社内メモと同じ扱い / G07）。

import { domainDigest } from '../core/digest.js';
import { assertCan } from '../domain/rbac.js';
import {
  defaultSteps,
  kindForPlatform,
  normalizeProduction,
  productionProgress,
  blockingState,
} from '../domain/production.js';
import { toPostView } from '../store/repo.js';
import { ValidationError } from './posts.js';

const SNAPSHOT_DOMAIN = 'REIKI-AUDIT-SNAPSHOT-V1';

/**
 * 進み具合を申告する。作業の一覧ごと差し替える形にしてある。
 * 「3番目だけ完了にする」のような部分更新は、取り違えると実態とずれるので受けない。
 *
 * @param {object} ctx
 * @param {string} channelPostId
 * @param {{kind?:string, steps:Array, reason?:string}} input
 */
export async function updateProduction(ctx, channelPostId, input = {}) {
  // 承認根拠に影響しないので、承認者の「軽微な編集」でも通す (§17)。
  assertCan(ctx.actor.role, 'post.edit.internal');

  const post = await ctx.repo.getPost(channelPostId);
  if (!post) throw new ValidationError('対象の投稿が見つかりません。');
  if (post.deleted_at) throw new ValidationError('削除された投稿は編集できません。');

  const kind = input.kind ?? post.production?.kind ?? kindForPlatform(post.platform);
  const steps = input.steps ?? post.production?.steps ?? defaultSteps(kind);
  const normalized = normalizeProduction({ kind, steps });

  const now = ctx.clock.nowIso();
  const production = { ...normalized, updated_at: now, updated_by: ctx.actor.userId };
  const progress = productionProgress(production);

  const updatedPost = { ...post, production, updated_at: now };
  const beforeHash = await domainDigest(SNAPSHOT_DOMAIN, post.production ?? null);
  const afterHash = await domainDigest(SNAPSHOT_DOMAIN, production);

  await ctx.repo.change(['channelPosts'], async (tx, audit) => {
    const live = await tx.get('channelPosts', channelPostId);
    if (!live) throw new ValidationError('対象の投稿が見つかりません。');
    // 版と承認には触れない。進み具合だけを差し替える。
    await tx.put('channelPosts', { ...live, production, updated_at: now });
    await audit({
      actor: ctx.actor.userId,
      target_id: channelPostId,
      action: 'production.update',
      before_hash: beforeHash,
      after_hash: afterHash,
      reason: input.reason ?? `制作の進み具合を更新（${progress.label}）`,
    });
  });

  return {
    channelPostId,
    kind: production.kind,
    progress: progress.label,
    complete: progress.complete,
    remaining: progress.remaining.map((s) => s.label),
    block: blockingState(toPostView(updatedPost, ctx.clock.nowMs()), production),
  };
}

/** その投稿の進み具合。まだ申告が無ければ既定の手順を（未完了で）返す。 */
export async function describeProduction(ctx, channelPostId) {
  const post = await ctx.repo.getPost(channelPostId);
  if (!post) throw new ValidationError('対象の投稿が見つかりません。');
  const reported = post.production ?? null;
  const kind = reported?.kind ?? kindForPlatform(post.platform);
  return {
    channelPostId,
    kind,
    reported: Boolean(reported),
    steps: reported?.steps ?? defaultSteps(kind),
    updatedAt: reported?.updated_at ?? null,
    updatedBy: reported?.updated_by ?? null,
    block: blockingState(toPostView(post, ctx.clock.nowMs()), reported),
  };
}
