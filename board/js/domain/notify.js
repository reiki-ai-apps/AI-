// §18 通知設計 — 通知を増やさず、「原因＋次の一手」があるものだけを届ける。
//
// このモジュールは条件判定だけを行う純粋関数。
// 実際の配信 (Outbox・重複防止) は services/audit.js 側で行う。

import { HOUR_MS } from '../core/clock.js';
import { platformName } from './platforms.js';
import { brandName } from './brands.js';
import { failureKind } from './state.js';

export const SEVERITY = Object.freeze({
  URGENT: { id: 'URGENT', label: '緊急', rank: 3 },
  ATTENTION: { id: 'ATTENTION', label: '注意', rank: 2 },
  NORMAL: { id: 'NORMAL', label: '通常', rank: 1 },
});

/**
 * §18 の表の7条件。ここに無い理由では通知しない。
 *
 * DUE_FOR_MANUAL_PUBLISH だけは §18 の表に無い8件目。
 * §18 は自動実行がある前提で書かれているが、§38 のとおり4SNSとも直接投稿を
 * 有効にできないため、予定時刻の到来を人へ渡す通知がないと運用が止まる。
 * 自動実行(次フェーズ)が入ったら、この条件は不要になる。
 */
export const CONDITIONS = Object.freeze({
  UNAPPROVED_24H: 'UNAPPROVED_24H',
  MISSING_ASSET_1H: 'MISSING_ASSET_1H',
  PUBLISH_FAILED: 'PUBLISH_FAILED',
  OUTCOME_UNKNOWN: 'OUTCOME_UNKNOWN',
  CREDENTIAL_EXPIRED: 'CREDENTIAL_EXPIRED',
  NO_PLAN: 'NO_PLAN',
  PUBLISH_SUCCEEDED: 'PUBLISH_SUCCEEDED',
  DUE_FOR_MANUAL_PUBLISH: 'DUE_FOR_MANUAL_PUBLISH',
});

function subjectLabel(post) {
  return `${brandName(post.brandId)}／${platformName(post.platform)}「${post.title}」`;
}

/**
 * 1件の投稿について、成立している通知条件をすべて返す。
 * @param {object} post
 * @param {number} nowMs
 */
export function evaluatePost(post, nowMs) {
  const out = [];
  const untilMs = Number.isFinite(post.scheduledAtMs) ? post.scheduledAtMs - nowMs : Infinity;
  const subject = subjectLabel(post);

  // 結果不明 — 再送しない。人の確認へ引き継ぐ。
  if (post.failureKind === 'UNKNOWN_OUTCOME') {
    out.push({
      condition: CONDITIONS.OUTCOME_UNKNOWN,
      severity: SEVERITY.URGENT.id,
      subject,
      cause: `${subject}の投稿結果を確認できていません。`,
      nextStep: '再送していません。SNS側に投稿されているか確認してください。',
      action: { label: '照合状況を見る', route: 'post', postId: post.id },
    });
  } else if (post.failureKind) {
    // 投稿失敗 — 失敗分類と推奨操作を出す。
    const kind = failureKind(post.failureKind);
    out.push({
      condition: CONDITIONS.PUBLISH_FAILED,
      severity: SEVERITY.URGENT.id,
      subject,
      cause: `${subject}が失敗しました（${kind.label}）。${kind.cause}。`,
      nextStep: kind.recommend,
      action: { label: '対応する', route: 'post', postId: post.id },
    });
  }

  // 認証切れ／権限変更
  if (post.credentialExpired) {
    out.push({
      condition: CONDITIONS.CREDENTIAL_EXPIRED,
      severity: SEVERITY.URGENT.id,
      subject,
      cause: `${platformName(post.platform)}の認証が切れています。`,
      nextStep: '接続設定から再接続してください。',
      action: { label: '接続設定を開く', route: 'connections', platform: post.platform },
    });
  }

  // 公開が終わっていないものは、予定時刻を過ぎても対象から外さない。
  // 「あと少しで公開」と「もう過ぎている」で文言を変える。
  const open = !['PUBLISHED'].includes(post.displayState);
  const overdue = open && untilMs <= 0;

  // 1時間前で素材／権利不足
  if (open && untilMs <= HOUR_MS && (!post.hasAssets || !post.rightsConfirmed)) {
    const missing = [!post.hasAssets ? '素材' : null, !post.rightsConfirmed ? '権利確認' : null]
      .filter(Boolean)
      .join('と');
    out.push({
      condition: CONDITIONS.MISSING_ASSET_1H,
      severity: SEVERITY.URGENT.id,
      subject,
      cause: overdue
        ? `${subject}は公開予定時刻を過ぎていますが、${missing}がそろっていません。`
        : `${subject}は公開1時間前ですが、${missing}がそろっていません。`,
      nextStep: `${missing}を追加してください。`,
      action: { label: '修正する', route: 'post', postId: post.id },
    });
  }

  // 予約済みなのに承認が切れている — 手動投稿の案内より先に再承認を出す。
  // (実行APIは §14 の二重検査で必ず弾くので、画面もそれに合わせる)
  const approvalLost = post.displayState === 'SCHEDULED' && post.approvalValid === false;

  // 予定時刻が来た予約 — 直接投稿が有効でないSNSは人が投稿する (§16)
  if (post.displayState === 'SCHEDULED' && untilMs <= 0 && !approvalLost) {
    out.push({
      condition: CONDITIONS.DUE_FOR_MANUAL_PUBLISH,
      severity: SEVERITY.URGENT.id,
      subject,
      cause: `${subject}は公開予定時刻になりましたが、まだ公開されていません。`,
      nextStep: `${platformName(post.platform)}で投稿し、公開URLを登録してください。`,
      action: { label: '手動で投稿する', route: 'post', postId: post.id },
    });
  }

  // 24時間前で未承認 / 承認が失効した
  const awaitingApproval =
    ['DRAFT', 'QUALITY_REVIEW', 'PENDING_APPROVAL'].includes(post.displayState) || approvalLost;
  if (awaitingApproval && untilMs <= 24 * HOUR_MS) {
    out.push({
      condition: CONDITIONS.UNAPPROVED_24H,
      severity: overdue || approvalLost ? SEVERITY.URGENT.id : SEVERITY.ATTENTION.id,
      subject,
      cause: approvalLost
        ? `${subject}は承認の有効期限が切れています。このままでは投稿できません。`
        : overdue
          ? `${subject}は公開予定時刻を過ぎていますが、まだ承認されていません。`
          : `${subject}は公開24時間前ですが、まだ承認されていません。`,
      nextStep: approvalLost
        ? '公開予定日時を確認し、あらためて承認してください。'
        : overdue
          ? '内容を確認して承認するか、日時を変更してください。'
          : '内容を確認して承認してください。',
      action: { label: approvalLost ? '再承認へ進む' : '承認へ進む', route: 'post', postId: post.id },
    });
  }

  // 投稿成功 — 公開URLだけを届ける。
  if (post.displayState === 'PUBLISHED' && post.publicUrl) {
    out.push({
      condition: CONDITIONS.PUBLISH_SUCCEEDED,
      severity: SEVERITY.NORMAL.id,
      subject,
      cause: `${subject}を公開しました。`,
      nextStep: '公開ページを確認できます。',
      action: { label: '投稿を見る', route: 'post', postId: post.id, url: post.publicUrl },
    });
  }

  return out.map((n) => ({ ...n, postId: post.id, dedupeKey: `${n.condition}:${post.id}` }));
}

/**
 * 「予定なし」の日についての通知 (§18)。投稿ではなく日に対して出す。
 */
export function evaluateEmptyDay(dateKey) {
  return {
    condition: CONDITIONS.NO_PLAN,
    severity: SEVERITY.ATTENTION.id,
    subject: dateKey,
    cause: 'この日は投稿の予定がありません。',
    nextStep: '投稿を追加するか、意図的な休止として記録してください。',
    action: { label: 'この日を開く', route: 'calendar', dateKey },
    dateKey,
    dedupeKey: `${CONDITIONS.NO_PLAN}:${dateKey}`,
  };
}

/** 重要度順 → 予定時刻順に並べる。 */
export function sortNotifications(list) {
  return [...list].sort((a, b) => {
    const rank = SEVERITY[b.severity].rank - SEVERITY[a.severity].rank;
    if (rank !== 0) return rank;
    return (a.scheduledAtMs ?? 0) - (b.scheduledAtMs ?? 0);
  });
}

/**
 * §18 通知の契約: 同一事象の重複通知を防ぐ。
 * すでに配信済みの dedupeKey を除く。
 */
export function dedupe(list, alreadySent = new Set()) {
  const seen = new Set(alreadySent);
  const out = [];
  for (const n of list) {
    if (seen.has(n.dedupeKey)) continue;
    seen.add(n.dedupeKey);
    out.push(n);
  }
  return out;
}

/** すべての通知は「原因」と「次の一手」を持たなければならない (§18)。 */
export function isWellFormed(n) {
  return Boolean(n && n.cause && n.nextStep && n.action?.label && SEVERITY[n.severity]);
}
