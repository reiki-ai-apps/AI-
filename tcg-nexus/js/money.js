// money.js — 金額計算コア(決定論的・整数円のみ)
// 設計原則: 金額計算はAIではなくこのモジュールだけが行う。
// すべての金額は日本円の整数。丸めは「切り捨て(floor)」に固定する。

/** 値を非負整数円として検証して返す。不正なら 0 扱いにせず例外にする。 */
export function yen(value, label = "金額") {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "string" ? Number(value.replace(/[,、\s円]/g, "")) : Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label}が数値ではありません`);
  const i = Math.trunc(n);
  if (i !== n) throw new Error(`${label}は整数(円)で入力してください`);
  if (i < 0) throw new Error(`${label}は0以上で入力してください`);
  return i;
}

/**
 * 実質原価(仕入側)
 * = 商品購入額 + 購入送料 + 決済手数料 + 鑑定費 + その他費用 - 値引き - 充当ポイント
 * 値引き+ポイントが費用合計を超える入力は不正(負の原価を作らない)。
 */
export function realCost(purchase) {
  const p = purchase || {};
  const gross =
    yen(p.itemPrice, "商品購入額") +
    yen(p.shippingFee, "購入送料") +
    yen(p.paymentFee, "決済手数料") +
    yen(p.gradingFee, "鑑定費") +
    yen(p.otherFee, "その他費用");
  const deduction = yen(p.discount, "値引き") + yen(p.pointsUsed, "ポイント利用");
  if (deduction > gross) {
    throw new Error("値引き・ポイントの合計が購入費用の合計を超えています");
  }
  return gross - deduction;
}

/**
 * 売却の手取り額(販売側)
 * = 売却額 - 販売手数料 - 販売送料 - 梱包費 - 振込手数料 - その他販売費
 * 手取りが負になる入力も許容する(赤字売却は現実に起こる)。
 */
export function saleNet(sale) {
  const s = sale || {};
  return (
    yen(s.grossAmount, "売却額") -
    yen(s.platformFee, "販売手数料") -
    yen(s.shippingFee, "販売送料") -
    yen(s.packingFee, "梱包費") -
    yen(s.payoutFee, "振込手数料") -
    yen(s.otherFee, "その他販売費")
  );
}

/** 実質利益 = 売却手取り - 商品実質原価 (負もあり得る) */
export function realizedProfit(sale, purchase) {
  return saleNet(sale) - realCost(purchase);
}

/**
 * 販売手数料を率(%)から計算する。端数は切り捨て。
 * rate は 10 (=10%) や 6.6 (=6.6%) のような百分率。内部では basis point で計算し浮動小数の誤差を避ける。
 */
export function feeFromRate(price, ratePercent) {
  const p = yen(price, "売却額");
  const r = Number(ratePercent);
  if (!Number.isFinite(r) || r < 0 || r > 100) throw new Error("手数料率は0〜100の範囲で入力してください");
  const bp = Math.round(r * 100); // 6.6% -> 660bp
  return Math.floor((p * bp) / 10000);
}

/**
 * 売却シミュレーション。
 * input: { price, feeRate?, feeFixed?, shippingFee?, packingFee?, payoutFee?, otherFee? }
 * feeRate と feeFixed は併用可(率で計算した額 + 固定額)。
 * 返り値はすべて整数円の内訳。ROI(%) のみ小数1桁の数値。
 */
export function simulateSale(input, purchase) {
  const price = yen(input.price, "売却予定価格");
  const rateFee = input.feeRate !== undefined && input.feeRate !== null && input.feeRate !== ""
    ? feeFromRate(price, input.feeRate)
    : 0;
  const platformFee = rateFee + yen(input.feeFixed, "固定手数料");
  const shippingFee = yen(input.shippingFee, "送料");
  const packingFee = yen(input.packingFee, "梱包費");
  const payoutFee = yen(input.payoutFee, "振込手数料");
  const otherFee = yen(input.otherFee, "その他販売費");
  const cost = realCost(purchase);
  const net = price - platformFee - shippingFee - packingFee - payoutFee - otherFee;
  const profit = net - cost;
  return {
    price,
    platformFee,
    shippingFee,
    packingFee,
    payoutFee,
    otherFee,
    cost,
    net,
    profit,
    roi: roi(profit, cost),
  };
}

/** ROI(%) = 利益 ÷ 原価 × 100。小数1桁に切り捨て。原価0のときは null(定義不能)。 */
export function roi(profit, cost) {
  if (!Number.isFinite(profit) || !Number.isFinite(cost)) return null;
  if (cost <= 0) return null;
  return Math.trunc((profit / cost) * 1000) / 10;
}

/** 含み損益 = 現在推定価値 - 実質原価。推定値未入力(null)なら null を返し、勝手に0にしない。 */
export function unrealizedPnL(estimatedValue, purchase) {
  if (estimatedValue === null || estimatedValue === undefined || estimatedValue === "") return null;
  return yen(estimatedValue, "推定価値") - realCost(purchase);
}

/** 3桁区切り + 円。負値は −1,234円。null は "—"。 */
export function fmt(n) {
  if (n === null || n === undefined) return "—";
  const sign = n < 0 ? "-" : "";
  return sign + Math.abs(n).toLocaleString("ja-JP") + "円";
}

/** 損益表示用: +/− 符号を必ず付ける。 */
export function fmtSigned(n) {
  if (n === null || n === undefined) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "±";
  return sign + Math.abs(n).toLocaleString("ja-JP") + "円";
}
