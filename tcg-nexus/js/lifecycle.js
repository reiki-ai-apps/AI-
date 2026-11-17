// lifecycle.js — 商品・抽選の状態遷移(状態は勝手に飛ばさない)
// すべての遷移はここで許可判定し、履歴(監査)を必ず残す。

export const PRODUCT_STATUSES = [
  "到着待ち",
  "保有中",
  "出品中",
  "売却済み",
  "入金済み",
  "返品",
  "キャンセル",
];

// 商品の許可遷移。キー=現在状態、値=遷移可能な状態。
export const PRODUCT_TRANSITIONS = {
  到着待ち: ["保有中", "キャンセル"],
  保有中: ["出品中", "売却済み", "返品"],
  出品中: ["保有中", "売却済み"],
  売却済み: ["入金済み", "保有中"], // 保有中へ戻す = 売却取消
  入金済み: ["保有中"], // 返金による取消(要確認操作)
  返品: [],
  キャンセル: [],
};

// 遷移ボタンに出す操作ラベル
export const PRODUCT_ACTION_LABELS = {
  "到着待ち>保有中": "到着した",
  "到着待ち>キャンセル": "注文キャンセル",
  "保有中>出品中": "出品した",
  "保有中>売却済み": "売却を登録",
  "保有中>返品": "返品した",
  "出品中>保有中": "出品を取り下げ",
  "出品中>売却済み": "売却を登録",
  "売却済み>入金済み": "入金された",
  "売却済み>保有中": "売却を取消",
  "入金済み>保有中": "返金で取消",
};

export const LOTTERY_STATUSES = [
  "興味あり",
  "応募済み",
  "当選",
  "落選",
  "購入済み",
  "見送り",
  "終了",
];

export const LOTTERY_TRANSITIONS = {
  興味あり: ["応募済み", "見送り", "終了"],
  応募済み: ["当選", "落選", "終了"],
  当選: ["購入済み", "見送り"], // 見送り = 購入権を使わない
  落選: [],
  購入済み: [],
  見送り: [],
  終了: [],
};

export const LOTTERY_ACTION_LABELS = {
  "興味あり>応募済み": "応募した",
  "興味あり>見送り": "見送る",
  "興味あり>終了": "終了にする",
  "応募済み>当選": "当選した",
  "応募済み>落選": "落選した",
  "応募済み>終了": "終了にする",
  "当選>購入済み": "購入を登録",
  "当選>見送り": "購入を見送る",
};

export function canTransition(map, from, to) {
  const allowed = map[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

/**
 * 遷移を適用し、履歴エントリを追加した新しいオブジェクトを返す。
 * 許可されない遷移は例外。呼び出し側は監査ログも別途記録すること。
 */
export function applyProductTransition(product, to, note, nowIso) {
  if (!canTransition(PRODUCT_TRANSITIONS, product.status, to)) {
    throw new Error(`「${product.status}」から「${to}」へは変更できません`);
  }
  const next = structuredClone(product);
  const entry = { at: nowIso, from: product.status, to, note: note || "" };
  next.status = to;
  next.history = [...(product.history || []), entry];
  next.updatedAt = nowIso;
  if (to === "保有中" && product.status === "到着待ち") next.receivedAt = nowIso;
  if (to === "出品中") next.listedAt = nowIso;
  if (to === "売却済み") next.soldAt = nowIso;
  if (to === "入金済み" && next.sale) {
    next.sale.paymentStatus = "paid";
    next.sale.payoutAt = nowIso;
  }
  // 売却取消(売却済み/入金済み → 保有中): 売却情報を履歴に退避して現役から外す
  if (to === "保有中" && (product.status === "売却済み" || product.status === "入金済み")) {
    if (next.sale) {
      next.canceledSales = [...(next.canceledSales || []), { ...next.sale, canceledAt: nowIso }];
      next.sale = null;
    }
    next.soldAt = null;
  }
  return next;
}

export function applyLotteryTransition(lottery, to, note, nowIso) {
  if (!canTransition(LOTTERY_TRANSITIONS, lottery.status, to)) {
    throw new Error(`「${lottery.status}」から「${to}」へは変更できません`);
  }
  const next = structuredClone(lottery);
  next.status = to;
  next.history = [...(lottery.history || []), { at: nowIso, from: lottery.status, to, note: note || "" }];
  next.updatedAt = nowIso;
  if (to === "応募済み") next.appliedAt = nowIso;
  if (to === "当選" || to === "落選") next.resultAt = nowIso;
  return next;
}

/** 商品一覧タブのフィルタ。入金済みは「売却済み」タブに含める。 */
export function productTabFilter(tab) {
  switch (tab) {
    case "到着待ち":
      return (p) => p.status === "到着待ち";
    case "保有中":
      return (p) => p.status === "保有中";
    case "出品中":
      return (p) => p.status === "出品中";
    case "売却済み":
      return (p) => p.status === "売却済み" || p.status === "入金済み";
    default:
      return () => true;
  }
}

/**
 * 抽選一覧タブのフィルタ。
 * おすすめ: 興味あり(未応募)
 * 締切間近: 未応募かつ締切まで48時間以内
 * 応募済み: 応募済み(締切前後問わず)
 * 結果待ち: 応募済みで締切を過ぎ、結果未登録
 * 終了: 当選/落選/購入済み/見送り/終了
 */
export function lotteryTabFilter(tab, now) {
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const deadlinePassed = (l) => l.applicationDeadline && new Date(l.applicationDeadline).getTime() < t;
  const within48h = (l) => {
    if (!l.applicationDeadline) return false;
    const d = new Date(l.applicationDeadline).getTime() - t;
    return d > 0 && d <= 48 * 3600 * 1000;
  };
  switch (tab) {
    case "おすすめ":
      return (l) => l.status === "興味あり" && !deadlinePassed(l);
    case "締切間近":
      return (l) => l.status === "興味あり" && within48h(l);
    case "応募済み":
      return (l) => l.status === "応募済み";
    case "結果待ち":
      return (l) => l.status === "応募済み" && deadlinePassed(l);
    case "終了":
      // 応募しないまま締切が過ぎた「興味あり」もここに含める(どのタブからも見えなくなるのを防ぐ)
      return (l) =>
        ["当選", "落選", "購入済み", "見送り", "終了"].includes(l.status) ||
        (l.status === "興味あり" && deadlinePassed(l));
    default:
      return () => true;
  }
}
