// app.js — TCG Nexus UI。金額計算は money.js / 集計は finance.js のみを使う(UIでは計算しない)。
import * as Money from "./money.js";
import * as Life from "./lifecycle.js";
import * as Fin from "./finance.js";
import * as Csv from "./csv.js";
import * as Store from "./store.js";

let state = Store.load();
let route = { view: "home", productTab: "すべて", lotteryTab: "おすすめ" };

/* ---------- DOMヘルパー(textContentベース。innerHTMLは使わない) ---------- */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

function safeCost(p) { try { return Money.realCost(p.purchase); } catch { return null; } }
function estOf(p) {
  const v = p.market && p.market.estimatedValue;
  return v === null || v === undefined || v === "" ? null : Number(v);
}
/** 含み損益。データが壊れていても例外にせず null(画面全体を道連れにしない) */
function safeUnrealized(p) {
  const est = estOf(p);
  if (est === null) return null;
  try {
    return Money.unrealizedPnL(est, p.purchase);
  } catch {
    return null;
  }
}
function pnlClass(n) { return n > 0 ? "pos" : n < 0 ? "neg" : ""; }
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function badge(status) { return el("span", { class: `badge st-${status}` }, status); }

/* ---------- 線の絵(SVG。createElementNSで組む。innerHTMLは使わない) ---------- */
const ICONS = {
  box: ["M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z", "M3.5 7.5 12 12l8.5-4.5", "M12 12v9"],
  sell: ["M12 3v12", "M7.5 10.5 12 15l4.5-4.5", "M4 17v2.5h16V17"],
  ticket: ["M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z", "M9.5 12h5"],
};
function svgIcon(name) {
  const ns = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(ns, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  for (const d of ICONS[name] || []) {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    s.append(p);
  }
  return s;
}

/** 大きく見せる金額。「円」だけ小さくする */
function bigYen(n, signed = false) {
  const s = signed ? Money.fmtSigned(n) : Money.fmt(n);
  if (s === "—" || !s.endsWith("円")) return s;
  return [s.slice(0, -1), el("span", { class: "yen" }, "円")];
}

/* ---------- カードの絵(名前から色を決めて描く。実在のカードの絵は使わない) ---------- */
function hueOf(text) {
  let h = 0;
  for (const ch of String(text || "")) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % 360;
}
function cardArt(p, opts = {}) {
  const name = String(p.name || "?");
  const initial = [...name.replace(/[\s　【】\[\]()（）「」]/g, "")].slice(0, 2).join("") || "?";
  const cls = `card-art${opts.foil ? " foil" : ""}${opts.muted ? " muted" : ""}`;
  return el("div", { class: cls, style: `--h:${hueOf(name)}`, "aria-hidden": "true" },
    el("div", { class: "art-frame" },
      el("div", { class: "art-series" }, p.series || state.settings.mainTcg || "TCG"),
      el("div", { class: "art-window" }, el("span", { class: "art-initial" }, initial)),
      el("div", { class: "art-name" }, name)));
}
const SOLD_STATUSES = ["売却済み", "入金済み"];
function soldProfit(p) {
  if (!p.sale) return null;
  try { return Money.realizedProfit(p.sale, p.purchase); } catch { return null; }
}
/** 商品1つを、カードの絵つきの札にする(一覧とホームで同じ形) */
function productTile(p, onclick) {
  const cost = safeCost(p);
  const est = estOf(p);
  const u = safeUnrealized(p);
  const sold = SOLD_STATUSES.includes(p.status);
  const ended = ["返品", "キャンセル"].includes(p.status);
  let k, value, sub, subCls = "";
  if (sold) {
    const profit = soldProfit(p);
    k = "売却額";
    value = p.sale ? Money.fmt(p.sale.grossAmount) : "—";
    sub = profit === null ? "利益 —" : `利益 ${Money.fmtSigned(profit)}`;
    subCls = profit === null ? "" : pnlClass(profit);
  } else if (est !== null) {
    k = "推定の相場";
    value = Money.fmt(est);
    const pct = u !== null && cost > 0 ? Money.roi(u, cost) : null;
    sub = u === null ? "含み損益 —" : `${Money.fmtSigned(u)}${pct !== null ? `(${pct > 0 ? "+" : ""}${pct}%)` : ""}`;
    subCls = u === null ? "" : pnlClass(u);
  } else {
    k = "購入額";
    value = Money.fmt(cost);
    sub = "相場はまだ";
  }
  return el("div", { class: "prod-tile", onclick, role: "button", tabindex: "0", "aria-label": `${p.name} ${p.status}` },
    el("div", { class: "tile-art-wrap" },
      cardArt(p, { foil: !sold && u !== null && u > 0, muted: ended }),
      badge(p.status),
      p.quantity > 1 ? el("span", { class: "tile-qty" }, `×${p.quantity}`) : null),
    el("div", { class: "tile-name" }, p.name),
    el("div", { class: "tile-k" }, k),
    el("div", { class: "tile-value" }, value),
    el("div", { class: `tile-sub ${subCls}` }, sub));
}

/* ---------- 無料の約束・書き出しの見守り・ホーム画面に置く手順 ---------- */
const FREE_PROMISE = "自分の記録を見る・書き出すのは、ずっと無料。ほかの機能も、今は無料です。";
const EXPORT_REMIND_DAYS = 7;
function isStandalone() {
  try {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  } catch { return false; }
}
/** isoの日時から今日まで何日たったか(不正な値は null) */
function daysSince(iso, now = new Date()) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86400000));
}

/* ---------- 保存 + 監査 + 再描画 ---------- */
function commit(auditAction, entityType, entityId, detail) {
  Store.audit(state, auditAction, entityType, entityId, detail);
  const ok = Store.save(state);
  if (!ok) alert("保存に失敗しました。ブラウザの空き容量を確認してください。");
  renderAll();
  return ok;
}

/* ---------- モーダル ---------- */
const modalRoot = document.getElementById("modal-root");
const modalStack = [];
let skipNextPop = 0;

/** モーダル内のフォームに入力途中の変更があるか(閉じる前の破棄確認に使う) */
function isDirty(backdrop) {
  for (const i of backdrop.querySelectorAll("input, textarea")) {
    if (i.type === "file") continue;
    if (i.type === "checkbox") {
      if (i.checked !== i.defaultChecked) return true;
    } else if (i.value !== i.defaultValue) return true;
  }
  return false;
}

function openModal(title, bodyNodes) {
  const body = el("div", {}, ...[].concat(bodyNodes));
  const closeBtn = el("button", { class: "icon-btn", "aria-label": "閉じる", onclick: () => requestClose() }, "✕");
  const modal = el("div", { class: "modal", role: "dialog", "aria-label": title },
    el("div", { class: "modal-head" }, el("div", { class: "modal-title" }, title), closeBtn),
    body
  );
  const backdrop = el("div", { class: "modal-backdrop" }, modal);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) requestClose(backdrop); });
  modalRoot.append(backdrop);
  modalStack.push(backdrop);
  history.pushState({ modal: modalStack.length }, ""); // 戻る操作=モーダルを閉じる(PWAで戻るによる離脱を防ぐ)
  return { close: () => closeModal(backdrop), body };
}

/** ユーザー操作による閉じる(✕・背景タップ・Escape)。入力途中なら確認する。 */
function requestClose(target) {
  const backdrop = target || modalStack[modalStack.length - 1];
  if (!backdrop) return;
  if (isDirty(backdrop) && !confirm("入力内容を破棄しますか?")) return;
  closeModal(backdrop);
}

/** プログラムによる閉じる(保存成功後など。確認なし) */
function closeModal(target) {
  const backdrop = target || modalStack[modalStack.length - 1];
  if (!backdrop) return;
  const i = modalStack.indexOf(backdrop);
  if (i >= 0) modalStack.splice(i, 1);
  backdrop.remove();
  skipNextPop++;
  history.back(); // openModalで積んだ履歴を巻き戻す
}
function closeAllModals() { while (modalStack.length) closeModal(); }

addEventListener("popstate", () => {
  if (skipNextPop > 0) { skipNextPop--; return; }
  if (!modalStack.length) return;
  const top = modalStack[modalStack.length - 1];
  if (isDirty(top) && !confirm("入力内容を破棄しますか?")) {
    history.pushState({ modal: modalStack.length }, ""); // 破棄しない場合は履歴を積み直す
    return;
  }
  modalStack.pop();
  top.remove();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") requestClose(); });

// role="button"を持つカード(div)をEnter/Spaceでも作動させる(キーボード操作 §26.4)
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const t = e.target;
  if (t instanceof HTMLElement && t.getAttribute("role") === "button" && t.tagName !== "BUTTON" && t.tagName !== "A") {
    e.preventDefault();
    t.click();
  }
});

/* ---------- トースト(登録完了の即時フィードバック) ----------
 * 支援技術で確実に通知されるよう、常設のaria-live領域(index.htmlの#toast)の
 * textContentを差し替える方式にする(内容入り動的挿入は通知されない環境がある)。 */
let toastTimer = null;
function showToast(message) {
  const t = document.getElementById("toast");
  if (!t) return;
  if (toastTimer) clearTimeout(toastTimer);
  t.textContent = message;
  t.hidden = false;
  t.classList.remove("toast-anim");
  void t.offsetWidth; // アニメーションを再生し直すためのreflow
  t.classList.add("toast-anim");
  toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
}
document.getElementById("toast").addEventListener("click", () => {
  document.getElementById("toast").hidden = true;
});

/* ---------- フォーム部品 ---------- */
function field(labelText, inputEl, span2) {
  return el("div", { class: `field${span2 ? " span2" : ""}` }, el("label", {}, labelText), inputEl);
}
function textInput(name, value, opts = {}) {
  return el("input", { type: opts.type || "text", name, value: value ?? "", placeholder: opts.placeholder || "", inputmode: opts.inputmode });
}
function yenInput(name, value, placeholder = "0") {
  return el("input", { type: "text", name, value: value ?? "", placeholder, inputmode: "numeric", autocomplete: "off" });
}
function readYen(form, name, label) { return Money.yen(form.elements[name].value, label); }

/* ==========================================================
   ホーム
========================================================== */
function renderHome() {
  const root = document.getElementById("view-home");
  clear(root);
  const now = new Date();
  const h = now.getHours();
  const greet = h < 5 ? "こんばんは" : h < 11 ? "おはようございます" : h < 18 ? "こんにちは" : "こんばんは";
  const wd = "日月火水木金土"[now.getDay()];
  root.append(el("div", { class: "greeting" },
    el("span", { class: "greet-sub" }, `${now.getMonth() + 1}月${now.getDate()}日(${wd})`), greet));

  // コレクション評価額(ホームの大きな札)
  const s = Fin.computeSummary(state.products, state.settings, now);
  root.append(renderHero(s));
  root.append(renderKeepCard(now));

  // 今日やること
  const todos = Fin.buildTodos(state.products, state.lotteries, state.settings, now);
  root.append(el("h2", { class: "section" }, "今日やること", el("span", { class: "count" }, `${todos.length}件`)));
  if (todos.length === 0) {
    root.append(el("div", { class: "empty-note" }, "今日、期限が来るものはありません"));
  }
  for (const t of todos) {
    let tag, tagClass = "", sub = "", onclick;
    if (t.kind === "lottery-deadline") {
      tag = Fin.remainLabel(t.remain); tagClass = t.remain < 6 * 3600e3 ? "urgent" : "";
      sub = `応募締切 ${fmtDateTime(new Date(t.deadline).toISOString())}`;
      onclick = () => { switchView("lottery"); openLotteryDetail(t.id); };
    } else if (t.kind === "purchase-deadline") {
      tag = t.remain < 0 ? "期限切れ" : Fin.remainLabel(t.remain); tagClass = "urgent";
      sub = `購入期限 ${fmtDateTime(new Date(t.deadline).toISOString())}`;
      onclick = () => { switchView("lottery"); openLotteryDetail(t.id); };
    } else if (t.kind === "result-check") {
      tag = "当落確認"; sub = "結果発表日を過ぎています";
      onclick = () => { switchView("lottery"); openLotteryDetail(t.id); };
    } else if (t.kind === "payment-due") {
      tag = t.remain < 0 ? "支払期限切れ" : Fin.remainLabel(t.remain); tagClass = "urgent";
      sub = "支払予定";
      onclick = () => { switchView("products"); openProductDetail(t.id); };
    } else {
      tag = "売却候補"; tagClass = "gold";
      sub = `含み益 ${Money.fmtSigned(t.profit)}(参考)`;
      onclick = () => { switchView("products"); openProductDetail(t.id); };
    }
    root.append(el("div", { class: "card clickable todo-card", onclick, role: "button", tabindex: "0" },
      el("span", { class: `todo-tag ${tagClass}` }, tag),
      el("div", { class: "todo-body" },
        el("div", { class: "todo-title" }, t.title),
        el("div", { class: "todo-sub" }, sub))
    ));
  }

  // 値動きの大きい商品(含み損益の大きい順・上位6。横に流して見る)
  const notable = state.products
    .filter((p) => ["保有中", "出品中", "到着待ち"].includes(p.status) && estOf(p) !== null)
    .map((p) => ({ p, u: safeUnrealized(p) }))
    .filter((x) => x.u !== null)
    .sort((a, b) => Math.abs(b.u) - Math.abs(a.u))
    .slice(0, 6);
  if (notable.length) {
    root.append(el("h2", { class: "section" }, "値動きの大きい商品"));
    root.append(el("div", { class: "tile-row" },
      ...notable.map(({ p }) => productTile(p, () => { switchView("products"); openProductDetail(p.id); }))));
  }

  // 最近の変化(監査ログ末尾3件)
  const recent = state.auditLog.slice(-3).reverse();
  if (recent.length) {
    root.append(el("h2", { class: "section" }, "最近の変化"));
    const ul = el("ul", { class: "history-list" });
    for (const a of recent) ul.append(el("li", {}, `${fmtDateTime(a.at)} ${a.detail || a.action}`));
    root.append(el("div", { class: "card" }, ul));
  }
}

/** ホームの大きな札: 持っている物の評価額・含み損益・今月の仕入・確定利益・今後払う金額 */
function renderHero(s) {
  const activeCount = state.products.filter((p) => ["到着待ち", "保有中", "出品中"].includes(p.status)).length;
  const hasEstimate = s.unrealizedCount > 0;
  const stat = (k, v, cls = "") => el("div", { class: "hero-stat" }, el("div", { class: "k" }, k), el("div", { class: `v ${cls}` }, v));
  return el("section", { class: "hero", "aria-label": "コレクション評価額" },
    el("div", { class: "hero-top" },
      el("span", { class: "hero-label" }, "コレクション評価額"),
      el("span", { class: "hero-chip" }, `${activeCount}点`)),
    el("div", { class: "hero-value" }, bigYen(s.estimatedValue)),
    el("div", { class: `hero-delta ${hasEstimate ? pnlClass(s.unrealized) : ""}` },
      activeCount === 0 ? "右下の＋から、最初の1点を登録" :
        hasEstimate ? `含み損益 ${Money.fmtSigned(s.unrealized)}` : "相場を入れると、含み損益が出ます"),
    s.estimateMissing > 0 ? el("div", { class: "hero-note" }, `相場をまだ入れていない${s.estimateMissing}件は、買った値段で数えています`) : null,
    el("div", { class: "hero-stats" },
      stat("今月の仕入", Money.fmt(s.monthSpend)),
      stat("確定利益", Money.fmtSigned(s.realizedProfit), pnlClass(s.realizedProfit)),
      stat("今後払う", Money.fmt(s.pendingPayment))));
}

/** ホームの一番上: 無料の約束・最後の書き出し・書き出す/読み戻す・ホーム画面に置く手順 */
function renderKeepCard(now) {
  const last = state.settings.lastExportAt || null;
  const days = daysSince(last, now);
  const hasData = state.products.length > 0 || state.lotteries.length > 0;
  let statusText, warn = false;
  if (days === null) {
    statusText = hasData ? "まだ一度も書き出していません" : "まだ記録はありません";
    warn = hasData;
  } else {
    statusText = `最後の書き出し: ${fmtDate(last)}(${days === 0 ? "今日" : `${days}日前`})`;
    warn = hasData && days >= EXPORT_REMIND_DAYS;
  }
  return el("div", { class: "card keep-card" },
    el("div", { class: "promise" }, FREE_PROMISE),
    el("div", { class: `keep-status${warn ? " warn" : ""}` }, statusText),
    el("div", { class: "form-note" }, "記録はこのスマホ(この端末のブラウザ)の中だけにあります。会員登録はありません。時々「書き出す」で、ファイルに保存してください。"),
    el("div", { class: "btn-row" },
      el("button", { class: "btn small", onclick: downloadJson }, "書き出す"),
      el("button", { class: "btn small", onclick: pickRestoreFile }, "読み戻す"),
      isStandalone() ? null : el("button", { class: "btn small", onclick: openInstallGuide }, "ホーム画面に置く手順")));
}

function openInstallGuide() {
  const ol = (...items) => el("ol", { class: "steps" }, ...items.map((t) => el("li", {}, t)));
  openModal("ホーム画面に置く手順", [
    el("div", { class: "form-note" }, "ホーム画面に置くと、アイコンからアプリのように開けます。お金はかかりません。"),
    el("h2", { class: "section" }, "iPhone"),
    ol("このページを Safari で開く(LINE や X の中で開いた時は、「Safari で開く」を選んで開き直す)",
      "共有ボタン(四角から上に矢印が出ている印)を押す。見当たらない時は、右下の「…」の中にあります",
      "「ホーム画面に追加」を選び、「追加」を押す"),
    el("h2", { class: "section" }, "Android"),
    ol("このページを Chrome で開く(LINE や X の中で開いた時は、「ブラウザで開く」を選ぶ)",
      "右上の「︙」を押す",
      "「ホーム画面に追加」か「アプリをインストール」を選ぶ"),
    el("div", { class: "ai-note" }, "Safari のタブで開いたまま何日も使わないと、記録が消えることがあります。ホーム画面に置いて使い、時々「書き出す」で保存してください。LINE や X の中で入れた記録は、Safari や Chrome とは別の場所に保存されます。"),
  ]);
}

function moneySummaryGrid(s, detail) {
  const cells = [
    ["今月使った金額", Money.fmt(s.monthSpend), "", "注文日ベース"],
    ["今後払う金額", Money.fmt(s.pendingPayment), s.pendingPayment > 0 ? "neg" : "", "未払いの仕入"],
    ["保有商品の推定価値", Money.fmt(s.estimatedValue), "gold", s.estimateMissing > 0 ? `相場未入力${s.estimateMissing}件は購入額で計算` : "相場入力済み"],
    ["確定利益", Money.fmtSigned(s.realizedProfit), pnlClass(s.realizedProfit), state.settings.strictPayout ? "入金済みのみ" : "売却登録済み含む"],
  ];
  const grid = el("div", { class: "money-grid" });
  for (const [label, value, cls, note] of cells) {
    grid.append(el("div", { class: "money-cell" },
      el("div", { class: "label" }, label),
      el("div", { class: `value ${cls}` }, value),
      note ? el("div", { class: "note" }, note) : null
    ));
  }
  return grid;
}

/* ==========================================================
   商品
========================================================== */
const PRODUCT_TABS = ["すべて", "到着待ち", "保有中", "出品中", "売却済み"];

function renderProducts() {
  const root = document.getElementById("view-products");
  clear(root);
  const tabs = el("div", { class: "tabs", role: "tablist" });
  for (const t of PRODUCT_TABS) {
    tabs.append(el("button", {
      class: "tab", role: "tab", "aria-selected": String(route.productTab === t),
      onclick: () => { route.productTab = t; renderProducts(); },
    }, t));
  }
  root.append(tabs);

  const list = state.products
    .filter(Life.productTabFilter(route.productTab))
    .sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));

  if (list.length === 0) {
    root.append(el("div", { class: "empty-note" },
      route.productTab === "すべて" ? "まだ商品がありません。右下の「＋」から登録できます。" : `「${route.productTab}」の商品はありません。`));
    return;
  }

  root.append(el("div", { class: "prod-grid" },
    ...list.map((p) => productTile(p, () => openProductDetail(p.id)))));
}
function kv(k, v, vClass = "") {
  return el("div", { class: "kv-row" }, el("span", { class: "k" }, k), el("span", { class: `v ${vClass}` }, v));
}

function openProductDetail(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  const cost = safeCost(p);
  const est = estOf(p);
  const u = safeUnrealized(p);
  const body = [];

  body.push(el("div", { class: "detail-art" },
    cardArt(p, { foil: !SOLD_STATUSES.includes(p.status) && u !== null && u > 0, muted: ["返品", "キャンセル"].includes(p.status) })));
  body.push(el("div", { class: "prod-head" },
    el("div", {},
      p.series ? el("div", { class: "prod-series" }, p.series) : null,
      el("div", { class: "prod-name", style: "font-size:17px" }, p.name)),
    badge(p.status)));

  // 金額サマリー
  const grid = el("div", { class: "money-grid", style: "margin-top:12px" });
  const cell = (label, value, cls) => el("div", { class: "money-cell" },
    el("div", { class: "label" }, label), el("div", { class: `value ${cls || ""}` }, value));
  if (p.status === "売却済み" || p.status === "入金済み") {
    const net = p.sale ? (() => { try { return Money.saleNet(p.sale); } catch { return null; } })() : null;
    const profit = p.sale && cost !== null && net !== null ? net - cost : null;
    grid.append(
      cell("実質原価", Money.fmt(cost)),
      cell("売却手取り", Money.fmt(net)),
      cell("実質利益", Money.fmtSigned(profit), pnlClass(profit ?? 0)),
      cell("ROI", profit !== null && cost > 0 ? `${Money.roi(profit, cost)}%` : "—"),
    );
  } else {
    grid.append(
      cell("実質原価", Money.fmt(cost)),
      cell("現在推定相場", est !== null ? Money.fmt(est) : "未入力", "gold"),
      cell("含み損益", Money.fmtSigned(u), u === null ? "" : pnlClass(u)),
      cell("支払状況", p.purchase?.paymentStatus === "paid" ? "支払済み" : "未払い", p.purchase?.paymentStatus === "paid" ? "" : "neg"),
    );
  }
  body.push(grid);

  // アクション
  const actions = el("div", { class: "btn-row" });
  if (["保有中", "出品中"].includes(p.status)) {
    actions.append(el("button", { class: "btn primary", onclick: () => openSimulation(p) }, "今売ったら？(利益を計算)"));
    actions.append(el("button", { class: "btn", onclick: () => openEstimateForm(p) }, "相場を更新"));
  }
  if (p.status === "到着待ち") {
    actions.append(el("button", { class: "btn", onclick: () => openEstimateForm(p) }, "相場を更新"));
  }
  if (p.purchase && p.purchase.paymentStatus !== "paid" && !["キャンセル", "返品"].includes(p.status)) {
    actions.append(el("button", { class: "btn", onclick: () => {
      p.purchase.paymentStatus = "paid";
      p.purchase.paidAt = new Date().toISOString();
      p.updatedAt = new Date().toISOString();
      commit("payment-paid", "product", p.id, `${p.name} を支払済みにした`);
      closeAllModals(); openProductDetail(p.id);
    } }, "支払済みにする"));
  }
  for (const to of Life.PRODUCT_TRANSITIONS[p.status] || []) {
    const label = Life.PRODUCT_ACTION_LABELS[`${p.status}>${to}`] || to;
    if (to === "売却済み") {
      actions.append(el("button", { class: "btn primary", onclick: () => openSaleForm(p) }, label));
      continue;
    }
    const destructive = ["キャンセル", "返品"].includes(to) || (to === "保有中" && ["売却済み", "入金済み"].includes(p.status));
    actions.append(el("button", { class: `btn${destructive ? " danger" : ""}`, onclick: () => {
      if (destructive && !confirm(`「${label}」を実行しますか?`)) return;
      try {
        const next = Life.applyProductTransition(p, to, label, new Date().toISOString());
        state.products = state.products.map((x) => (x.id === p.id ? next : x));
        commit("transition", "product", p.id, `${p.name}: ${p.status} → ${to}`);
        closeAllModals(); openProductDetail(p.id);
      } catch (e) { alert(e.message); }
    } }, label));
  }
  actions.append(el("button", { class: "btn", onclick: () => openProductForm(p) }, "情報を編集"));
  body.push(actions);

  // 購入・原価
  body.push(el("h2", { class: "section" }, "購入・原価"));
  const pu = p.purchase || {};
  const dt = el("table", { class: "detail-table" });
  const row = (k, v) => dt.append(el("tr", {}, el("td", {}, k), el("td", {}, v)));
  row("購入先", pu.store || "—");
  row("注文番号", pu.orderNumber || "—");
  row("購入日", fmtDate(pu.orderedAt));
  row("商品購入額", Money.fmt(pu.itemPrice ? Number(pu.itemPrice) : 0));
  if (pu.shippingFee) row("購入送料", Money.fmt(Number(pu.shippingFee)));
  if (pu.paymentFee) row("決済手数料", Money.fmt(Number(pu.paymentFee)));
  if (pu.gradingFee) row("鑑定費", Money.fmt(Number(pu.gradingFee)));
  if (pu.otherFee) row("その他費用", Money.fmt(Number(pu.otherFee)));
  if (pu.discount) row("値引き", `-${Money.fmt(Number(pu.discount))}`);
  if (pu.pointsUsed) row("ポイント利用", `-${Money.fmt(Number(pu.pointsUsed))}`);
  row("実質原価", Money.fmt(cost));
  row("支払状況", pu.paymentStatus === "paid" ? "支払済み" : `未払い${pu.paymentDueAt ? `(期限 ${fmtDate(pu.paymentDueAt)})` : ""}`);
  body.push(dt);

  // 相場
  if (p.market && (est !== null || p.market.updatedAt)) {
    body.push(el("h2", { class: "section" }, "現在相場(手入力)"));
    const mt = el("table", { class: "detail-table" });
    const mrow = (k, v) => mt.append(el("tr", {}, el("td", {}, k), el("td", {}, v)));
    mrow("推定相場", est !== null ? Money.fmt(est) : "—");
    if (p.market.low || p.market.high) mrow("参考範囲", `${Money.fmt(p.market.low ? Number(p.market.low) : null)} 〜 ${Money.fmt(p.market.high ? Number(p.market.high) : null)}`);
    mrow("最終更新", p.market.updatedAt ? fmtDateTime(p.market.updatedAt) : "—");
    if (p.market.sourceNote) mrow("情報源メモ", p.market.sourceNote);
    body.push(mt);
  }

  // 売却情報
  if (p.sale) {
    body.push(el("h2", { class: "section" }, "売却"));
    const st = el("table", { class: "detail-table" });
    const srow = (k, v) => st.append(el("tr", {}, el("td", {}, k), el("td", {}, v)));
    srow("販売先", p.sale.channel || "—");
    srow("売却日", fmtDate(p.soldAt || p.sale.soldAt));
    srow("売却額", Money.fmt(p.sale.grossAmount ? Number(p.sale.grossAmount) : 0));
    srow("販売手数料", Money.fmt(p.sale.platformFee ? Number(p.sale.platformFee) : 0));
    srow("販売送料", Money.fmt(p.sale.shippingFee ? Number(p.sale.shippingFee) : 0));
    if (p.sale.packingFee) srow("梱包費", Money.fmt(Number(p.sale.packingFee)));
    if (p.sale.payoutFee) srow("振込手数料", Money.fmt(Number(p.sale.payoutFee)));
    srow("入金状況", p.sale.paymentStatus === "paid" ? "入金済み" : "未入金");
    body.push(st);
  }

  // 保管・メモ
  if (p.storageLocation || p.note || p.condition) {
    body.push(el("h2", { class: "section" }, "保管・メモ"));
    const gt = el("table", { class: "detail-table" });
    if (p.condition) gt.append(el("tr", {}, el("td", {}, "状態"), el("td", {}, p.condition)));
    if (p.storageLocation) gt.append(el("tr", {}, el("td", {}, "保管場所"), el("td", {}, p.storageLocation)));
    if (p.note) gt.append(el("tr", {}, el("td", {}, "メモ"), el("td", {}, p.note)));
    body.push(gt);
  }

  // 履歴
  if (p.history && p.history.length) {
    body.push(el("h2", { class: "section" }, "履歴"));
    const ul = el("ul", { class: "history-list" });
    for (const h of [...p.history].reverse()) {
      ul.append(el("li", {}, `${fmtDateTime(h.at)} ${h.from} → ${h.to}${h.note ? `(${h.note})` : ""}`));
    }
    body.push(ul);
  }

  // 削除
  body.push(el("div", { class: "btn-row", style: "margin-top:16px" },
    el("button", { class: "btn danger small", onclick: () => {
      if (!confirm(`「${p.name}」を完全に削除しますか?\n金額集計からも除外されます。この操作は取り消せません。`)) return;
      state.products = state.products.filter((x) => x.id !== p.id);
      commit("delete", "product", p.id, `${p.name} を削除した`);
      closeAllModals();
    } }, "この商品を削除")));

  openModal("商品詳細", body);
}

/* ---------- 商品フォーム(登録/編集) ---------- */
function openProductForm(existing, prefill, onSaved) {
  const p = existing || null;
  const pre = prefill || {};
  const pu = (p && p.purchase) || {};
  const form = el("form", { novalidate: true });
  const err = el("div", { class: "form-error", role: "alert" });
  const costPreview = el("div", { class: "form-note" });

  const nameIn = textInput("name", p ? p.name : pre.name || "", { placeholder: "例: ONE PIECE 4th Anniversary Set" });
  const seriesIn = textInput("series", p ? p.series : pre.series || "", { placeholder: "例: OP-17 / ポケモン151" });
  const qtyIn = el("input", { type: "number", name: "quantity", min: "1", step: "1", value: p ? p.quantity || 1 : 1 });
  const statusSel = el("select", { name: "status" },
    el("option", { value: "到着待ち" }, "到着待ち(未着)"),
    el("option", { value: "保有中" }, "保有中(手元にある)"));
  if (p) statusSel.value = ["到着待ち"].includes(p.status) ? "到着待ち" : "保有中";
  const storeIn = textInput("store", pu.store || pre.store || "", { placeholder: "例: 楽天ブックス / カードショップ" });
  const orderNoIn = textInput("orderNumber", pu.orderNumber || "", {});
  const orderedIn = el("input", { type: "date", name: "orderedAt", value: (pu.orderedAt || todayStr()).slice(0, 10) });
  const priceIn = yenInput("itemPrice", pu.itemPrice ?? pre.itemPrice ?? "");
  const shipIn = yenInput("shippingFee", pu.shippingFee ?? "");
  const payFeeIn = yenInput("paymentFee", pu.paymentFee ?? "");
  const gradeIn = yenInput("gradingFee", pu.gradingFee ?? "");
  const otherIn = yenInput("otherFee", pu.otherFee ?? "");
  const discIn = yenInput("discount", pu.discount ?? "");
  const pointIn = yenInput("pointsUsed", pu.pointsUsed ?? "");
  const paidSel = el("select", { name: "paymentStatus" },
    el("option", { value: "paid" }, "支払済み"),
    el("option", { value: "unpaid" }, "未払い(支払予定)"));
  paidSel.value = pu.paymentStatus || "paid";
  const dueIn = el("input", { type: "date", name: "paymentDueAt", value: pu.paymentDueAt ? pu.paymentDueAt.slice(0, 10) : "" });
  const condIn = textInput("condition", p ? p.condition : "未開封", {});
  const locIn = textInput("storageLocation", p ? p.storageLocation : "", { placeholder: "例: 防湿庫A / 押入れ" });
  const noteIn = el("textarea", { name: "note", rows: "2" }, p ? p.note || "" : "");

  const updatePreview = () => {
    try {
      const c = Money.realCost({
        itemPrice: priceIn.value, shippingFee: shipIn.value, paymentFee: payFeeIn.value,
        gradingFee: gradeIn.value, otherFee: otherIn.value, discount: discIn.value, pointsUsed: pointIn.value,
      });
      costPreview.textContent = `実質原価: ${Money.fmt(c)}`;
      err.textContent = "";
    } catch (e) { costPreview.textContent = ""; err.textContent = e.message; }
  };
  for (const i of [priceIn, shipIn, payFeeIn, gradeIn, otherIn, discIn, pointIn]) i.addEventListener("input", updatePreview);
  updatePreview();

  // 「前回と同じ」プリフィル: 新規登録時のみ、記憶済みの購入先/シリーズ/送料/決済手数料を明示タップで適用
  const lastDef = !p && !pre.lotteryId && state.settings.lastPurchaseDefaults &&
    (state.settings.lastPurchaseDefaults.store || state.settings.lastPurchaseDefaults.series)
    ? state.settings.lastPurchaseDefaults : null;
  let prefillChip = null;
  if (lastDef) {
    const parts = [
      lastDef.store || null,
      lastDef.series || null,
      `送料${(lastDef.shippingFee || 0).toLocaleString("ja-JP")}円`,
      lastDef.paymentFee ? `決済手数料${lastDef.paymentFee.toLocaleString("ja-JP")}円` : null,
    ].filter(Boolean).join(" / ");
    prefillChip = el("div", { class: "prefill-chip" },
      el("span", { class: "prefill-label" }, `前回と同じ: ${parts}`),
      el("button", { class: "btn small", type: "button", onclick: () => {
        storeIn.value = lastDef.store || "";
        seriesIn.value = lastDef.series || "";
        shipIn.value = lastDef.shippingFee ? String(lastDef.shippingFee) : "";
        payFeeIn.value = lastDef.paymentFee ? String(lastDef.paymentFee) : "";
        updatePreview();
      } }, "適用"));
  }

  if (prefillChip) form.append(prefillChip); // 注意: ネイティブappendはnullを文字列化するため条件付きで追加
  form.append(
    field("商品名 *", nameIn, true),
    el("div", { class: "form-grid" },
      field("シリーズ", seriesIn),
      field("数量", qtyIn),
      p ? el("div") : field("いまの状態", statusSel),
      field("購入先", storeIn),
      field("購入日", orderedIn),
      field("注文番号", orderNoIn),
      field("商品金額(合計) *", priceIn),
      field("購入送料", shipIn),
      field("決済手数料", payFeeIn),
      field("鑑定費", gradeIn),
      field("値引き", discIn),
      field("ポイント利用", pointIn),
      field("その他費用", otherIn),
      field("支払状況", paidSel),
      field("支払予定日(未払い時)", dueIn),
      field("商品状態", condIn),
      field("保管場所", locIn),
    ),
    field("メモ", noteIn, true),
    costPreview, err,
    el("button", { class: "btn primary block", type: "submit" }, p ? "保存する" : "この内容で登録")
  );

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      const name = nameIn.value.trim();
      if (!name) throw new Error("商品名を入力してください");
      if (priceIn.value.trim() === "") throw new Error("商品金額(合計)を入力してください(無料の場合は0)");
      const qty = Math.max(1, Math.trunc(Number(qtyIn.value) || 1));
      const purchase = {
        store: storeIn.value.trim(),
        orderNumber: orderNoIn.value.trim(),
        orderedAt: orderedIn.value || todayStr(),
        itemPrice: readYen(form, "itemPrice", "商品金額"),
        shippingFee: readYen(form, "shippingFee", "購入送料"),
        paymentFee: readYen(form, "paymentFee", "決済手数料"),
        gradingFee: readYen(form, "gradingFee", "鑑定費"),
        otherFee: readYen(form, "otherFee", "その他費用"),
        discount: readYen(form, "discount", "値引き"),
        pointsUsed: readYen(form, "pointsUsed", "ポイント利用"),
        paymentStatus: paidSel.value,
        paymentDueAt: paidSel.value === "unpaid" && dueIn.value ? dueIn.value : null,
        paidAt: paidSel.value === "paid" ? (pu.paidAt || new Date().toISOString()) : null,
      };
      Money.realCost(purchase); // 妥当性チェック(負の原価などを拒否)
      const nowIso = new Date().toISOString();
      if (p) {
        p.name = name; p.series = seriesIn.value.trim(); p.quantity = qty;
        p.condition = condIn.value.trim(); p.storageLocation = locIn.value.trim(); p.note = noteIn.value.trim();
        p.purchase = purchase; p.updatedAt = nowIso;
        commit("update", "product", p.id, `${name} の情報を編集した`);
        closeAllModals(); openProductDetail(p.id);
      } else {
        const product = {
          id: Store.newId("prod"),
          name, series: seriesIn.value.trim(), quantity: qty,
          status: statusSel.value,
          condition: condIn.value.trim(), storageLocation: locIn.value.trim(), note: noteIn.value.trim(),
          purchase, market: {}, sale: null,
          lotteryId: pre.lotteryId || null,
          history: [{ at: nowIso, from: "(登録)", to: statusSel.value, note: "" }],
          createdAt: nowIso, updatedAt: nowIso,
          receivedAt: statusSel.value === "保有中" ? nowIso : null,
        };
        state.products.push(product);
        Store.rememberPurchaseDefaults(state.settings, product);
        const ok = commit("create", "product", product.id, `${name} を登録した(${Money.fmt(Money.realCost(purchase))})`);
        if (!ok) {
          // 保存できなかったものを成功として見せない: メモリからも巻き戻し、入力を保持したまま再試行できるようにする
          state.products.pop();
          state.auditLog.pop();
          renderAll();
          err.textContent = "保存に失敗しました。設定→バックアップJSONで退避し、ブラウザの空き容量を確保してから再試行してください。";
          return;
        }
        closeAllModals();
        const summary = Fin.computeSummary(state.products, state.settings, new Date());
        showToast(`「${name}」を登録しました — ${Fin.registerFeedback(Money.realCost(purchase), summary)}`);
        if (onSaved) onSaved(product);
      }
    } catch (ex) { err.textContent = ex.message; }
  });

  openModal(p ? "商品を編集" : "商品を登録(手入力)", [form]);
}

/* ---------- 相場更新 ---------- */
function openEstimateForm(p) {
  const form = el("form", { novalidate: true });
  const err = el("div", { class: "form-error", role: "alert" });
  const estIn = yenInput("est", estOf(p) ?? "");
  const lowIn = yenInput("low", p.market?.low ?? "");
  const highIn = yenInput("high", p.market?.high ?? "");
  const srcIn = textInput("src", p.market?.sourceNote || "", { placeholder: "例: メルカリ成約 3件平均" });
  form.append(
    el("div", { class: "form-note" }, "フリマの成約価格など、実際に売れた価格を基準に入力するのがおすすめです。"),
    field("現在推定相場 *", estIn, true),
    el("div", { class: "form-grid" }, field("参考範囲(下限)", lowIn), field("参考範囲(上限)", highIn)),
    field("情報源メモ", srcIn, true),
    err,
    el("button", { class: "btn primary block", type: "submit" }, "相場を更新")
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      if (estIn.value.trim() === "") throw new Error("現在推定相場を入力してください");
      const est = Money.yen(estIn.value, "推定相場");
      const low = lowIn.value ? Money.yen(lowIn.value, "下限") : null;
      const high = highIn.value ? Money.yen(highIn.value, "上限") : null;
      if (low !== null && high !== null && low > high) throw new Error("下限が上限を超えています");
      p.market = { estimatedValue: est, low, high, sourceNote: srcIn.value.trim(), updatedAt: new Date().toISOString() };
      p.updatedAt = new Date().toISOString();
      commit("estimate", "product", p.id, `${p.name} の相場を ${Money.fmt(est)} に更新した`);
      closeAllModals(); openProductDetail(p.id);
    } catch (ex) { err.textContent = ex.message; }
  });
  openModal("相場を更新", [form]);
}

/* ---------- 売却シミュレーション ---------- */
function openSimulation(p) {
  const cost = safeCost(p);
  const channels = state.settings.channels || [];
  const form = el("form", { novalidate: true });
  const err = el("div", { class: "form-error", role: "alert" });
  const priceIn = yenInput("price", estOf(p) ?? "");
  const chSel = el("select", { name: "channel" }, ...channels.map((c) => el("option", { value: c.name }, `${c.name}(${c.feeRate}%)`)));
  const rateIn = el("input", { type: "number", name: "feeRate", min: "0", max: "100", step: "0.1", value: channels[0]?.feeRate ?? 10 });
  const fixedIn = yenInput("feeFixed", "");
  const shipIn = yenInput("shippingFee", "");
  const packIn = yenInput("packingFee", "");
  const payoutIn = yenInput("payoutFee", "");
  const resultBox = el("div", {});
  const compareBox = el("div", {});

  chSel.addEventListener("change", () => {
    const c = channels.find((x) => x.name === chSel.value);
    if (c) rateIn.value = c.feeRate;
    update();
  });

  function currentInput() {
    // channel は売却フォームへの引き継ぎ用(simulateSaleは未知キーを無視する)
    return { channel: chSel.value, price: priceIn.value, feeRate: rateIn.value, feeFixed: fixedIn.value, shippingFee: shipIn.value, packingFee: packIn.value, payoutFee: payoutIn.value };
  }
  function update() {
    clear(resultBox); clear(compareBox); err.textContent = "";
    let sim;
    try { sim = Money.simulateSale(currentInput(), p.purchase); }
    catch (e) { err.textContent = e.message; return; }
    const t = el("table", { class: "sim-table" });
    const r = (k, v, cls) => t.append(el("tr", {}, el("td", {}, k), el("td", { class: cls || "" }, v)));
    r("売却価格", Money.fmt(sim.price));
    r("販売手数料", `-${Money.fmt(sim.platformFee)}`);
    if (sim.shippingFee) r("送料", `-${Money.fmt(sim.shippingFee)}`);
    if (sim.packingFee) r("梱包費", `-${Money.fmt(sim.packingFee)}`);
    if (sim.payoutFee) r("振込手数料", `-${Money.fmt(sim.payoutFee)}`);
    r("商品実質原価", `-${Money.fmt(sim.cost)}`);
    const tr = el("tr", { class: "total" },
      el("td", {}, "実質利益"),
      el("td", { class: sim.profit >= 0 ? "pos" : "neg" }, `${Money.fmtSigned(sim.profit)}${sim.roi !== null ? `(${sim.roi}%)` : ""}`));
    t.append(tr);
    resultBox.append(t);

    // 販売先比較(同じ価格・送料で手数料率だけ変えた参考値)
    if (channels.length > 1) {
      compareBox.append(el("h2", { class: "section" }, "販売先比較(参考)"));
      const ct = el("table", { class: "sim-table" });
      for (const c of channels) {
        try {
          const s2 = Money.simulateSale({ ...currentInput(), feeRate: c.feeRate }, p.purchase);
          ct.append(el("tr", {},
            el("td", {}, `${c.name}(${c.feeRate}%)`),
            el("td", { class: s2.profit >= 0 ? "pos" : "neg" }, Money.fmtSigned(s2.profit))));
        } catch { /* 入力不備時はスキップ */ }
      }
      compareBox.append(ct, el("div", { class: "ai-note" }, "手数料率は設定画面で変更できます。実際の手数料・送料は販売先の最新条件を確認してください。"));
    }
  }
  for (const i of [priceIn, rateIn, fixedIn, shipIn, packIn, payoutIn]) i.addEventListener("input", update);
  update();

  form.append(
    el("div", { class: "form-note" }, `実質原価 ${Money.fmt(cost)} に対する手取りと利益を計算します。`),
    el("div", { class: "form-grid" },
      field("売却予定価格", priceIn),
      field("販売先", chSel),
      field("手数料率(%)", rateIn),
      field("固定手数料", fixedIn),
      field("送料(自己負担)", shipIn),
      field("梱包費", packIn),
      field("振込手数料", payoutIn),
    ),
    err, resultBox, compareBox,
    el("div", { class: "btn-row" },
      el("button", { class: "btn primary", type: "button", onclick: () => {
        closeModal();
        openSaleForm(p, currentInput());
      } }, "この内容で売却を登録"))
  );
  openModal("今売ったら?(売却シミュレーション)", [form]);
}

/* ---------- 売却登録 ---------- */
function openSaleForm(p, prefill) {
  if (!["保有中", "出品中"].includes(p.status)) { alert("保有中または出品中の商品のみ売却登録できます"); return; }
  const channels = state.settings.channels || [];
  const pre = prefill || {};
  const form = el("form", { novalidate: true });
  const err = el("div", { class: "form-error", role: "alert" });

  const chSel = el("select", { name: "channel" },
    ...channels.map((c) => el("option", { value: c.name }, c.name)),
    el("option", { value: "__other" }, "その他"));
  if (pre.channel && channels.some((c) => c.name === pre.channel)) chSel.value = pre.channel;
  const chOther = textInput("channelOther", "", { placeholder: "販売先名" });
  chOther.style.display = "none";
  chSel.addEventListener("change", () => {
    chOther.style.display = chSel.value === "__other" ? "" : "none";
    const c = channels.find((x) => x.name === chSel.value);
    if (c) { rateIn.value = c.feeRate; update(); }
  });

  const soldIn = el("input", { type: "date", name: "soldAt", value: todayStr() });
  const priceIn = yenInput("gross", pre.price ?? "");
  const rateIn = el("input", { type: "number", name: "feeRate", min: "0", max: "100", step: "0.1", value: pre.feeRate ?? (channels.find((c) => c.name === chSel.value)?.feeRate ?? 10) });
  const fixedIn = yenInput("feeFixed", pre.feeFixed ?? "");
  const shipIn = yenInput("shippingFee", pre.shippingFee ?? "");
  const packIn = yenInput("packingFee", pre.packingFee ?? "");
  const payoutIn = yenInput("payoutFee", pre.payoutFee ?? "");
  const paidChk = el("input", { type: "checkbox", name: "paid" });
  const resultBox = el("div", {});

  function update() {
    clear(resultBox); err.textContent = "";
    try {
      const sim = Money.simulateSale({ price: priceIn.value, feeRate: rateIn.value, feeFixed: fixedIn.value, shippingFee: shipIn.value, packingFee: packIn.value, payoutFee: payoutIn.value }, p.purchase);
      const t = el("table", { class: "sim-table" });
      t.append(el("tr", {}, el("td", {}, "手取り"), el("td", {}, Money.fmt(sim.net))));
      t.append(el("tr", { class: "total" }, el("td", {}, "実質利益"), el("td", { class: sim.profit >= 0 ? "pos" : "neg" }, Money.fmtSigned(sim.profit))));
      resultBox.append(t);
    } catch (e) { err.textContent = e.message; }
  }
  for (const i of [priceIn, rateIn, fixedIn, shipIn, packIn, payoutIn]) i.addEventListener("input", update);
  update();

  form.append(
    el("div", { class: "form-grid" },
      field("販売先", chSel),
      field("売却日", soldIn),
    ),
    field("", chOther, true),
    el("div", { class: "form-grid" },
      field("売却額 *", priceIn),
      field("手数料率(%)", rateIn),
      field("固定手数料", fixedIn),
      field("送料(自己負担)", shipIn),
      field("梱包費", packIn),
      field("振込手数料", payoutIn),
    ),
    el("div", { class: "field" }, el("label", {}, el("span", {}, "入金も完了している "), paidChk)),
    resultBox, err,
    el("button", { class: "btn primary block", type: "submit" }, "売却を登録")
  );

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      const gross = Money.yen(priceIn.value, "売却額");
      if (gross === 0 && !confirm("売却額が0円です。このまま登録しますか?")) return;
      const platformFee = Money.feeFromRate(gross, rateIn.value || 0) + Money.yen(fixedIn.value, "固定手数料");
      const channel = chSel.value === "__other" ? chOther.value.trim() || "その他" : chSel.value;
      const nowIso = new Date().toISOString();
      const soldAtIso = soldIn.value || todayStr();
      const sale = {
        channel,
        soldAt: soldAtIso,
        grossAmount: gross,
        platformFee,
        shippingFee: Money.yen(shipIn.value, "送料"),
        packingFee: Money.yen(packIn.value, "梱包費"),
        payoutFee: Money.yen(payoutIn.value, "振込手数料"),
        otherFee: 0,
        paymentStatus: "pending",
        payoutAt: null,
      };
      Money.saleNet(sale); // 妥当性チェック
      let next = structuredClone(p);
      next.sale = sale;
      next = Life.applyProductTransition(next, "売却済み", `${channel}で売却`, nowIso);
      next.soldAt = soldAtIso;
      if (paidChk.checked) next = Life.applyProductTransition(next, "入金済み", "", nowIso);
      state.products = state.products.map((x) => (x.id === p.id ? next : x));
      const profit = Money.realizedProfit(sale, p.purchase);
      commit("sale", "product", p.id, `${p.name} を売却登録した(利益 ${Money.fmtSigned(profit)})`);
      closeAllModals();
      openProductDetail(p.id);
    } catch (ex) { err.textContent = ex.message; }
  });

  openModal("売却を登録", [form]);
}

/* ==========================================================
   抽選
========================================================== */
const LOTTERY_TABS = ["おすすめ", "締切間近", "応募済み", "結果待ち", "終了"];

function renderLottery() {
  const root = document.getElementById("view-lottery");
  clear(root);
  const now = new Date();
  const tabs = el("div", { class: "tabs", role: "tablist" });
  for (const t of LOTTERY_TABS) {
    tabs.append(el("button", {
      class: "tab", role: "tab", "aria-selected": String(route.lotteryTab === t),
      onclick: () => { route.lotteryTab = t; renderLottery(); },
    }, t));
  }
  root.append(tabs);

  const list = state.lotteries
    .filter(Life.lotteryTabFilter(route.lotteryTab, now))
    .sort((a, b) => {
      const da = a.applicationDeadline ? new Date(a.applicationDeadline).getTime() : Infinity;
      const db = b.applicationDeadline ? new Date(b.applicationDeadline).getTime() : Infinity;
      return da - db;
    });

  if (list.length === 0) {
    root.append(el("div", { class: "empty-note" },
      state.lotteries.length === 0
        ? "抽選情報がまだありません。「＋」→「抽選を登録」で、見つけた抽選の締切を管理できます。"
        : `「${route.lotteryTab}」の抽選はありません。`));
    return;
  }

  for (const l of list) {
    const card = el("div", { class: "card clickable", onclick: () => openLotteryDetail(l.id), role: "button", tabindex: "0" },
      el("div", { class: "prod-head" },
        el("div", {},
          el("div", { class: "prod-name" }, l.title),
          l.store ? el("div", { class: "prod-series" }, l.store) : null),
        badge(l.status)));
    if (l.applicationDeadline) {
      const remain = new Date(l.applicationDeadline).getTime() - now.getTime();
      card.append(kv("応募締切", `${fmtDateTime(l.applicationDeadline)}${remain > 0 && l.status === "興味あり" ? `(${Fin.remainLabel(remain)})` : ""}`, remain > 0 && remain < 24 * 3600e3 ? "neg" : ""));
    }
    if (l.price) card.append(kv("販売価格", Money.fmt(Number(l.price))));
    if (l.status === "当選" && l.purchaseDeadline) card.append(kv("購入期限", fmtDateTime(l.purchaseDeadline), "neg"));
    const deadlinePassed = l.applicationDeadline && new Date(l.applicationDeadline).getTime() < now.getTime();
    if (l.status === "興味あり" && !deadlinePassed) {
      card.append(el("div", { class: "btn-row" },
        el("button", { class: "btn primary small", onclick: (e) => { e.stopPropagation(); openApplyPrep(l); } }, "応募準備")));
    }
    root.append(card);
  }
}

function openLotteryDetail(id) {
  const l = state.lotteries.find((x) => x.id === id);
  if (!l) return;
  const body = [];
  body.push(el("div", { class: "prod-head" },
    el("div", {},
      l.store ? el("div", { class: "prod-series" }, l.store) : null,
      el("div", { class: "prod-name", style: "font-size:17px" }, l.title)),
    badge(l.status)));

  const dt = el("table", { class: "detail-table", style: "margin-top:10px" });
  const row = (k, v) => dt.append(el("tr", {}, el("td", {}, k), el("td", {}, v)));
  if (l.productName) row("商品", l.productName);
  if (l.price) row("販売価格", Money.fmt(Number(l.price)));
  row("応募締切", l.applicationDeadline ? fmtDateTime(l.applicationDeadline) : "—");
  if (l.resultDate) row("当選発表", fmtDateTime(l.resultDate));
  if (l.purchaseDeadline) row("購入期限", fmtDateTime(l.purchaseDeadline));
  if (l.eligibility) row("応募条件", l.eligibility);
  if (l.note) row("メモ", l.note);
  body.push(dt);

  if (l.url && /^https?:\/\//.test(l.url)) {
    body.push(el("div", { class: "btn-row" },
      el("a", { class: "btn", href: l.url, target: "_blank", rel: "noopener noreferrer" }, "公式サイトを開く ↗")));
  }

  const actions = el("div", { class: "btn-row" });
  if (l.status === "興味あり") {
    actions.append(el("button", { class: "btn primary", onclick: () => { closeModal(); openApplyPrep(l); } }, "応募準備"));
  }
  for (const to of Life.LOTTERY_TRANSITIONS[l.status] || []) {
    const label = Life.LOTTERY_ACTION_LABELS[`${l.status}>${to}`] || to;
    if (to === "応募済み") continue; // 応募準備フローから行う
    if (to === "購入済み") {
      actions.append(el("button", { class: "btn primary", onclick: () => {
        closeAllModals();
        openProductForm(null, {
          name: l.productName || l.title, store: l.store, itemPrice: l.price, lotteryId: l.id,
        }, () => {
          const next = Life.applyLotteryTransition(l, "購入済み", "当選購入", new Date().toISOString());
          state.lotteries = state.lotteries.map((x) => (x.id === l.id ? next : x));
          commit("lottery-purchase", "lottery", l.id, `${l.title} の当選分を購入登録した`);
        });
      } }, "購入を登録"));
      continue;
    }
    actions.append(el("button", { class: "btn", onclick: () => {
      try {
        const next = Life.applyLotteryTransition(l, to, label, new Date().toISOString());
        state.lotteries = state.lotteries.map((x) => (x.id === l.id ? next : x));
        commit("lottery-transition", "lottery", l.id, `${l.title}: ${l.status} → ${to}`);
        closeAllModals(); openLotteryDetail(l.id);
      } catch (e) { alert(e.message); }
    } }, label));
  }
  actions.append(el("button", { class: "btn", onclick: () => openLotteryForm(l) }, "編集"));
  body.push(actions);

  if (l.history && l.history.length) {
    body.push(el("h2", { class: "section" }, "履歴"));
    const ul = el("ul", { class: "history-list" });
    for (const h of [...l.history].reverse()) ul.append(el("li", {}, `${fmtDateTime(h.at)} ${h.from} → ${h.to}`));
    body.push(ul);
  }

  body.push(el("div", { class: "btn-row", style: "margin-top:12px" },
    el("button", { class: "btn danger small", onclick: () => {
      if (!confirm(`「${l.title}」を削除しますか?`)) return;
      state.lotteries = state.lotteries.filter((x) => x.id !== l.id);
      commit("delete", "lottery", l.id, `${l.title} を削除した`);
      closeAllModals();
    } }, "この抽選を削除")));

  openModal("抽選詳細", body);
}

/* ---------- 応募準備(最終応募はユーザー本人が行う) ---------- */
function openApplyPrep(l) {
  const body = [];
  body.push(el("div", { class: "prod-name", style: "font-size:16px" }, l.title));
  if (l.applicationDeadline) {
    const remain = new Date(l.applicationDeadline).getTime() - Date.now();
    body.push(el("div", { class: "form-note" }, `応募締切: ${fmtDateTime(l.applicationDeadline)}(${Fin.remainLabel(remain)})`));
  }
  if (l.eligibility) body.push(el("div", { class: "card" }, el("div", { class: "todo-sub" }, "応募条件"), el("div", {}, l.eligibility)));
  body.push(el("div", { class: "ai-note" }, "応募はご自身で公式サイトから行ってください。TCG Nexusは自動応募を行いません。応募が終わったら下のボタンで記録します。"));
  const btns = el("div", { class: "btn-row" });
  if (l.url && /^https?:\/\//.test(l.url)) btns.append(el("a", { class: "btn", href: l.url, target: "_blank", rel: "noopener noreferrer" }, "公式サイトを開く ↗"));
  btns.append(el("button", { class: "btn primary", onclick: () => {
    try {
      const next = Life.applyLotteryTransition(l, "応募済み", "", new Date().toISOString());
      state.lotteries = state.lotteries.map((x) => (x.id === l.id ? next : x));
      commit("lottery-applied", "lottery", l.id, `${l.title} に応募した`);
      closeAllModals();
      switchView("lottery");
    } catch (e) { alert(e.message); }
  } }, "応募済みとして記録"));
  body.push(btns);
  openModal("応募準備", body);
}

/* ---------- 抽選フォーム ---------- */
function openLotteryForm(existing) {
  const l = existing || null;
  const form = el("form", { novalidate: true });
  const err = el("div", { class: "form-error", role: "alert" });
  const titleIn = textInput("title", l?.title || "", { placeholder: "例: OP-17 世界最強の戦士 BOX抽選" });
  const prodIn = textInput("productName", l?.productName || "", { placeholder: "当選時に登録する商品名" });
  const storeIn = textInput("store", l?.store || "", { placeholder: "例: 〇〇書店 / 公式ストア" });
  const priceIn = yenInput("price", l?.price ?? "");
  const dlIn = el("input", { type: "datetime-local", name: "applicationDeadline", value: l?.applicationDeadline || "" });
  const resIn = el("input", { type: "datetime-local", name: "resultDate", value: l?.resultDate || "" });
  const pdlIn = el("input", { type: "datetime-local", name: "purchaseDeadline", value: l?.purchaseDeadline || "" });
  const urlIn = textInput("url", l?.url || "", { placeholder: "https://…", type: "url" });
  const eligIn = textInput("eligibility", l?.eligibility || "", { placeholder: "例: 会員登録必要 / 店頭受取のみ" });
  const noteIn = el("textarea", { name: "note", rows: "2" }, l?.note || "");

  form.append(
    field("タイトル *", titleIn, true),
    el("div", { class: "form-grid" },
      field("商品名", prodIn),
      field("販売者", storeIn),
      field("販売価格", priceIn),
      field("応募締切", dlIn),
      field("当選発表", resIn),
      field("購入期限(当選時)", pdlIn),
    ),
    field("公式URL", urlIn, true),
    field("応募条件", eligIn, true),
    field("メモ", noteIn, true),
    err,
    el("button", { class: "btn primary block", type: "submit" }, l ? "保存する" : "抽選を登録")
  );

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      const title = titleIn.value.trim();
      if (!title) throw new Error("タイトルを入力してください");
      if (priceIn.value) Money.yen(priceIn.value, "販売価格");
      const url = urlIn.value.trim();
      if (url && !/^https?:\/\//.test(url)) throw new Error("URLは http(s):// で始まる形式で入力してください");
      const nowIso = new Date().toISOString();
      if (l) {
        Object.assign(l, {
          title, productName: prodIn.value.trim(), store: storeIn.value.trim(),
          price: priceIn.value ? Money.yen(priceIn.value, "販売価格") : null,
          applicationDeadline: dlIn.value || null, resultDate: resIn.value || null, purchaseDeadline: pdlIn.value || null,
          url, eligibility: eligIn.value.trim(), note: noteIn.value.trim(), updatedAt: nowIso,
        });
        commit("update", "lottery", l.id, `${title} を編集した`);
        closeAllModals(); openLotteryDetail(l.id);
      } else {
        const lottery = {
          id: Store.newId("lot"), title,
          productName: prodIn.value.trim(), store: storeIn.value.trim(),
          price: priceIn.value ? Money.yen(priceIn.value, "販売価格") : null,
          applicationDeadline: dlIn.value || null, resultDate: resIn.value || null, purchaseDeadline: pdlIn.value || null,
          url, eligibility: eligIn.value.trim(), note: noteIn.value.trim(),
          status: "興味あり", history: [{ at: nowIso, from: "(登録)", to: "興味あり", note: "" }],
          createdAt: nowIso, updatedAt: nowIso,
        };
        state.lotteries.push(lottery);
        commit("create", "lottery", lottery.id, `抽選 ${title} を登録した`);
        closeAllModals();
        switchView("lottery");
      }
    } catch (ex) { err.textContent = ex.message; }
  });

  openModal(l ? "抽選を編集" : "抽選を登録", [form]);
}

/* ==========================================================
   お金
========================================================== */
function renderMoney() {
  const root = document.getElementById("view-money");
  clear(root);
  const s = Fin.computeSummary(state.products, state.settings, new Date());
  const detail = state.settings.mode === "detail";

  root.append(el("h2", { class: "section" }, "お金の要約"));
  root.append(moneySummaryGrid(s, detail));

  // 予算
  root.append(el("h2", { class: "section" }, "今月の仕入予算"));
  const b = s.budget;
  const budgetCard = el("div", { class: "card" });
  if (b.budget > 0) {
    const pendingRest = b.pending - b.overlap; // 今月注文分は「使用済み」に含まれるため二重に引かない
    const usedPct = Math.min(100, Math.round(((b.budget - b.available) / b.budget) * 100));
    const over = b.available < 0;
    // 注意: ネイティブappendはnullを文字列化するため、el()コンテナ経由で追加する
    budgetCard.append(el("div", {},
      kv("月間仕入予算", Money.fmt(b.budget)),
      kv("使用済み(今月注文)", Money.fmt(b.used)),
      kv("支払予定(今月注文分を除く)", Money.fmt(pendingRest)),
      kv("利用可能額", Money.fmt(b.available), over ? "neg" : "pos"),
      el("div", { class: "budget-bar" }, el("div", { class: `budget-fill${over || usedPct >= 80 ? " over" : ""}`, style: `width:${usedPct}%` })),
      over ? el("div", { class: "form-note", style: "color:var(--neg)" }, `予算を ${Money.fmt(-b.available)} 超過しています(支払予定含む)`) :
        usedPct >= 80 ? el("div", { class: "form-note", style: "color:var(--warn)" }, `予算の${usedPct}%を使用中です`) : null
    ));
  } else {
    budgetCard.append(el("div", { class: "form-note" }, "予算は未設定です。設定すると使いすぎを確認できます。"));
  }
  budgetCard.append(el("div", { class: "btn-row" },
    el("button", { class: "btn small", onclick: openBudgetForm }, b.budget > 0 ? "予算を変更" : "予算を設定")));
  root.append(budgetCard);

  if (detail) {
    root.append(el("h2", { class: "section" }, "詳細"));
    const dt = el("table", { class: "detail-table" });
    const row = (k, v, cls) => dt.append(el("tr", {}, el("td", {}, k), el("td", { class: cls || "" }, v)));
    row("在庫原価(保有中+出品中)", Money.fmt(s.inventoryCost));
    row("到着待ち原価(支払済み)", Money.fmt(s.arrivingCost));
    row("支払予定(未払い)", Money.fmt(s.pendingPayment));
    row("含み損益(相場入力分)", Money.fmtSigned(s.unrealized));
    row("未入金売上(手取り)", Money.fmt(s.unpaidSales));
    row("資金拘束額", Money.fmt(s.fundsLocked));
    row("売却済み件数", `${s.soldCount}件`);
    root.append(el("div", { class: "card" }, dt));

    if (s.monthly.length) {
      root.append(el("h2", { class: "section" }, "月別"));
      const mt = el("table", { class: "month-table" });
      mt.append(el("tr", {}, el("th", {}, "月"), el("th", {}, "仕入"), el("th", {}, "売上(手取り)"), el("th", {}, "確定利益")));
      for (const m of s.monthly.slice(0, 12)) {
        mt.append(el("tr", {},
          el("td", {}, m.ym),
          el("td", {}, Money.fmt(m.spend)),
          el("td", {}, Money.fmt(m.sales)),
          el("td", { class: pnlClass(m.profit) }, Money.fmtSigned(m.profit))));
      }
      root.append(el("div", { class: "card" }, mt));
    }

    root.append(el("h2", { class: "section" }, "エクスポート"));
    root.append(el("div", { class: "card" },
      el("div", { class: "form-note" }, "取引CSV(会計・確定申告の下資料)とバックアップJSONを出力できます。数値は画面と同じ計算式です。"),
      el("div", { class: "btn-row" },
        el("button", { class: "btn", onclick: downloadCsv }, "取引CSVを出力"),
        el("button", { class: "btn", onclick: downloadJson }, "バックアップJSON"))));
  }

  root.append(el("div", { class: "btn-row", style: "margin-top:14px" },
    el("button", { class: "btn small", onclick: () => {
      state.settings.mode = detail ? "simple" : "detail";
      commit("mode-change", "settings", "mode", `表示モードを${detail ? "シンプル" : "詳細"}に変更した`);
    } }, detail ? "シンプル表示に戻す" : "詳細を表示")));
}

function openBudgetForm() {
  const form = el("form", { novalidate: true });
  const err = el("div", { class: "form-error", role: "alert" });
  const budgetIn = yenInput("budget", state.settings.monthlyBudget || "");
  form.append(
    field("月間仕入予算(0で未設定)", budgetIn, true), err,
    el("div", { class: "form-note" }, "予算を超えても購入は禁止されません。超過額を表示してお知らせします。"),
    el("button", { class: "btn primary block", type: "submit" }, "保存する"));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      state.settings.monthlyBudget = Money.yen(budgetIn.value, "予算");
      commit("budget", "settings", "budget", `月間予算を ${Money.fmt(state.settings.monthlyBudget)} に設定した`);
      closeModal();
    } catch (ex) { err.textContent = ex.message; }
  });
  openModal("仕入予算", [form]);
}

/* ---------- CSV / JSON ---------- */
function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const a = el("a", { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
function downloadCsv() {
  const csv = "\uFEFF" + Csv.toCsv(Csv.buildRows(state.products)); // BOM付き(Excel文字化け対策)
  download(`tcg-nexus_取引_${stamp()}.csv`, csv, "text/csv;charset=utf-8");
  commit("export-csv", "finance", "csv", "取引CSVを出力した");
}
function downloadJson() {
  state.settings.lastExportAt = new Date().toISOString();
  download(`tcg-nexus_backup_${stamp()}.json`, Store.exportJson(state), "application/json");
  commit("export-json", "system", "backup", "バックアップJSONを出力した");
  showToast("書き出しました。ファイルに保存されたかを確かめてください。");
}

/** バックアップのファイルを選んで読み戻す(ホームと設定の両方から使う) */
function pickRestoreFile() {
  const fileIn = el("input", { type: "file", accept: ".json,application/json", style: "display:none" });
  fileIn.addEventListener("change", () => {
    const f = fileIn.files && fileIn.files[0];
    fileIn.remove();
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const next = Store.importJson(String(reader.result));
        if (!confirm(`バックアップを読み込みます。現在のデータ(商品${state.products.length}件)は上書きされます。よろしいですか?`)) return;
        Store.audit(next, "import", "system", "backup", "バックアップから復元した");
        if (!Store.save(next)) { alert("保存に失敗しました。ブラウザの空き容量を確認してください。"); return; }
        state = next; // 監査と保存が成功してから差し替える
        closeAllModals();
        renderAll();
        showToast(`読み戻しました(商品${state.products.length}件・抽選${state.lotteries.length}件)`);
      } catch (e) { alert(`読み込みに失敗しました: ${e.message}`); }
    };
    reader.readAsText(f);
  });
  document.body.append(fileIn);
  fileIn.click();
}

/* ==========================================================
   ＋メニュー / 設定 / オンボーディング
========================================================== */
function openPlusMenu() {
  const item = (icon, title, sub, onclick) => el("button", { class: "plus-item", onclick },
    el("span", { class: "plus-ico" }, svgIcon(icon)),
    el("span", {}, el("span", { class: "plus-title" }, title), el("span", { class: "plus-sub" }, sub)));
  const body = el("div", { class: "plus-menu" },
    item("box", "商品を登録", "買った物と値段を記録する", () => { closeModal(); openProductForm(); }),
    item("sell", "売却を登録", "売れた値段と手数料から、利益を出す", () => { closeModal(); openSellPicker(); }),
    item("ticket", "抽選を登録", "締切と結果発表の日を見張る", () => { closeModal(); openLotteryForm(); }),
    el("div", { class: "ai-note" }, "スクリーンショット読取り・メール取込みは今後のアップデートで対応予定です。"));
  openModal("何を登録しますか?", [body]);
}

function openSellPicker() {
  const sellable = state.products.filter((p) => ["保有中", "出品中"].includes(p.status));
  if (sellable.length === 0) {
    openModal("売却を登録", [el("div", { class: "empty-note" }, "売却できる商品(保有中・出品中)がありません。先に商品を登録してください。")]);
    return;
  }
  const body = el("div", {});
  body.append(el("div", { class: "form-note" }, "売却した商品を選んでください"));
  for (const p of sellable) {
    body.append(el("div", { class: "card clickable todo-card", onclick: () => { closeModal(); openSaleForm(p); }, role: "button", tabindex: "0" },
      badge(p.status),
      el("div", { class: "todo-body" },
        el("div", { class: "todo-title" }, p.name),
        el("div", { class: "todo-sub" }, `原価 ${Money.fmt(safeCost(p))}`))));
  }
  openModal("売却を登録", [body]);
}

function openSettings() {
  const body = [];
  const s = state.settings;

  // 表示モード・確定利益ルール
  const modeSel = el("select", {},
    el("option", { value: "simple" }, "シンプル(標準)"),
    el("option", { value: "detail" }, "詳細"));
  modeSel.value = s.mode;
  modeSel.addEventListener("change", () => {
    s.mode = modeSel.value;
    commit("mode-change", "settings", "mode", `表示モードを変更した`);
  });
  const strictChk = el("input", { type: "checkbox" });
  strictChk.checked = !!s.strictPayout;
  strictChk.addEventListener("change", () => {
    s.strictPayout = strictChk.checked;
    commit("setting", "settings", "strictPayout", `確定利益の集計を${strictChk.checked ? "入金済みのみ" : "売却登録済み含む"}に変更した`);
  });
  body.push(el("h2", { class: "section" }, "表示"));
  body.push(el("div", { class: "card" },
    field("表示モード", modeSel),
    el("div", { class: "field" }, el("label", {}, el("span", {}, "確定利益は入金済みのみ数える "), strictChk))));

  // 販売先手数料
  body.push(el("h2", { class: "section" }, "販売先の手数料率"));
  const chCard = el("div", { class: "card" });
  const renderChannels = () => {
    clear(chCard);
    for (let i = 0; i < s.channels.length; i++) {
      const c = s.channels[i];
      const nameIn = textInput("", c.name, {});
      const rateIn = el("input", { type: "number", min: "0", max: "100", step: "0.1", value: c.feeRate, style: "width:80px" });
      const del = el("button", { class: "btn danger small", onclick: () => { s.channels.splice(i, 1); commit("setting", "settings", "channels", "販売先を削除した"); renderChannels(); } }, "削除");
      nameIn.addEventListener("change", () => { c.name = nameIn.value.trim() || c.name; commit("setting", "settings", "channels", "販売先名を変更した"); });
      rateIn.addEventListener("change", () => {
        const r = Number(rateIn.value);
        if (Number.isFinite(r) && r >= 0 && r <= 100) { c.feeRate = r; commit("setting", "settings", "channels", `${c.name} の手数料率を${r}%にした`); }
      });
      chCard.append(el("div", { style: "display:flex;gap:8px;margin-bottom:8px;align-items:center" }, nameIn, rateIn, el("span", { class: "todo-sub" }, "%"), del));
    }
    chCard.append(el("button", { class: "btn small", onclick: () => { s.channels.push({ name: "新しい販売先", feeRate: 10 }); commit("setting", "settings", "channels", "販売先を追加した"); renderChannels(); } }, "＋ 販売先を追加"));
  };
  renderChannels();
  body.push(chCard);

  // データ
  body.push(el("h2", { class: "section" }, "データ"));
  body.push(el("div", { class: "card" },
    el("div", { class: "promise" }, FREE_PROMISE),
    el("div", { class: "btn-row" },
      el("button", { class: "btn", onclick: downloadCsv }, "取引CSVを出力"),
      el("button", { class: "btn", onclick: downloadJson }, "バックアップJSON(書き出す)"),
      el("button", { class: "btn", onclick: pickRestoreFile }, "バックアップを復元(読み戻す)")),
    el("div", { class: "form-note" }, "データはこの端末のブラウザ内にのみ保存されます。端末変更前にバックアップJSONを保存してください。")));

  // 監査ログ
  body.push(el("h2", { class: "section" }, "変更履歴(監査ログ)"));
  const logCard = el("div", { class: "card" });
  const ul = el("ul", { class: "history-list" });
  for (const a of state.auditLog.slice(-30).reverse()) ul.append(el("li", {}, `${fmtDateTime(a.at)} ${a.detail || a.action}`));
  logCard.append(state.auditLog.length ? ul : el("div", { class: "form-note" }, "まだ履歴はありません"));
  body.push(logCard);

  // 全削除
  body.push(el("div", { class: "btn-row", style: "margin-top:14px" },
    el("button", { class: "btn danger small", onclick: () => {
      if (!confirm("すべてのデータを削除しますか?この操作は取り消せません。")) return;
      if (!confirm("本当に削除しますか?バックアップJSONの保存をおすすめします。")) return;
      Store.clearAll();
      state = Store.defaultState();
      state.settings.onboarded = true;
      Store.save(state);
      closeAllModals();
      renderAll();
    } }, "すべてのデータを削除")));

  openModal("設定", body);
}

function openOnboarding() {
  const s = state.settings;
  const body = [];
  body.push(el("div", { class: "form-note" }, "TCG Nexusへようこそ。トレカの仕入・在庫・抽選・利益をここひとつで管理できます。3つだけ教えてください(あとで変更できます)。"));
  body.push(el("div", { class: "promise" }, `会員登録はありません。${FREE_PROMISE}`));
  body.push(el("div", { class: "form-note" }, "個人が作った非公式の道具です。カードの会社とは関係ありません。カードの絵や相場は入っていないので、値段は自分で入れます。"));
  const purposeSel = el("select", {},
    el("option", { value: "コレクション" }, "コレクション"),
    el("option", { value: "投資・副業" }, "投資・副業"),
    el("option", { value: "店舗・事業" }, "店舗・事業"));
  const tcgSel = el("select", {},
    el("option", { value: "ポケモン" }, "ポケモンカード"),
    el("option", { value: "ONE PIECE" }, "ONE PIECEカード"),
    el("option", { value: "遊戯王" }, "遊戯王"),
    el("option", { value: "その他" }, "その他"));
  const budgetIn = yenInput("budget", "", "例: 50000(任意)");
  const err = el("div", { class: "form-error", role: "alert" });
  body.push(field("利用目的", purposeSel, true));
  body.push(field("主なTCG", tcgSel, true));
  body.push(field("月間仕入予算(任意)", budgetIn, true));
  body.push(err);
  body.push(el("div", { class: "btn-row" },
    el("button", { class: "btn primary block", onclick: () => {
      try {
        s.purpose = purposeSel.value;
        s.mainTcg = tcgSel.value;
        s.monthlyBudget = budgetIn.value ? Money.yen(budgetIn.value, "予算") : 0;
        s.onboarded = true;
        commit("onboarding", "settings", "onboarding", "初期設定を完了した");
        closeAllModals();
        openProductForm();
      } catch (e) { err.textContent = e.message; }
    } }, "はじめる(最初の商品を登録)"),
    el("button", { class: "btn block", onclick: () => {
      s.onboarded = true;
      commit("onboarding", "settings", "onboarding", "初期設定をスキップした");
      closeAllModals();
    } }, "あとで")));
  openModal("ようこそ", body);
}

/* ==========================================================
   ナビゲーション・初期化
========================================================== */
function switchView(view) {
  route.view = view;
  if (location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
  renderAll();
}

function renderAll() {
  for (const v of ["home", "products", "lottery", "money"]) {
    document.getElementById(`view-${v}`).classList.toggle("active", route.view === v);
  }
  document.querySelectorAll(".nav-item").forEach((b) => {
    if (b.dataset.view === route.view) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  if (route.view === "home") renderHome();
  else if (route.view === "products") renderProducts();
  else if (route.view === "lottery") renderLottery();
  else renderMoney();
}

document.querySelectorAll(".nav-item").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
document.getElementById("fab").addEventListener("click", openPlusMenu);
document.getElementById("btn-settings").addEventListener("click", openSettings);
addEventListener("hashchange", () => {
  const v = location.hash.slice(1);
  if (["home", "products", "lottery", "money"].includes(v) && v !== route.view) { route.view = v; renderAll(); }
});

const initHash = location.hash.slice(1);
if (["home", "products", "lottery", "money"].includes(initHash)) route.view = initHash;
renderAll();
if (!state.settings.onboarded) openOnboarding();
