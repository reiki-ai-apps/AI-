// finance.js — お金の集計(純粋関数)。「支払予定と支払済み」「含み益と確定利益」を必ず分ける。
import { realCost, saleNet, unrealizedPnL, fmt } from "./money.js";

/** ローカルタイムの YYYY-MM を返す。日付のみ文字列はUTC解釈による日ずれを避けるためパースせずそのまま切り出す。 */
export function ymOf(dateLike) {
  if (typeof dateLike === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateLike)) return dateLike.slice(0, 7);
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const ACTIVE = ["到着待ち", "保有中", "出品中"]; // 資産として数える状態
const SOLD = ["売却済み", "入金済み"];

/**
 * サマリー計算。
 * settings.strictPayout = true のとき、確定利益は「入金済み」のみ数える。
 * (既定 false: 売却済み時点で確定利益に含め、未入金額は別枠で表示)
 */
export function computeSummary(products, settings, now) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const thisYm = ymOf(nowDate);
  const strict = !!(settings && settings.strictPayout);
  const budget = settings && Number.isInteger(settings.monthlyBudget) ? settings.monthlyBudget : 0;

  let monthSpend = 0; // 今月使った金額(注文日が今月の実質原価)
  let pendingPayment = 0; // 今後払う金額(未払いの実質原価)
  let monthUnpaid = 0; // 今月注文かつ未払い(monthSpendとpendingPaymentの重複分。予算で二重に引かないため)
  let arrivingCost = 0; // 到着待ち原価(支払済み・未着)
  let inventoryCost = 0; // 在庫原価(保有中+出品中)
  let estimatedValue = 0; // 推定資産価値(到着待ち含む)
  let estimateMissing = 0; // 相場未入力の件数(原価で代用した件数)
  let unrealized = 0; // 含み損益(推定値が入っているものだけ)
  let unrealizedCount = 0;
  let realizedProfit = 0; // 確定利益
  let unpaidSales = 0; // 未入金売上(手取りベース)
  let soldCount = 0;
  const monthlyMap = new Map(); // ym -> {spend, sales, profit}

  const bump = (ym, field, v) => {
    if (!ym) return;
    if (!monthlyMap.has(ym)) monthlyMap.set(ym, { ym, spend: 0, sales: 0, profit: 0 });
    monthlyMap.get(ym)[field] += v;
  };

  for (const p of products) {
    if (p.status === "キャンセル") continue; // 注文取消は金額に含めない
    let cost;
    try {
      cost = realCost(p.purchase);
    } catch {
      cost = 0; // 保存済みデータが壊れている場合も集計は止めない
    }

    const orderedYm = p.purchase && p.purchase.orderedAt ? ymOf(p.purchase.orderedAt) : null;
    if (p.status !== "返品") {
      bump(orderedYm, "spend", cost);
      const isThisMonth = orderedYm === thisYm;
      const isUnpaid = p.purchase && p.purchase.paymentStatus !== "paid";
      if (isThisMonth) monthSpend += cost;
      if (isUnpaid) pendingPayment += cost;
      if (isThisMonth && isUnpaid) monthUnpaid += cost;
    }

    if (p.status === "到着待ち") {
      if (p.purchase && p.purchase.paymentStatus === "paid") arrivingCost += cost;
    }
    if (p.status === "保有中" || p.status === "出品中") inventoryCost += cost;

    if (ACTIVE.includes(p.status)) {
      const est = p.market && p.market.estimatedValue !== null && p.market.estimatedValue !== undefined && p.market.estimatedValue !== ""
        ? Number(p.market.estimatedValue)
        : null;
      if (est !== null && Number.isFinite(est)) {
        estimatedValue += Math.trunc(est);
        let u = null;
        try {
          u = unrealizedPnL(est, p.purchase);
        } catch {
          /* 壊れたデータは含み損益に数えない(cost=0フォールバックと同方針) */
        }
        if (u !== null) {
          unrealized += u;
          unrealizedCount++;
        }
      } else {
        estimatedValue += cost; // 相場未入力は購入額で代用(件数を明示)
        estimateMissing++;
      }
    }

    if (SOLD.includes(p.status) && p.sale) {
      let net;
      try {
        net = saleNet(p.sale);
      } catch {
        net = 0;
      }
      const profit = net - cost;
      soldCount++;
      const soldYm = p.soldAt ? ymOf(p.soldAt) : orderedYm;
      bump(soldYm, "sales", net);
      const isPaid = p.status === "入金済み" || (p.sale.paymentStatus === "paid");
      if (!isPaid) unpaidSales += net;
      if (strict ? isPaid : true) {
        realizedProfit += profit;
        bump(soldYm, "profit", profit);
      }
    }
  }

  const monthly = [...monthlyMap.values()].sort((a, b) => (a.ym < b.ym ? 1 : -1));
  // 今月注文かつ未払いの分は monthSpend に含まれているため、二重に引かない(§35.2 同一取引を二重計上しない)
  const available = budget - monthSpend - (pendingPayment - monthUnpaid);

  return {
    monthSpend,
    pendingPayment,
    arrivingCost,
    inventoryCost,
    estimatedValue,
    estimateMissing,
    unrealized,
    unrealizedCount,
    realizedProfit,
    unpaidSales,
    soldCount,
    monthly,
    budget: { budget, used: monthSpend, pending: pendingPayment, overlap: monthUnpaid, available },
    fundsLocked: arrivingCost + inventoryCost + unpaidSales, // 資金拘束額
  };
}

/**
 * ホームの「今日やること」を組み立てる(締切が近い順)。
 * 種別: lottery-deadline / purchase-deadline / payment-due / sell-candidate
 */
export function buildTodos(products, lotteries, settings, now) {
  const nowT = (now instanceof Date ? now : new Date(now)).getTime();
  const H = 3600 * 1000;
  const todos = [];

  for (const l of lotteries) {
    if (l.status === "興味あり" && l.applicationDeadline) {
      const dl = new Date(l.applicationDeadline).getTime();
      const remain = dl - nowT;
      if (remain > 0 && remain <= 48 * H) {
        todos.push({ kind: "lottery-deadline", id: l.id, title: l.title, deadline: dl, remain });
      }
    }
    if (l.status === "当選" && l.purchaseDeadline) {
      const dl = new Date(l.purchaseDeadline).getTime();
      const remain = dl - nowT;
      if (remain > -24 * H && remain <= 72 * H) {
        todos.push({ kind: "purchase-deadline", id: l.id, title: l.title, deadline: dl, remain });
      }
    }
    if (l.status === "応募済み" && l.resultDate) {
      const rd = new Date(l.resultDate).getTime();
      if (rd <= nowT && nowT - rd <= 72 * H) {
        todos.push({ kind: "result-check", id: l.id, title: l.title, deadline: rd, remain: 0 });
      }
    }
  }

  for (const p of products) {
    let alreadyListed = false; // 同じ商品の通知を重複表示しない(§6.1)
    if (p.purchase && p.purchase.paymentStatus !== "paid" && p.purchase.paymentDueAt && p.status !== "キャンセル" && p.status !== "返品") {
      const dl = new Date(p.purchase.paymentDueAt).getTime();
      const remain = dl - nowT;
      if (remain <= 72 * H) {
        todos.push({ kind: "payment-due", id: p.id, title: p.name, deadline: dl, remain });
        alreadyListed = true;
      }
    }
    // 売却候補: 含み益が +3,000円以上 かつ +15%以上 (参考情報。断定しない)
    if (!alreadyListed && (p.status === "保有中" || p.status === "出品中") && p.market && p.market.estimatedValue) {
      try {
        const u = unrealizedPnL(p.market.estimatedValue, p.purchase);
        const cost = realCost(p.purchase);
        if (u !== null && cost > 0 && u >= 3000 && u / cost >= 0.15) {
          todos.push({ kind: "sell-candidate", id: p.id, title: p.name, deadline: Infinity, remain: Infinity, profit: u });
        }
      } catch {
        /* 集計を止めない */
      }
    }
  }

  todos.sort((a, b) => a.deadline - b.deadline);
  return todos.slice(0, 8);
}

/**
 * 登録完了時の即時フィードバック文(トースト用)。
 * 予算設定済みなら予算残、未設定なら今月仕入額を添える。金額はすべて決定論的計算の結果。
 */
export function registerFeedback(cost, summary) {
  const base = `実質原価 ${fmt(cost)}`;
  if (summary && summary.budget && summary.budget.budget > 0) {
    return `${base} / 今月の予算残 ${fmt(summary.budget.available)}`;
  }
  return `${base} / 今月仕入 ${fmt(summary ? summary.monthSpend : null)}`;
}

/** 残り時間の短い日本語表現 */
export function remainLabel(remainMs) {
  if (!Number.isFinite(remainMs)) return "";
  if (remainMs < 0) return "期限切れ";
  const h = Math.floor(remainMs / 3600000);
  if (h < 1) return `残り${Math.max(1, Math.floor(remainMs / 60000))}分`;
  if (h < 48) return `残り${h}時間`;
  return `残り${Math.floor(h / 24)}日`;
}
