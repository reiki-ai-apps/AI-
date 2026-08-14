// 制作の進み具合（純粋関数のみ）。
//
// 表示状態（下書き／承認待ち／予約済み…）だけでは「台本はできたが動画がまだ」を表せない。
// 実際の報告は必ずこの粒度で書かれるので、投稿ごとに**残作業の一覧**を持たせる。
//
// 役割の分担をはっきりさせておく:
//   盤面が決める : 承認されたか・予約されたか・公開されたか（監査と不変条件で裏が取れるもの）
//   制作側が申告 : 台本・音声・画像・検査などの進み具合（外で作っているので盤面には確かめようがない）
//   ここで出す   : 上の2つを合わせた「いま何で止まっているか」と「次の一手」
//
// 申告された進み具合を承認や公開の代わりにはしない。チェックが全部ついても、
// 承認が無ければ止まっている理由は「承認待ち」のままになる。

import { isPlatformId } from './platforms.js';

/** 制作物の種類。手順の既定値がこれで決まる。 */
export const PRODUCTION_KINDS = Object.freeze({
  ARTICLE: 'ARTICLE',
  VIDEO: 'VIDEO',
  SHORT_VIDEO: 'SHORT_VIDEO',
  SHORT_TEXT: 'SHORT_TEXT',
});

export const PRODUCTION_KIND_LABELS = Object.freeze({
  ARTICLE: '記事',
  VIDEO: '動画',
  SHORT_VIDEO: 'ショート動画',
  SHORT_TEXT: '短文',
});

/** 媒体から既定の種類を決める。指定があればそちらを使う。 */
export function kindForPlatform(platformId) {
  switch (platformId) {
    case 'NOTE': return PRODUCTION_KINDS.ARTICLE;
    case 'YOUTUBE': return PRODUCTION_KINDS.VIDEO;
    case 'INSTAGRAM':
    case 'TIKTOK': return PRODUCTION_KINDS.SHORT_VIDEO;
    case 'X': return PRODUCTION_KINDS.SHORT_TEXT;
    default:
      if (!isPlatformId(platformId)) throw new RangeError(`未知の媒体です: ${platformId}`);
      return PRODUCTION_KINDS.SHORT_TEXT;
  }
}

/**
 * 既定の手順。実際に何を作るかは制作側の都合で変わるので、
 * これは「最初に置いておく雛形」であって、申告側が差し替えてよい。
 */
export const DEFAULT_STEPS = Object.freeze({
  ARTICLE: Object.freeze([
    { id: 'body', label: '本文' },
    { id: 'paywall', label: '有料境界' },
    { id: 'images', label: '画像' },
    { id: 'thumbnail', label: 'サムネイル' },
    { id: 'quality', label: '品質検査' },
    { id: 'link', label: '正式リンク' },
  ]),
  VIDEO: Object.freeze([
    { id: 'sources', label: '一次情報' },
    { id: 'script', label: '台本' },
    { id: 'narration', label: 'ナレーション' },
    { id: 'visuals', label: '固有画像' },
    { id: 'thumbnail', label: 'サムネイル' },
    { id: 'bgm', label: 'BGM' },
    { id: 'render', label: 'MP4書き出し' },
    { id: 'qc', label: '音声・映像QC' },
  ]),
  SHORT_VIDEO: Object.freeze([
    { id: 'script', label: '構成' },
    { id: 'visuals', label: '素材' },
    { id: 'render', label: '書き出し' },
    { id: 'caption', label: 'キャプション' },
    { id: 'qc', label: '確認' },
  ]),
  SHORT_TEXT: Object.freeze([
    { id: 'draft', label: '原稿' },
    { id: 'sources', label: '一次情報' },
    { id: 'link', label: '正式リンク' },
  ]),
});

export function defaultSteps(kind) {
  const steps = DEFAULT_STEPS[kind];
  if (!steps) throw new RangeError(`未知の制作種類です: ${kind}`);
  return steps.map((s) => ({ ...s, done: false, note: null }));
}

const STEP_ID_RE = /^[a-z0-9][a-z0-9_]{0,39}$/;

export class ProductionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProductionError';
    this.code = 'BAD_PRODUCTION';
    this.status = 400;
  }
}

/**
 * 申告された進み具合の形を整える。
 * 順番は申告どおりに保つ（制作の順序そのものに意味があるため）。
 */
export function normalizeProduction({ kind, steps }) {
  if (!Object.hasOwn(PRODUCTION_KINDS, kind)) {
    throw new ProductionError(`制作種類が不正です: ${String(kind)}`);
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new ProductionError('作業の一覧を1件以上で指定してください。');
  }
  if (steps.length > 40) {
    throw new ProductionError('作業は40件までにしてください。');
  }
  const seen = new Set();
  const normalized = steps.map((step) => {
    if (typeof step?.id !== 'string' || !STEP_ID_RE.test(step.id)) {
      throw new ProductionError(`作業のidが不正です: ${String(step?.id)}（英小文字・数字・_ で40字まで）`);
    }
    if (seen.has(step.id)) throw new ProductionError(`作業のidが重複しています: ${step.id}`);
    seen.add(step.id);
    const label = typeof step.label === 'string' ? step.label.trim() : '';
    if (!label) throw new ProductionError(`作業 ${step.id} の名前を入れてください。`);
    if (label.length > 40) throw new ProductionError(`作業 ${step.id} の名前が長すぎます（40字まで）。`);
    const note = typeof step.note === 'string' && step.note.trim() ? step.note.trim().slice(0, 200) : null;
    return { id: step.id, label, done: step.done === true, note };
  });
  return { kind, steps: normalized };
}

/** 進み具合の集計。 */
export function productionProgress(production) {
  const steps = production?.steps ?? [];
  const done = steps.filter((s) => s.done).length;
  return {
    done,
    total: steps.length,
    complete: steps.length > 0 && done === steps.length,
    /** 未完了の作業。表示順は申告どおり。 */
    remaining: steps.filter((s) => !s.done),
    label: steps.length ? `${done}／${steps.length}` : '—',
  };
}

// ---------------------------------------------------------------------------
// いま何で止まっているか
// ---------------------------------------------------------------------------

/**
 * 止まっている理由の分類。数字が小さいほど先に手を付ける。
 * 「人が動けば進むもの」を上に、「制作の続きが要るもの」を下に置く。
 */
export const BLOCK_KINDS = Object.freeze({
  ACTION_REQUIRED: { id: 'ACTION_REQUIRED', priority: 1, label: '要対応' },
  REAPPROVAL: { id: 'REAPPROVAL', priority: 2, label: '再承認待ち' },
  APPROVAL: { id: 'APPROVAL', priority: 3, label: '承認待ち' },
  PRODUCTION: { id: 'PRODUCTION', priority: 4, label: '制作中' },
  SCHEDULE: { id: 'SCHEDULE', priority: 5, label: '予約待ち' },
  PUBLISH: { id: 'PUBLISH', priority: 6, label: '公開待ち' },
  NONE: { id: 'NONE', priority: 9, label: '手当て不要' },
});

/**
 * 1件の投稿について「止まっている理由」と「次の一手」を出す。
 *
 * @param {object} post   toPostView() の結果（displayState / approvalValid など）
 * @param {object} [production] 申告された進み具合
 * @returns {{kind:string, priority:number, reason:string, next:string, remaining:Array}}
 */
export function blockingState(post, production = null) {
  const progress = productionProgress(production);
  const remaining = progress.remaining;

  if (post.displayState === 'ACTION_REQUIRED') {
    return {
      kind: 'ACTION_REQUIRED', priority: BLOCK_KINDS.ACTION_REQUIRED.priority,
      reason: post.failureKind === 'UNKNOWN_OUTCOME'
        ? '送信しましたが結果を確認できていません'
        : '失敗または不足があります',
      next: post.failureKind === 'UNKNOWN_OUTCOME' ? 'SNS側の投稿有無を確認する' : '原因を確認して対応する',
      remaining,
    };
  }

  if (post.displayState === 'PUBLISHED') {
    return { kind: 'NONE', priority: BLOCK_KINDS.NONE.priority, reason: '公開済み', next: '—', remaining: [] };
  }

  if (post.displayState === 'PUBLISHING') {
    return {
      kind: 'PUBLISH', priority: BLOCK_KINDS.PUBLISH.priority,
      reason: '投稿の手続き中です', next: '公開URLを登録して確定する', remaining,
    };
  }

  // 承認が外れている / 期限切れ。制作が全部終わっていても、ここが先。
  if (post.displayState === 'SCHEDULED' && !post.approvalValid) {
    return {
      kind: 'REAPPROVAL', priority: BLOCK_KINDS.REAPPROVAL.priority,
      reason: '内容が変わったか期限が切れたため、承認をやり直す必要があります',
      next: '内容を確かめて承認し直す', remaining,
    };
  }

  if (post.displayState === 'PENDING_APPROVAL') {
    return {
      kind: 'APPROVAL', priority: BLOCK_KINDS.APPROVAL.priority,
      reason: '公開してよいかの判断を待っています', next: '内容を確認して承認する', remaining,
    };
  }

  // 下書き・品質確認中は、まず残作業を見る。
  if (remaining.length) {
    const names = remaining.slice(0, 3).map((s) => s.label).join('・');
    const more = remaining.length > 3 ? `ほか${remaining.length - 3}件` : '';
    return {
      kind: 'PRODUCTION', priority: BLOCK_KINDS.PRODUCTION.priority,
      reason: `${names}${more}が未完了です`,
      next: `${remaining[0].label}を仕上げる`,
      remaining,
    };
  }

  if (post.displayState === 'DRAFT' || post.displayState === 'QUALITY_REVIEW') {
    return {
      kind: 'APPROVAL', priority: BLOCK_KINDS.APPROVAL.priority,
      reason: '制作は終わっています。確認を依頼していません',
      next: '確認を依頼する', remaining,
    };
  }

  return {
    kind: 'SCHEDULE', priority: BLOCK_KINDS.SCHEDULE.priority,
    reason: '公開予定日時を待っています', next: '予定どおり公開する', remaining,
  };
}

/**
 * 止まっているものを、手を付ける順に並べる。
 * 同じ理由どうしは公開予定が早いほうを先にする。
 */
export function blockedList(entries) {
  return entries
    .map(({ post, production }) => ({ post, production, block: blockingState(post, production) }))
    .filter((row) => row.block.kind !== 'NONE')
    .sort((a, b) => a.block.priority - b.block.priority || a.post.scheduledAtMs - b.post.scheduledAtMs);
}
