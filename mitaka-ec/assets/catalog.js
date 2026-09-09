// 資材カタログ: カテゴリ絞り込み・検索・見積リストへの追加
import { initSite, addToQuoteList, esc, yen } from "./site.js";
import { CATEGORIES, PRODUCTS } from "./catalog-data.js";
initSite();
const chips = document.getElementById("chips"), grid = document.getElementById("grid"), q = document.getElementById("q"), count = document.getElementById("count"), catDesc = document.getElementById("cat-desc");
const state = { cat: "all", q: "" };
function readHash() { const m = location.hash.match(/cat=([\w-]+)/); state.cat = m && CATEGORIES.some(c => c.id === m[1]) ? m[1] : "all"; }
function render() {
  chips.innerHTML = [{ id: "all", label: "すべて", icon: "▣" }, ...CATEGORIES].map(c => `<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${state.cat === c.id}"><span aria-hidden="true">${c.icon}</span> ${esc(c.label)}</button>`).join("");
  const cur = CATEGORIES.find(c => c.id === state.cat);
  catDesc.textContent = cur ? cur.desc : "ハウス関連資材全般を取り扱っています。価格はすべて仮単価(税抜)です。";
  const kw = state.q.trim().toLowerCase();
  const list = PRODUCTS.filter(p => (state.cat === "all" || p.cat === state.cat) && (!kw || [p.name, p.spec, p.id, ...(p.tags || [])].join(" ").toLowerCase().includes(kw)));
  count.textContent = `${list.length}件`;
  grid.innerHTML = list.length ? list.map(p => `
    <article class="product" data-id="${esc(p.id)}">
      <div class="p-head"><span class="badge gray">${esc((CATEGORIES.find(c => c.id === p.cat) || {}).label || "")}</span><span class="p-id">${esc(p.id)}</span></div>
      <h3>${esc(p.name)}</h3>
      <div class="p-spec">${esc(p.spec)}</div>
      <div class="p-tags">${(p.tags || []).map(t => `<span class="badge${t === "人気" ? " warn" : ""}">${esc(t)}</span>`).join("")}</div>
      <div class="p-foot">
        <div><span class="price">${yen(p.price)}</span><span class="muted small"> /${esc(p.unit)}(税抜・仮)</span></div>
        <div class="p-add"><input type="number" min="1" value="1" aria-label="数量"><button type="button" class="btn sm" data-add="${esc(p.id)}">見積リストへ</button></div>
      </div>
    </article>`).join("") : `<p class="muted">該当する資材がありません。キーワードを変えてお試しください。</p>`;
}
chips.addEventListener("click", e => { const b = e.target.closest("[data-cat]"); if (!b) return; state.cat = b.dataset.cat; history.replaceState(null, "", state.cat === "all" ? location.pathname : `#cat=${state.cat}`); render(); });
q.addEventListener("input", () => { state.q = q.value; render(); });
grid.addEventListener("click", e => {
  const b = e.target.closest("[data-add]"); if (!b) return;
  const p = PRODUCTS.find(x => x.id === b.dataset.add); const qty = parseInt(b.parentElement.querySelector("input").value, 10) || 1;
  if (p) addToQuoteList(p, qty);
});
window.addEventListener("hashchange", () => { readHash(); render(); });
readHash(); render();
