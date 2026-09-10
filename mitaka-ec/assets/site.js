// 共通UI: ナビ、トースト、見積リスト(カタログの選択品をブラウザに保存)
const STORAGE_KEY = "mitaka-ec-quote-list-v1";

export function initSite() {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".nav");
  if (toggle && nav) {
    const mq = window.matchMedia("(max-width: 860px)");
    const apply = () => { nav.hidden = mq.matches; toggle.setAttribute("aria-expanded", "false"); };
    apply();
    mq.addEventListener("change", apply);
    toggle.addEventListener("click", () => {
      nav.hidden = !nav.hidden;
      toggle.setAttribute("aria-expanded", String(!nav.hidden));
    });
  }
  // 現在ページのハイライト
  const here = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav a[href]").forEach(a => {
    const target = a.getAttribute("href").split("#")[0].split("?")[0];
    if (target === here) a.setAttribute("aria-current", "page");
  });
  const y = document.querySelector("[data-year]");
  if (y) y.textContent = String(new Date().getFullYear());
  initQuoteDrawer();
}

let toastTimer;
export function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

export function yen(n) { return "¥" + Math.round(n).toLocaleString("ja-JP"); }

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { 
    const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); return true; } catch { return false; } finally { ta.remove(); }
  }
}

// ---- 見積リスト ----
export function getQuoteList() {
  try { const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function saveQuoteList(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* 保存できない環境では無視 */ }
  document.dispatchEvent(new CustomEvent("quotelist:change", { detail: list }));
}
export function addToQuoteList(item, qty = 1) {
  const list = getQuoteList();
  const found = list.find(x => x.id === item.id);
  if (found) found.qty += qty; else list.push({ id: item.id, name: item.name, spec: item.spec, unit: item.unit, price: item.price == null ? null : item.price, qty });
  saveQuoteList(list);
  toast(`見積リストに追加しました: ${item.name}`);
}
export function setQuoteQty(id, qty) {
  const list = getQuoteList().map(x => x.id === id ? { ...x, qty: Math.max(0, qty) } : x).filter(x => x.qty > 0);
  saveQuoteList(list);
}
export function removeFromQuoteList(id) { saveQuoteList(getQuoteList().filter(x => x.id !== id)); }
export function clearQuoteList() { saveQuoteList([]); }
export function quoteListText(list = getQuoteList()) {
  if (!list.length) return "";
  const lines = ["【カタログ見積リスト】", ...list.map(x => `・${x.name}(${x.spec}) × ${x.qty}${x.unit}  ${x.price == null ? "要見積" : "参考 " + yen(x.price * x.qty)}`)];
  const ask = list.filter(x => x.price == null).length;
  lines.push(`参考小計(税抜): ${yen(list.reduce((s, x) => s + (x.price || 0) * x.qty, 0))}${ask ? `(要見積 ${ask}件を除く)` : ""}`);
  return lines.join("\n");
}

function initQuoteDrawer() {
  if (document.body.dataset.noQuoteList != null) return;
  const fab = document.createElement("button");
  fab.className = "quote-fab"; fab.type = "button";
  fab.innerHTML = `📋 見積リスト <span class="count">0</span>`;
  const drawer = document.createElement("div");
  drawer.className = "drawer";
  drawer.innerHTML = `
    <div class="backdrop"></div>
    <div class="panel" role="dialog" aria-label="見積リスト">
      <header><h3>見積リスト</h3><button class="close-x" type="button" aria-label="閉じる">×</button></header>
      <div class="body"></div>
      <footer>
        <div class="flex between mb-2"><span class="muted small">参考小計(税抜)</span><span class="price" data-sub>¥0</span></div>
        <a class="btn accent block" href="quote.html">この内容で見積依頼</a>
        <button class="btn ghost sm block mt-1" type="button" data-clear>リストを空にする</button>
      </footer>
    </div>`;
  document.body.append(fab, drawer);
  const body = drawer.querySelector(".body");
  const render = () => {
    const list = getQuoteList();
    fab.querySelector(".count").textContent = String(list.reduce((s, x) => s + x.qty, 0));
    fab.hidden = list.length === 0 && !drawer.classList.contains("open");
    const ask = list.filter(x => x.price == null).length;
    drawer.querySelector("[data-sub]").textContent = yen(list.reduce((s, x) => s + (x.price || 0) * x.qty, 0)) + (ask ? ` +要見積${ask}件` : "");
    body.innerHTML = list.length ? list.map(x => `
      <div class="line">
        <div><div class="nm">${esc(x.name)}</div><div class="sp">${esc(x.spec)} / ${x.price == null ? "要見積" : yen(x.price)}/${esc(x.unit)}</div>
          <button class="rm" type="button" data-rm="${esc(x.id)}">削除</button></div>
        <div class="qty"><button type="button" data-dec="${esc(x.id)}">−</button><input type="number" min="0" value="${x.qty}" data-qty="${esc(x.id)}"><button type="button" data-inc="${esc(x.id)}">＋</button></div>
      </div>`).join("") : `<p class="muted">まだ何も入っていません。<a href="catalog.html">資材カタログ</a>から追加できます。</p>`;
  };
  const open = (v) => { drawer.classList.toggle("open", v); render(); };
  fab.addEventListener("click", () => open(true));
  drawer.querySelector(".backdrop").addEventListener("click", () => open(false));
  drawer.querySelector(".close-x").addEventListener("click", () => open(false));
  drawer.querySelector("[data-clear]").addEventListener("click", () => { clearQuoteList(); toast("見積リストを空にしました"); });
  body.addEventListener("click", e => {
    const t = e.target;
    if (t.dataset.rm) removeFromQuoteList(t.dataset.rm);
    if (t.dataset.inc) { const x = getQuoteList().find(i => i.id === t.dataset.inc); if (x) setQuoteQty(x.id, x.qty + 1); }
    if (t.dataset.dec) { const x = getQuoteList().find(i => i.id === t.dataset.dec); if (x) setQuoteQty(x.id, x.qty - 1); }
  });
  body.addEventListener("change", e => { const t = e.target; if (t.dataset.qty) setQuoteQty(t.dataset.qty, parseInt(t.value, 10) || 0); });
  document.addEventListener("quotelist:change", render);
  document.addEventListener("keydown", e => { if (e.key === "Escape") open(false); });
  render();
}

export function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
