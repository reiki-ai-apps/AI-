// 商品1点ページ: 写真 / 使う場所(3D) / 税込価格 / 数量 / かご / 一緒に使うもの / カルテ帯 / 固定バー
import { CONFIG } from "./config.js";
import { initSite, addToQuoteList, flyToCart, esc, yen, toast } from "./site.js";
import { PRODUCTS, MAKERS, SHELVES, shelfOf } from "./catalog-data.js";
import { ICONS } from "./icons.js";
import { figure, keySpec, shapeOf, photoSrc, watchPhotos, isRealPhoto } from "./figures.js";
import { partOf, PART_LABEL, sceneFor, companions, fitText, tipFor, catLabel } from "./product-data.js";
import { estimate, normalizeParams } from "./pricing.js";

initSite();
const $ = s => document.querySelector(s);
const id = new URLSearchParams(location.search).get("id");
const p = PRODUCTS.find(x => x.id === id);
if (!p) { $("#pd").innerHTML = `<div class="notfound"><h1>見つかりませんでした</h1><p class="muted">この商品は移動または削除された可能性があります。</p><a class="btn" href="catalog.html">資材をさがすへ</a></div>`; throw new Error("product not found");
}
const shelf = shelfOf(p.cat), maker = (MAKERS.find(m => m.id === p.maker) || {}).label || "";
const packM = (p.spec || "").match(/(\d+)(個|本|枚)入/); const pack = packM ? Number(packM[1]) : 1; const packUnit = packM ? packM[2] : null;
const unitWord = ({ 本: "1本", 袋: "1袋", 箱: "1箱", 個: "1個", 台: "1台", 巻: "1巻", セット: "1セット", 組: "1組", m: "1m", "m²": "1m²", 式: "一式", か所: "1か所", 枚: "1枚" })[p.unit] || `1${p.unit}`;
const incl = p.price != null ? Math.round(p.price * 1.1) : null;
const per = incl && pack > 1 ? Math.round(incl / pack) : null;
document.title = `${p.name}｜三高産業 ハウスEC`;
import("./store.js").then(m => m.logEc("product_view", { productCode: p.id })).catch(() => {});
document.documentElement.style.setProperty("--shelf", shelf.color);

// ---- 見出し(スマホは上、PCは購入パネル内) ----
const headHtml = `<div><span class="shelf-badge" style="--shelf:${shelf.color}">${esc(shelf.label)}</span><span class="maker">${esc(maker)}</span></div><h1>${esc(p.name)}</h1><p class="use">${esc(p.use || p.spec)}</p>`;
$("#head-sp").innerHTML = headHtml;
$("#pd-crumb").innerHTML = `<a href="index.html">トップ</a> › <a href="catalog.html">資材をさがす</a> › <a href="catalog.html#shelf=${shelf.id}">${esc(shelf.label)}</a> › ${esc(p.name)}`;

// ---- 商品写真(大) ----
function compareText() {
  const s = p.name + " " + p.spec, out = [];
  const dia = s.match(/φ(\d+(?:\.\d+)?)/); if (dia) { const d = Number(dia[1]); out.push(d >= 31 ? `φ${d} は500円玉より約1cm太い` : d >= 25 ? `φ${d} は500円玉(2.65cm)とほぼ同じ太さ` : d >= 22 ? `φ${d} は500円玉より少し細い` : `φ${d} は10円玉(2.35cm)より細い`); }
  const len = s.match(/(?:^|[^\d.])(\d+(?:\.\d+)?)m(?![m0-9])/); if (len && !/mまで/.test(s)) { const L = Number(len[1]); if (L >= 100) out.push(`${L}m は 50mプール${(L / 50).toFixed(L % 50 ? 1 : 0)}本分`); else if (L >= 3) out.push(`${L}m は 軽トラの荷台(約1.9m)${Math.round(L / 1.9)}台分`); }
  const w = s.match(/幅(\d+)cm/); if (w) out.push(`幅${w[1]}cm は 間口${(Number(w[1]) / 100).toFixed(1)}mのハウスをまたぐ幅`);
  return out.slice(0, 2).join(" ／ ");
}
const key = keySpec(p);
watchPhotos();
$("#pane-fig").classList.add("has-photo");
$("#pane-fig").innerHTML = `<div class="bigfig photo" style="--shelf:${shelf.color}">
  <img class="fig-img" src="${photoSrc(p)}" alt="${esc(p.name)} ${esc(key)} の${isRealPhoto(p) ? "写真" : "イメージ図"}" width="1200" height="900" decoding="async">
  ${isRealPhoto(p) ? "" : `<span class="fig-note">イメージ図</span>`}
  ${key ? `<div class="guide"><span>${esc(key)}</span></div>` : ""}
  ${pack > 1 && pack <= 100 ? `<div class="dots" aria-hidden="true">${Array.from({ length: pack }, () => "<i></i>").join("")}</div>` : ""}
  <span class="fig-ic">${ICONS[shapeOf(p)] || ICONS.cube}</span>
  <span class="shelf-badge">${esc(shelf.label)}</span>
  ${key ? `<div class="key">${esc(key)}</div>` : ""}
</div>`;
{
  const ct = compareText();
  $("#pane-3d").insertAdjacentHTML("afterend",
    (ct ? `<div class="fig-caption">${ct.split(" ／ ").map(t => `<span>${esc(t)}</span>`).join("")}</div>` : "") +
    (isRealPhoto(p)
      ? ""
      : `<p class="photo-note">この画像は規格の寸法から起こした<b>イメージ図</b>です。実物の写真ではありません。${p.maker !== "generic" ? "メーカーの商品写真を手配中です。" : ""}実物をご確認のうえご注文ください。<a href="quote.html">担当に聞く</a></p>`));
}

// ---- 使う場所(3D)。タブを開いたときに初めて読み込む ----
let viewer = null;
const scene = sceneFor(p);
$("#where").textContent = `ここに使います: ${PART_LABEL[scene.part] || ""}`;
async function ensure3d() {
  if (viewer) return;
  const { createViewer } = await import("./house3d.js");
  viewer = createViewer($("#pd3d"), { showcase: true, parts: true, transparent: true, fog: 0, fov: 34, interactive: true, zoomFactor: 0.8, maxPixelRatio: 1.5 });
  const last = readKarte(); const h = last && last.houses && last.houses[0];
  const params = normalizeParams({ ...scene.params, ...(h ? { span: h.params.span, length: Math.min(h.params.length, 30), pipe: h.params.pipe, eave: h.params.eave, ridge: h.params.ridge } : {}) });
  viewer.update(estimate(params)); viewer.setView(scene.view); setTimeout(() => viewer.highlight(scene.part), 250);
}
document.querySelectorAll("[role=tab]").forEach(b => b.addEventListener("click", async () => {
  document.querySelectorAll("[role=tab]").forEach(x => x.setAttribute("aria-selected", String(x === b)));
  $("#pane-fig").hidden = b.dataset.tab !== "fig"; $("#pane-3d").hidden = b.dataset.tab !== "3d";
  if (b.dataset.tab === "3d") await ensure3d();
}));

// ---- カルテ帯 ----
function readKarte() { try { return JSON.parse(localStorage.getItem("mitaka-karte-last") || "null"); } catch { return null; } }
(function karteBand() {
  const k = readKarte(), dia = (p.name + " " + p.spec).match(/φ(\d+(?:\.\d+)?)/);
  const el = $("#karte-band");
  if (!k || !k.houses?.length) { el.innerHTML = `<a class="karte-link" href="karte.html">お客様コードをお持ちの方はこちら(あなたのハウスに合うか表示します)</a>`; return; }
  if (!dia) { el.innerHTML = `<div class="karte-band"><b>${esc(k.farmName || k.name)}様のハウスカルテ</b> 見積依頼のときに、ハウスの大きさから数量を計算します。<a href="karte.html?c=${esc(k.code)}">カルテを見る</a></div>`; return; }
  const d = Number(dia[1]); const fits = k.houses.filter(h => Number(h.params.pipe) === d), miss = k.houses.filter(h => Number(h.params.pipe) !== d);
  if (fits.length) el.innerHTML = `<div class="karte-band"><b>${esc(k.farmName || k.name)}様の${esc(fits.map(h => h.name).join("・"))}ハウス(φ${d})に合います</b>${miss.length ? `<span class="muted">${esc(miss.map(h => h.name).join("・"))}は別の径です</span>` : ""}<a href="karte.html?c=${esc(k.code)}">カルテを見る</a></div>`;
  else el.innerHTML = `<div class="karte-band no"><b>${esc(k.houses[0].name)}ハウスは φ${k.houses[0].params.pipe} です。この品は φ${d} 用です。</b><a href="catalog.html#q=${encodeURIComponent("φ" + k.houses[0].params.pipe)}">φ${k.houses[0].params.pipe} のものを見る</a></div>`;
})();

// ---- 購入パネル ----
let qty = 1;
const structural = ["pipe", "film", "door", "gutter", "curtain"].includes(p.cat);
const alt = PRODUCTS.find(q => q.id !== p.id && q.name === p.name && q.maker === p.maker && ((q.spec.match(/(\d+)(個|本|枚)入/) || [])[1] || "1") !== String(pack));
const altPack = alt ? Number((alt.spec.match(/(\d+)(個|本|枚)入/) || [])[1] || 1) : 0;
$("#buy").innerHTML = `
  <div class="pd-head">${headHtml}</div>
  ${incl != null ? `<div class="price-main" aria-label="税込${incl}円 ${esc(unitWord)}あたり"><span class="incl"><span class="yen">¥</span>${incl.toLocaleString("ja-JP")}</span><span class="tax">税込 / ${esc(unitWord)}${pack > 1 ? `(${pack}${packUnit}入)` : ""}</span></div>
    <div class="price-sub">税別 ${yen(p.price)}${per ? ` ・ 1${packUnit}あたり約 ${yen(per)}` : ""}</div>
    <p class="price-note">表示はめやすです。正式な金額は担当がお見積りします。</p>`
  : `<div class="price-ask" style="margin-top:12px"><span class="ask">金額はご相談</span><p>${structural ? "ハウスのサイズで変わります。伺って、その日のうちにお返しします。" : "その日のうちにお返しします。"}${structural ? ` <a href="simulator.html">3Dで概算を出す</a>` : ""}</p></div>`}
  <span class="one-from">${esc(unitWord)}からで大丈夫です</span>
  <div class="qty"><span class="lbl">いくつ？</span><button type="button" id="dec" aria-label="1つ減らす">−</button><output id="qty" aria-live="polite">1${esc(p.unit)}</output><button type="button" id="inc" aria-label="1つ増やす">＋</button>${pack > 1 ? `<span class="pack">${esc(unitWord)}=${pack}${packUnit}入</span>` : ""}</div>
  <button class="cta-main" type="button" id="cta-main"><span class="ic">${ICONS.basket}</span>かごに入れる</button>
  <div class="second">
    <a class="btn help" href="${CONFIG.tel ? "tel:" + CONFIG.tel : "quote.html?item=" + encodeURIComponent(p.id)}"><span class="ic">${ICONS.phone}</span>電話で聞く</a>
    <a class="btn outline" href="quote.html?item=${encodeURIComponent(p.id)}"><span class="ic">${ICONS.camera}</span>写真を送って相談</a>
    <button class="btn ghost wide" type="button" id="confirm">これで合っているか、担当に見てもらう</button>
  </div>
  <div class="delivery">
    <div class="row"><span class="ic">${ICONS.truck}</span><div>${p.maker === "generic" ? "<b>桐生の倉庫にあるものは、午前のご注文で当日お渡し。</b>配達は群馬県内で翌日〜3日が目安です。" : "<b>メーカー取り寄せです。</b>担当が納期を確認して、その日のうちにご連絡します。"}</div></div>
    <div class="row"><span class="ic">${ICONS.pin || ICONS.build}</span><div>受け取りは <b>桐生の店頭</b>、<b>配達</b>、<b>現場直送</b> から選べます。見積依頼のときにお選びください。</div></div>
  </div>
  ${alt ? `<div class="bulk"><div>${altPack > pack ? `<b>${altPack}${packUnit}入(${esc(alt.unit)})</b>なら ${alt.price != null ? `1${packUnit}あたり約 ${yen(Math.round(alt.price * 1.1 / altPack))}${per ? `(${Math.round((1 - (alt.price * 1.1 / altPack) / per) * 100)}%お得)` : ""}` : "まとめ買いもご相談ください"}` : `少量なら <b>${altPack}${packUnit}入</b> もあります`}</div><a class="btn ghost" href="product.html?id=${esc(alt.id)}">${altPack > pack ? "箱で見る" : "少量で見る"}</a></div>` : ""}`;
const out = $("#qty");
const setQty = v => { qty = Math.max(1, v); out.textContent = `${qty}${p.unit}`; };
$("#dec").addEventListener("click", () => setQty(qty - 1)); $("#inc").addEventListener("click", () => setQty(qty + 1));
const item = { ...p, name: `${p.name}${p.maker !== "generic" ? "(" + maker + ")" : ""}` };
function addMain(btn, confirm = false) {
  addToQuoteList(confirm ? { ...item, confirm: true } : item, qty); flyToCart($("#pane-fig").hidden ? $("#pane-3d") : $("#pane-fig"));
  btn.classList.add("done"); const html = btn.innerHTML; btn.innerHTML = "入れました ✓"; setTimeout(() => { btn.classList.remove("done"); btn.innerHTML = html; }, 900);
}
$("#cta-main").addEventListener("click", e => addMain(e.currentTarget));
$("#confirm").addEventListener("click", e => addMain(e.currentTarget, true));

// ---- 信頼ブロック ----
const dia = (p.name + " " + p.spec).match(/φ(\d+(?:\.\d+)?)/); const d = dia ? Number(dia[1]) : null;
$("#blk-use").innerHTML = `<h2>こんな時に使います</h2><p class="lead">${esc(p.use || p.spec)}${p.note ? `<br><span class="muted">${esc(p.note)}</span>` : ""}</p>`;
$("#blk-spec").innerHTML = `<h2>大きさと売り方</h2><table class="spec-table"><tr><th>規格・サイズ</th><td>${esc(p.spec)}</td></tr><tr><th>売り方</th><td>${esc(unitWord)}${pack > 1 ? `(${pack}${packUnit}入)` : ""}${key ? ` ／ ${esc(key)}` : ""}</td></tr>${d ? `<tr><th>合うパイプ径</th><td>φ${d}mm</td></tr>` : ""}<tr><th>棚</th><td>${esc(shelf.label)} › ${esc(catLabel(p.cat))}</td></tr><tr><th>メーカー</th><td>${esc(maker)}</td></tr><tr><th>品番</th><td>${esc(p.id)} <span class="muted small">(お電話のときにお伝えください)</span></td></tr></table>`;
const fitBlock = fitText(p);
$("#blk-fit").innerHTML = fitBlock ? `<h2>合うかどうか</h2>${d && ["joint", "fastener", "reinforce"].includes(p.cat) ? `<div class="fit-chips">${[19.1, 22.2, 25.4, 31.8].map(x => `<span class="${x === d ? "ok" : "ng"}">φ${x}${x === d ? " 合います" : " 入りません"}</span>`).join("")}</div>` : ""}<p class="fit-text">${esc(fitBlock)}</p>` : "";
const comp = companions(p).slice(0, 3);
$("#blk-with").innerHTML = comp.length ? `<h2>これと一緒に使うもの</h2><div class="with-list">${comp.map(q => `<label class="with-item"><input type="checkbox" checked data-with="${esc(q.id)}" aria-label="${esc(q.name)}をまとめて入れる">${figure(q)}<div><div class="nm"><a href="product.html?id=${esc(q.id)}">${esc(q.name)}</a></div><div class="sp">${esc(q.use || q.spec)}</div></div><div class="pr">${q.price != null ? yen(Math.round(q.price * 1.1)) + `<small class="muted"> 税込</small>` : `<span class="muted small">金額はご相談</span>`}</div></label>`).join("")}</div><button class="btn accent block with-all" type="button" id="with-all">チェックした品も、まとめてかごへ</button>` : "";
$("#with-all")?.addEventListener("click", () => { const ids = [...document.querySelectorAll("[data-with]:checked")].map(x => x.dataset.with); addToQuoteList(item, qty); for (const wid of ids) { const q = PRODUCTS.find(x => x.id === wid); if (q) addToQuoteList({ ...q, name: `${q.name}${q.maker !== "generic" ? "(" + ((MAKERS.find(m => m.id === q.maker) || {}).label || "") + ")" : ""}` }, 1); } toast(`${1 + ids.length}点をかごに入れました ✓`); });
const tip = tipFor(p);
$("#blk-tip").innerHTML = tip ? `<h2>施工班のひとこと</h2><div class="tip-card">${esc(tip)}<span class="who">— 三高産業 施工班(下書き。担当者名を入れてください)</span></div>` : "";
$("#blk-faq").innerHTML = `<h2>よくあるご質問</h2>
  <details><summary>いつ届きますか？</summary><p>${p.maker === "generic" ? "桐生の倉庫にあるものは、午前のご注文で当日お渡しできます。配達は群馬県内で翌日〜3日が目安です。" : "メーカー取り寄せです。3日〜7日ほど。急ぎのときは電話でご相談ください。"}</p></details>
  <details><summary>違うものを頼んでしまったら？</summary><p>開けていない袋・箱は、届いてから7日以内なら引き取ります。送料はご相談ください。「これで合っているか、担当に見てもらう」を押しておくと、注文前に担当が確認します。</p></details>
  <details><summary>取り付けも頼めますか？</summary><p>頼めます。見積依頼のときに「施工も希望」とお書きください。群馬県内と隣接県は自社の施工班が伺います。</p></details>`;
const related = PRODUCTS.filter(q => shelf.cats.includes(q.cat) && q.id !== p.id && !comp.includes(q)).slice(0, 8);
$("#blk-related").innerHTML = related.length ? `<h2>${esc(shelf.label)}の棚の、ほかの品</h2><div class="rail">${related.map(q => `<article class="pcard"><a class="pcard-fig" href="product.html?id=${esc(q.id)}" style="display:block">${figure(q)}</a><div class="pcard-body"><div class="pcard-maker">${esc((MAKERS.find(m => m.id === q.maker) || {}).label || "")}</div><h3 class="pcard-name">${esc(q.name)}</h3><p class="pcard-use">${esc(q.use || q.spec)}</p>${q.price != null ? `<div class="pcard-price"><span class="yen">¥</span>${Math.round(q.price * 1.1).toLocaleString("ja-JP")}<small>税込</small></div>` : `<div class="pcard-price ask">金額はご相談</div>`}</div><div class="pcard-acts"><a class="btn ghost" href="product.html?id=${esc(q.id)}">くわしく</a></div></article>`).join("")}</div>` : "";
if (CONFIG.tel) $("#pb-tel").href = `tel:${CONFIG.tel}`;

// ---- 固定バー(スマホ) ----
const sticky = $("#sticky");
sticky.innerHTML = `<div class="p">${incl != null ? `¥${incl.toLocaleString("ja-JP")}<small>税込 / ${esc(unitWord)}</small>` : `金額はご相談<small>その日のうちにお返しします</small>`}</div><button class="cta-main" type="button" id="cta-sticky"><span class="ic">${ICONS.basket}</span>かごに入れる</button>`;
$("#cta-sticky").addEventListener("click", e => addMain(e.currentTarget));
const sio = new IntersectionObserver(es => { const vis = es[0].isIntersecting; sticky.classList.toggle("show", !vis); sticky.setAttribute("aria-hidden", String(vis)); document.body.classList.toggle("sticky-on", !vis); }, { rootMargin: "-80px 0px 0px 0px" });
sio.observe($("#cta-main"));

// ---- 出現 ----
const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }, { rootMargin: "0px 0px 40% 0px" });
document.querySelectorAll(".pd .reveal").forEach((el, i) => { el.style.transitionDelay = `${Math.min(i, 4) * 60}ms`; io.observe(el); });
setTimeout(() => document.querySelectorAll(".pd .reveal:not(.in)").forEach(el => el.classList.add("in")), 1500);
