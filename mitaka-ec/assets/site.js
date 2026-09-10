// 共通UI: ナビ、トースト、見積リスト(カタログの選択品をブラウザに保存)
import { ICONS } from "./icons.js";
import { currentSekki } from "./sekki.js";
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
  const sekki = document.getElementById("sekki");
  if (sekki) { const t = currentSekki(); sekki.querySelector("b").textContent = t.name; sekki.querySelector("span").textContent = t.task; }
  const header = document.querySelector(".site-header");
  if (header) { const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 80); onScroll(); addEventListener("scroll", onScroll, { passive: true }); }
  initTextSize();
  initQuoteDrawer();
}

// 文字の大きさ: 標準 → 大 → 特大 の3段階(端末ごとに記憶)
function initTextSize() {
  const KEY = "mitaka-text-size", LEVELS = ["", "text-l", "text-xl"], LABELS = ["文字大", "大", "特大"];
  let i = 0; try { i = Math.max(0, LEVELS.indexOf(localStorage.getItem(KEY) || "")); } catch {}
  const apply = () => {
    document.documentElement.classList.remove("text-l", "text-xl"); if (LEVELS[i]) document.documentElement.classList.add(LEVELS[i]);
    document.querySelectorAll("[data-textsize]").forEach(b => { b.setAttribute("aria-pressed", String(i > 0)); const l = b.querySelector(".lbl"); if (l) l.textContent = LABELS[i]; });
  };
  apply();
  document.querySelectorAll("[data-textsize]").forEach(b => b.addEventListener("click", () => { i = (i + 1) % LEVELS.length; try { localStorage.setItem(KEY, LEVELS[i]); } catch {} apply(); toast(["文字を標準に戻しました", "文字を大きくしました", "文字を特大にしました"][i]); }));
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
  if (found) { found.qty += qty; if (item.confirm) found.confirm = true; } else list.push({ id: item.id, name: item.name, spec: item.spec, unit: item.unit, price: item.price == null ? null : item.price, qty, confirm: !!item.confirm, cat: item.cat || "" });
  saveQuoteList(list);
  toast(item.confirm ? `かごに入れました ✓(担当が合っているか確認します)` : `かごに入れました ✓  ${item.name}`);
  const fab = document.querySelector(".quote-fab"); if (fab) { fab.classList.remove("bump"); void fab.offsetWidth; fab.classList.add("bump"); }
}
// 図がかごへ飛ぶ演出(動きを減らす設定では省略)
export function flyToCart(fromEl) {
  const fab = document.querySelector(".quote-fab"); if (!fromEl || !fab || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const a = fromEl.getBoundingClientRect(), b = fab.getBoundingClientRect();
  const ghost = fromEl.cloneNode(true); ghost.className = "fly"; ghost.style.cssText += `left:${a.left}px;top:${a.top}px;width:${a.width}px;height:${a.height}px;background:var(--surface-2);overflow:hidden;`;
  document.body.appendChild(ghost);
  requestAnimationFrame(() => { ghost.style.transform = `translate(${b.left + b.width / 2 - a.left - a.width / 2}px, ${b.top + b.height / 2 - a.top - a.height / 2}px) scale(0.15)`; ghost.style.opacity = "0.2"; });
  setTimeout(() => ghost.remove(), 500);
}
export function setQuoteQty(id, qty) {
  const list = getQuoteList().map(x => x.id === id ? { ...x, qty: Math.max(0, qty) } : x).filter(x => x.qty > 0);
  saveQuoteList(list);
}
export function removeFromQuoteList(id) { saveQuoteList(getQuoteList().filter(x => x.id !== id)); }
export function clearQuoteList() { saveQuoteList([]); }
export function quoteListText(list = getQuoteList()) {
  if (!list.length) return "";
  const lines = ["【かごの中身】", ...list.map(x => `・${x.name}(${x.spec}) × ${x.qty}${x.unit}  ${x.price == null ? "金額はご相談" : "めやす " + yen(x.price * x.qty)}${x.confirm ? "  ※合っているか確認希望" : ""}`)];
  const ask = list.filter(x => x.price == null).length;
  lines.push(`おおよその小計(税別): ${yen(list.reduce((s, x) => s + (x.price || 0) * x.qty, 0))}${ask ? `(金額ご相談 ${ask}件は別途)` : ""}`);
  return lines.join("\n");
}

function initQuoteDrawer() {
  if (document.body.dataset.noQuoteList != null) return;
  const fab = document.createElement("button");
  fab.className = "quote-fab"; fab.type = "button";
  fab.innerHTML = `<span class="ic">${ICONS.basket}</span> かご <span class="count">0</span>`;
  const drawer = document.createElement("div");
  drawer.className = "drawer";
  drawer.innerHTML = `
    <div class="backdrop"></div>
    <div class="panel" role="dialog" aria-label="見積リスト">
      <header><h3>かご</h3><button class="close-x" type="button" aria-label="とじる">× とじる</button></header>
      <div class="body"></div>
      <footer>
        <div class="flex between mb-2"><span class="muted small">おおよその小計(税別)</span><span class="price" data-sub>¥0</span></div>
        <p class="small muted" style="margin:0 0 .6rem">表示の金額はめやすです。正式な金額は担当がお見積りします。</p>
        <a class="btn accent lg block" href="quote.html">この内容で見積をたのむ</a>
        <button class="btn ghost sm block mt-1" type="button" data-clear>かごを空にする</button>
      </footer>
    </div>`;
  document.body.append(fab, drawer);
  const body = drawer.querySelector(".body");
  const render = () => {
    const list = getQuoteList();
    fab.querySelector(".count").textContent = String(list.reduce((s, x) => s + x.qty, 0));
    fab.hidden = list.length === 0 && !drawer.classList.contains("open");
    const ask = list.filter(x => x.price == null).length;
    drawer.querySelector("[data-sub]").textContent = yen(list.reduce((s, x) => s + (x.price || 0) * x.qty, 0)) + (ask ? ` + ご相談${ask}件` : "");
    body.innerHTML = list.length ? list.map(x => `
      <div class="line">
        <div class="fig" style="--shelf-bg:var(--surface-2);display:grid;place-items:center"><span class="fig-ic">${figureIcon(x)}</span></div>
        <div><div class="nm">${esc(x.name)}${x.confirm ? ' <span class="badge warn">要確認</span>' : ""}</div><div class="sp">${esc(x.spec)} / ${x.price == null ? "金額はご相談" : yen(x.price) + "/" + esc(x.unit)}</div>
          <button class="rm" type="button" data-rm="${esc(x.id)}">けす</button></div>
        <div class="qty"><button type="button" data-dec="${esc(x.id)}" aria-label="1つ減らす">−</button><span class="n">${x.qty}${esc(x.unit)}</span><button type="button" data-inc="${esc(x.id)}" aria-label="1つ増やす">＋</button></div>
      </div>`).join("") : `<p class="muted">まだ何も入っていません。<a href="catalog.html">資材をさがす</a>から入れられます。</p>`;
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
  document.addEventListener("quotelist:change", render);
  document.addEventListener("keydown", e => { if (e.key === "Escape") open(false); });
  render();
}

function figureIcon(x) { const map = { pipe: "pipe", joint: "joint", reinforce: "reinforce", fastener: "fastener", film: "film", door: "door", vent: "vent", curtain: "curtain", control: "control", irrigation: "irrigation", gutter: "gutter", mulch: "mulch", animal: "animal" }; return ICONS[map[x.cat] || "basket"]; }

export function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
