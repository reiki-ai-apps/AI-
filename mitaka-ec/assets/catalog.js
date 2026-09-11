// 資材をさがす: 困りごとタイル・6つの棚・検索(ひらがな/声)・詳細シート・かご
import { CONFIG } from "./config.js";
import { initSite, addToQuoteList, flyToCart, esc, yen, toast } from "./site.js";
import { CATEGORIES, PRODUCTS, MAKERS, SHELVES, PURPOSES, KANA, shelfOf } from "./catalog-data.js";
import { ICONS } from "./icons.js";
import { figure, keySpec, watchPhotos } from "./figures.js";
import { attachVoiceSearch } from "./voice.js";

initSite();
const $ = s => document.querySelector(s);
const makerLabel = id => (MAKERS.find(m => m.id === id) || {}).label || "";
const catLabel = id => (CATEGORIES.find(c => c.id === id) || {}).label || "";
const state = { mode: "browse", shelf: null, purpose: null, cat: null, maker: "all", q: "" };

// ---- 検索用の正規化(カタカナ→ひらがな、全角英数→半角) ----
const norm = s => String(s || "").toLowerCase().replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60)).replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/[\s　・,、。]/g, "");
const index = new Map(PRODUCTS.map(p => [p.id, norm([p.name, p.spec, p.use, KANA[p.id], makerLabel(p.maker), catLabel(p.cat), ...(p.tags || []), p.id].join(" "))]));
const unitWord = p => ({ 本: "1本", 袋: "1袋", 箱: "1箱", 個: "1個", 台: "1台", 巻: "1巻", セット: "1セット", 組: "1組", m: "1mあたり", "m²": "1m²あたり", 式: "一式", か所: "1か所", 枚: "1枚" })[p.unit] || `1${p.unit}`;

// ---- カード ----
function card(p) {
  const hot = (p.tags || []).includes("人気");
  const pills = (p.tags || []).filter(t => t !== "人気").slice(0, 2);
  return `<article class="pcard" data-id="${esc(p.id)}">
    <a class="pcard-fig" href="product.html?id=${encodeURIComponent(p.id)}" aria-label="${esc(p.name)} をくわしく見る" style="display:block">${figure(p)}${hot ? `<span class="hot">人気</span>` : ""}</a>
    <div class="pcard-body">
      <div class="pcard-maker">${esc(makerLabel(p.maker))}</div>
      <h3 class="pcard-name">${esc(p.name)}</h3>
      <p class="pcard-use">${esc(p.use || p.spec)}</p>
      ${p.price != null ? (() => { const pm = (p.spec || "").match(/(\d+)(個|本|枚)入/); const pk = pm ? Number(pm[1]) : 1; const inc = Math.round(p.price * 1.1); return `<div class="pcard-price"><span class="yen">¥</span>${inc.toLocaleString("ja-JP")}<small>税込 / ${esc(unitWord(p))}</small>${pk > 1 ? `<div class="per">${pk}${pm[2]}入 ・ 1${pm[2]}あたり約 ${yen(Math.round(inc / pk))}</div>` : ""}</div>`; })() : `<div class="pcard-price ask">${["pipe", "film", "door", "gutter", "curtain"].includes(p.cat) ? "ハウスのサイズで変わります" : "金額はご相談"}<small>${["pipe", "film", "door", "gutter", "curtain"].includes(p.cat) ? "→ 3Dで出す" : "すぐお答えします"}</small></div>`}
      <div class="pcard-pills">${pills.map(t => `<span class="pill">${esc(t)}</span>`).join("")}</div>
    </div>
    <div class="pcard-acts"><button class="btn accent" type="button" data-add="${esc(p.id)}" aria-label="${esc(p.name)} をかごに入れる"><span class="ic">${ICONS.basket}</span>かごに入れる</button><a class="btn ghost detail" href="product.html?id=${encodeURIComponent(p.id)}">くわしく</a></div>
  </article>`;
}

// ---- 一覧(棚モード) ----
function renderBrowse() {
  watchPhotos();
  $("#purposes").innerHTML = PURPOSES.map(x => x.link
    ? `<a class="purpose build" href="${x.link}"><span class="ic">${ICONS[x.icon]}</span><span>${esc(x.label)}</span></a>`
    : `<button class="purpose" type="button" data-purpose="${x.id}"><span class="ic">${ICONS[x.icon]}</span><span>${esc(x.label)}</span></button>`).join("");
  $("#hot").innerHTML = PRODUCTS.filter(p => (p.tags || []).includes("人気")).slice(0, 9).map(card).join("");
  $("#shelves").innerHTML = SHELVES.map(s => {
    const items = PRODUCTS.filter(p => s.cats.includes(p.cat));
    return `<section class="shelf" id="shelf-${s.id}" style="--shelf:${s.color};--shelf-bg:${s.color}14">
      <div class="shelf-head"><span class="ic">${ICONS[s.icon]}</span><div><h2>${esc(s.label)}</h2><div class="sub">${esc(s.sub)}</div></div><button class="more" type="button" data-shelf="${s.id}">すべて見る(${items.length})</button></div>
      <div class="shelf-body"><div class="rail">${items.slice(0, 6).map(card).join("")}</div></div>
    </section>`;
  }).join("");
  $("#side-nav").innerHTML = `<div class="grp">棚</div>` + SHELVES.map(s => `<a href="#shelf=${s.id}" data-nav-shelf="${s.id}" style="--shelf:${s.color}"><span class="ic" style="color:${s.color}">${ICONS[s.icon]}</span>${esc(s.label)}</a>`).join("") +
    `<div class="grp">困りごと</div>` + PURPOSES.filter(x => !x.link).map(x => `<a class="purpose-link" href="#purpose=${x.id}">${esc(x.label)}</a>`).join("");
}

// ---- 絞り込み結果 ----
function matches(p) {
  if (state.maker !== "all" && p.maker !== state.maker) return false;
  if (state.shelf) { const s = SHELVES.find(x => x.id === state.shelf); if (!s.cats.includes(p.cat)) return false; }
  if (state.cat && p.cat !== state.cat) return false;
  if (state.purpose) { const pu = PURPOSES.find(x => x.id === state.purpose); if (!(pu.cats.includes(p.cat) || (p.tags || []).some(t => pu.tags.includes(t)))) return false; }
  if (state.q) { const q = norm(state.q); if (!q.split("").length || !index.get(p.id).includes(q)) return false; }
  return true;
}
function renderResults() {
  const list = PRODUCTS.filter(matches);
  const s = SHELVES.find(x => x.id === state.shelf), pu = PURPOSES.find(x => x.id === state.purpose);
  $("#results-title").textContent = state.q ? `「${state.q}」で探しています` : pu ? pu.label : s ? `${s.label}の棚` : state.cat ? catLabel(state.cat) : state.maker !== "all" ? makerLabel(state.maker) : "すべて";
  $("#count").textContent = `${list.length}件`;
  $("#maker-chips").innerHTML = [{ id: "all", label: "全メーカー" }, ...MAKERS].map(m => `<button type="button" class="chip" data-maker="${m.id}" aria-pressed="${state.maker === m.id}">${esc(m.label)}</button>`).join("");
  $("#grid").innerHTML = list.length ? list.map(card).join("") : `<div class="empty"><p style="margin:0;font-weight:700">見つかりませんでした。</p><p class="muted" style="margin:.3rem 0 0">言い方を変えるか、お電話で聞いてみませんか？</p><a class="btn help" href="quote.html"><span class="ic">${ICONS.phone}</span>担当に聞く</a></div>`;
  document.querySelectorAll("[data-nav-shelf]").forEach(a => a.setAttribute("aria-current", String(a.dataset.navShelf === state.shelf)));
}
function apply() {
  const browsing = !state.shelf && !state.purpose && !state.cat && !state.q && state.maker === "all";
  state.mode = browsing ? "browse" : "results";
  $("#browse").hidden = !browsing; $("#results").hidden = browsing;
  if (!browsing) renderResults(); else document.querySelectorAll("[data-nav-shelf]").forEach(a => a.setAttribute("aria-current", "false"));
  const parts = []; if (state.shelf) parts.push(`shelf=${state.shelf}`); if (state.purpose) parts.push(`purpose=${state.purpose}`); if (state.cat) parts.push(`cat=${state.cat}`); if (state.maker !== "all") parts.push(`maker=${state.maker}`); if (state.q) parts.push(`q=${encodeURIComponent(state.q)}`);
  const hash = parts.length ? "#" + parts.join("&") : "";
  if (location.hash !== hash) history.replaceState(null, "", location.pathname + hash);
  $("#q-clear").hidden = !state.q;
}
function readHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ""));
  state.shelf = SHELVES.some(s => s.id === h.get("shelf")) ? h.get("shelf") : null;
  state.purpose = PURPOSES.some(p => p.id === h.get("purpose") && !p.link) ? h.get("purpose") : null;
  state.cat = CATEGORIES.some(c => c.id === h.get("cat")) ? h.get("cat") : null;
  state.maker = MAKERS.some(m => m.id === h.get("maker")) ? h.get("maker") : "all";
  state.q = h.get("q") || ""; $("#q").value = state.q;
}
function reset() { state.shelf = state.purpose = state.cat = null; state.maker = "all"; state.q = ""; $("#q").value = ""; apply(); window.scrollTo({ top: 0, behavior: "smooth" }); }

// ---- 詳細シート ----
const wrap = $("#sheet-wrap"), body = $("#sheet-body");
let sheetQty = 1, sheetProduct = null, lastFocus = null;
function openSheet(id) {
  const p = PRODUCTS.find(x => x.id === id); if (!p) return;
  sheetProduct = p; sheetQty = 1; lastFocus = document.activeElement;
  const related = PRODUCTS.filter(x => x.cat === p.cat && x.id !== p.id).slice(0, 4);
  body.innerHTML = `
    ${figure(p, true)}
    <div><h2 id="sheet-title">${esc(p.name)}</h2><div class="meta">${esc(makerLabel(p.maker))} / ${esc(catLabel(p.cat))} / 品番 ${esc(p.id)}(お電話のときにお伝えください)</div></div>
    <div class="use-box"><b>こんな時に使います</b>${esc(p.use || p.spec)}${p.note ? `<br><span class="muted small">${esc(p.note)}</span>` : ""}</div>
    <table class="spec"><tr><th>規格・サイズ</th><td>${esc(p.spec)}</td></tr><tr><th>売り方</th><td>${esc(unitWord(p))}${keySpec(p) ? ` / ${esc(keySpec(p))}` : ""}</td></tr>${(p.tags || []).length ? `<tr><th>特長</th><td>${p.tags.map(t => `<span class="pill">${esc(t)}</span>`).join(" ")}</td></tr>` : ""}</table>
    <div class="price-row">${p.price != null ? `<span class="big">${yen(Math.round(p.price * 1.1))}</span><small>税込 / ${esc(unitWord(p))}(税別 ${yen(p.price)})</small>` : `<span class="ask">金額はご相談</span><small>すぐお答えします</small>`}<small style="flex-basis:100%">表示はめやすです。正式な金額は担当がお見積りします。</small></div>
    <div class="qty-row"><span class="lbl">いくつ？</span><button type="button" id="qty-dec" aria-label="1つ減らす">−</button><span class="n" id="qty-n">1${esc(p.unit)}</span><button type="button" id="qty-inc" aria-label="1つ増やす">＋</button></div>
    <button class="btn accent add-big" type="button" id="sheet-add"><span class="ic">${ICONS.basket}</span>かごに入れる</button>
    <div class="help-row">
      <a class="btn help" href="${CONFIG.tel ? "tel:" + CONFIG.tel : "quote.html?item=" + encodeURIComponent(p.id)}"><span class="ic">${ICONS.phone}</span>電話で聞く</a>
      <a class="btn outline" href="quote.html?item=${encodeURIComponent(p.id)}"><span class="ic">${ICONS.camera}</span>写真を送って相談</a>
      <button class="btn ghost wide" type="button" id="sheet-confirm">これで合っているか、担当に見てもらう(かごに入れて要確認)</button>
    </div>
    ${related.length ? `<div><div class="sec-title" style="margin:.25rem 0 .5rem"><h2 style="font-size:1.05rem">同じ棚のほかの品</h2></div><div class="related">${related.map(r => `<button class="rel" type="button" data-detail="${esc(r.id)}">${figure(r)}<div class="nm">${esc(r.name)}</div></button>`).join("")}</div></div>` : ""}`;
  wrap.classList.add("open"); wrap.setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden";
  $("#sheet-close").focus();
  const setQty = q => { sheetQty = Math.max(1, q); $("#qty-n").textContent = `${sheetQty}${p.unit}`; };
  $("#qty-dec").onclick = () => setQty(sheetQty - 1); $("#qty-inc").onclick = () => setQty(sheetQty + 1);
  $("#sheet-add").onclick = e => { addToQuoteList(withMaker(p), sheetQty); flyToCart(body.querySelector(".fig")); closeSheet(); };
  $("#sheet-confirm").onclick = () => { addToQuoteList({ ...withMaker(p), confirm: true }, sheetQty); closeSheet(); };
}
function closeSheet() { wrap.classList.remove("open"); wrap.setAttribute("aria-hidden", "true"); document.body.style.overflow = ""; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
const withMaker = p => ({ ...p, name: `${p.name}${p.maker !== "generic" ? "(" + makerLabel(p.maker) + ")" : ""}` });
wrap.querySelector(".backdrop").addEventListener("click", closeSheet);
$("#sheet-close").addEventListener("click", closeSheet);
document.addEventListener("keydown", e => { if (e.key === "Escape" && wrap.classList.contains("open")) closeSheet(); });

// ---- イベント ----
document.addEventListener("click", e => {
  const add = e.target.closest("[data-add]");
  if (add) { const p = PRODUCTS.find(x => x.id === add.dataset.add); if (p) { addToQuoteList(withMaker(p), 1); flyToCart(add.closest(".pcard")?.querySelector(".fig")); } return; }
  const det = e.target.closest("[data-detail]"); if (det) { location.href = `product.html?id=${encodeURIComponent(det.dataset.detail)}`; return; }
  const pu = e.target.closest("[data-purpose]"); if (pu) { state.purpose = pu.dataset.purpose; state.shelf = null; state.cat = null; state.q = ""; $("#q").value = ""; apply(); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  const sh = e.target.closest("[data-shelf]"); if (sh) { state.shelf = sh.dataset.shelf; state.purpose = null; state.cat = null; state.q = ""; $("#q").value = ""; apply(); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  const mk = e.target.closest("[data-maker]"); if (mk) { state.maker = mk.dataset.maker; apply(); return; }
});
$("#back-all").addEventListener("click", reset);
$("#q-clear").addEventListener("click", () => { state.q = ""; $("#q").value = ""; apply(); $("#q").focus(); });
let qt; $("#q").addEventListener("input", () => { clearTimeout(qt); qt = setTimeout(() => { state.q = $("#q").value.trim(); if (state.q) { state.shelf = state.purpose = state.cat = null; } apply(); }, 150); });
$("#q").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("#q").blur(); } });
$("#mic").innerHTML = ICONS.mic;
if (innerWidth < 480) $("#q").placeholder = "何をお探しですか？";
document.querySelectorAll("[data-icon]").forEach(el => { el.innerHTML = ICONS[el.dataset.icon] || ""; });
attachVoiceSearch($("#q"), $("#mic"), t => { state.q = t; state.shelf = state.purpose = state.cat = null; apply(); toast(`「${t}」で探しています`); });
if (CONFIG.tel) $("#tel-btn").href = `tel:${CONFIG.tel}`;
window.addEventListener("hashchange", () => { readHash(); apply(); });

renderBrowse(); readHash(); apply();
