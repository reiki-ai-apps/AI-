// 資材カタログ: メーカー・カテゴリ絞り込み、検索、見積リストへの追加
import { initSite, addToQuoteList, esc, yen } from "./site.js";
import { CATEGORIES, PRODUCTS, MAKERS } from "./catalog-data.js";
initSite();
const $ = s => document.querySelector(s);
const chips = $("#chips"), makerChips = $("#maker-chips"), grid = $("#grid"), q = $("#q"), count = $("#count"), catDesc = $("#cat-desc");
const state = { cat: "all", maker: "all", q: "" };
const makerLabel = id => (MAKERS.find(m => m.id === id) || {}).label || "";
function readHash() {
  const m = location.hash.match(/cat=([\w-]+)/); state.cat = m && CATEGORIES.some(c => c.id === m[1]) ? m[1] : "all";
  const k = location.hash.match(/maker=([\w-]+)/); state.maker = k && MAKERS.some(c => c.id === k[1]) ? k[1] : "all";
}
function writeHash() { const parts = []; if (state.cat !== "all") parts.push(`cat=${state.cat}`); if (state.maker !== "all") parts.push(`maker=${state.maker}`); history.replaceState(null, "", parts.length ? `#${parts.join("&")}` : location.pathname); }
function render() {
  chips.innerHTML = [{ id: "all", label: "すべて", icon: "▣" }, ...CATEGORIES].map(c => `<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${state.cat === c.id}"><span aria-hidden="true">${c.icon}</span> ${esc(c.label)}</button>`).join("");
  makerChips.innerHTML = [{ id: "all", label: "全メーカー" }, ...MAKERS].map(m => `<button type="button" class="chip maker" data-maker="${m.id}" aria-pressed="${state.maker === m.id}">${esc(m.label)}</button>`).join("");
  const cur = CATEGORIES.find(c => c.id === state.cat), mk = MAKERS.find(m => m.id === state.maker);
  catDesc.textContent = mk ? `${mk.label}: ${mk.desc}` : cur ? cur.desc : "パイプハウス関連資材全般を取り扱っています。メーカー品の価格は確認前の参考値、または要見積です。";
  const kw = state.q.trim().toLowerCase();
  const list = PRODUCTS.filter(p => (state.cat === "all" || p.cat === state.cat) && (state.maker === "all" || p.maker === state.maker) && (!kw || [p.name, p.spec, p.id, makerLabel(p.maker), ...(p.tags || [])].join(" ").toLowerCase().includes(kw)));
  count.textContent = `${list.length}件 / 全${PRODUCTS.length}件`;
  grid.innerHTML = list.length ? list.map(p => `
    <article class="product" data-id="${esc(p.id)}">
      <div class="p-head"><span class="badge ${p.maker === "generic" ? "gray" : ""}">${esc(makerLabel(p.maker))}</span><span class="p-id">${esc(p.id)}</span></div>
      <h3>${esc(p.name)}</h3>
      <div class="p-spec">${esc(p.spec)}</div>
      ${p.note ? `<div class="p-note">${esc(p.note)}</div>` : ""}
      <div class="p-tags"><span class="badge gray">${esc((CATEGORIES.find(c => c.id === p.cat) || {}).label || "")}</span>${(p.tags || []).map(t => `<span class="badge${t === "人気" ? " warn" : ""}">${esc(t)}</span>`).join("")}</div>
      <div class="p-foot">
        <div>${p.price != null ? `<span class="price">${yen(p.price)}</span><span class="muted small"> /${esc(p.unit)}(税抜・参考)</span>` : `<span class="price ask">要見積</span><span class="muted small"> /${esc(p.unit)}</span>`}</div>
        <div class="p-add"><input type="number" min="1" value="1" aria-label="数量"><button type="button" class="btn sm" data-add="${esc(p.id)}">見積リストへ</button></div>
      </div>
    </article>`).join("") : `<p class="muted">該当する資材がありません。キーワードやメーカーを変えてお試しください。</p>`;
}
chips.addEventListener("click", e => { const b = e.target.closest("[data-cat]"); if (!b) return; state.cat = b.dataset.cat; writeHash(); render(); });
makerChips.addEventListener("click", e => { const b = e.target.closest("[data-maker]"); if (!b) return; state.maker = b.dataset.maker; writeHash(); render(); });
q.addEventListener("input", () => { state.q = q.value; render(); });
grid.addEventListener("click", e => {
  const b = e.target.closest("[data-add]"); if (!b) return;
  const p = PRODUCTS.find(x => x.id === b.dataset.add); const qty = parseInt(b.parentElement.querySelector("input").value, 10) || 1;
  if (p) addToQuoteList({ ...p, name: `${p.name}${p.maker !== "generic" ? "(" + makerLabel(p.maker) + ")" : ""}`, price: p.price }, qty);
});
window.addEventListener("hashchange", () => { readHash(); render(); });
readHash(); render();
