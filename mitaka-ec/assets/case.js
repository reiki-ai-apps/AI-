// 施工事例から見積る ── Instagramで見た「No.」を入れると、その現場の写真と仕様が出て、
// 自分の畑(場所・大きさ・棟数・被覆材・設備)に合わせた概算がその場で出る。
// 新しい見積計算は作らない: 事例の params を初期値にして pricing.js の estimate() に渡すだけ。
// 「この条件で相談する」は quote.html に ?case=No.&count=&params を渡す(保存はそちらで行う)。
import { initSite, toast, copyText, esc, yen } from "./site.js";
import { store, normCaseNo, logEc } from "./store.js";
import { OPTIONS, estimateCase, normalizeParams, encodeParams, decodeParams, PRICING_VERSION } from "./pricing.js";
import { PRODUCTS } from "./catalog-data.js";
import { photoSrc } from "./figures.js";

initSite();
const $ = s => document.querySelector(s);
const label = (list, id) => (list.find(x => x.id === id) || {}).label || id;
const filmShort = id => ({ novi010: "農ビ(単年張り)", po015: "農PO(3年張り)", po_multi: "長持ちPO(5年以上)", po_diffuse: "散乱光PO(梨地)" }[id] || label(OPTIONS.films, id));

let current = null;           // いま開いている事例
let base = null;              // 事例の初期パラメータ
const state = { params: null, count: 1 };

// ---------------- 番号の入力 ----------------
function showMsg(head, body, tel = true) {
  const box = $("#no-msg"); box.hidden = false;
  box.innerHTML = `<b>${esc(head)}</b><span>${esc(body)}</span>${tel ? `<div class="mt-2"><a class="btn sm" href="quote.html">電話・フォームで聞く</a></div>` : ""}`;
}
async function openByNo(raw, push = true) {
  const no = normCaseNo(raw);
  if (!no) { showMsg("番号が読み取れませんでした", "投稿にある「No.」の数字だけを入れてください(例: 125)。", false); return; }
  const c = await store.getCaseByNo(no);
  if (!c) { showMsg(`No.${no} の事例は見つかりません`, "投稿の番号をもう一度ご確認ください。番号が分からない時は、下の一覧からも選べます。お電話でもお答えします。"); $("#case").hidden = true; return; }
  if (c.hidden || c.status !== "public") { showMsg(`No.${no} の事例は現在公開していません`, "施主様のご都合で取り下げている場合があります。同じ形のハウスの概算は、お電話でお伝えできます。"); $("#case").hidden = true; return; }
  $("#no-msg").hidden = true;
  $("#no-input").value = no;
  if (push) history.replaceState(null, "", `?no=${no}`);
  renderCase(c);
  logEc("case_view", { ref: `case:${no}` });
}
$("#no-form").addEventListener("submit", e => { e.preventDefault(); openByNo($("#no-input").value); });

// ---------------- 事例の表示 ----------------
function renderCase(c) {
  current = c;
  base = normalizeParams(c.params || { span: c.span, length: c.length, film: c.film });
  const q = new URLSearchParams(location.search);
  const fromUrl = decodeParams(location.search);
  state.params = fromUrl || { ...base };
  state.count = Math.max(1, Math.min(20, Number(q.get("count")) || Number(c.count) || 1));

  const photos = (c.photos || []).filter(Boolean);
  const cover = photos[0] || "assets/photo/farm-dawn.jpg";
  const note = c.demo ? "デモの事例です。写真はイメージです" : "写真はイノウエグリーンハウスの施工現場です。施主様の許可を得て掲載しています";
  $("#cover").innerHTML = `<img src="${esc(cover)}" alt="${esc(c.title || "施工事例")}" decoding="async"><span class="tag">No.${esc(c.no)}</span><span class="photo-note">${esc(note)}</span>`;
  $("#c-eyebrow").textContent = `Case No.${c.no}${c.area ? " ・ " + c.area : ""}${c.builtOn ? " ・ " + c.builtOn.replace("-", "年") + "月 施工" : ""}`;
  $("#c-title").textContent = c.title || `${c.crop || "ハウス"}の施工事例`;
  $("#c-line").textContent = `間口${base.span}m × 奥行${base.length}m × ${c.count || 1}棟 ／ ${filmShort(base.film)} ／ ${c.houseType || "パイプハウス"}`;
  $("#photos").innerHTML = photos.slice(1).map(p => `<figure><img src="${esc(p)}" alt="" loading="lazy" decoding="async"></figure>`).join("");
  const pipe = label(OPTIONS.pipes.map(x => ({ id: x.d, label: x.label })), base.pipe);
  const floor = Math.round(base.span * base.length * (c.count || 1));
  $("#spec").innerHTML = [
    ["公開地域", c.area || "-"], ["作物", c.crop || "-"], ["ハウスの種類", c.houseType || "パイプハウス"],
    ["間口 × 奥行", `${base.span}m × ${base.length}m`], ["棟数", `${c.count || 1}棟`], ["面積(床)", `約${floor}m²(約${Math.round(floor / 3.3)}坪)`],
    ["アーチ間隔", `${Math.round(base.pitch * 100)}cm`], ["パイプ径", pipe], ["肩高 / 棟高", `${base.eave}m / ${base.ridge}m`],
    ["被覆資材", filmShort(base.film)], ["設備", (c.equipment || []).join("・") || "-"]
  ].map(([k, v]) => `<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join("");
  $("#c-note").textContent = c.note || "";

  // 使った資材 → 商品ページ
  const parts = (c.parts || []).map(p => ({ ...p, prod: PRODUCTS.find(x => x.id === p.id) })).filter(p => p.prod);
  $("#parts").hidden = !parts.length;
  $("#parts-list").innerHTML = parts.map(p => `<a href="product.html?id=${encodeURIComponent(p.id)}"><span class="fig"><img src="${esc(photoSrc(p.prod))}" alt="" loading="lazy"></span><span><span class="nm">${esc(p.prod.name)}</span><br><span class="q">${esc(p.prod.spec)}${p.qty ? ` ／ ${p.qty}${esc(p.prod.unit)}` : ""}</span></span></a>`).join("");

  // 概算の基準が無い(情報不足)時は、概算の代わりに電話案内
  const canEstimate = !!c.params;
  $("#adjust").hidden = !canEstimate;
  if (!canEstimate) showMsg("この事例は概算の基準が未登録です", "写真と仕様はご覧いただけます。同じ形での概算は、お電話でお伝えします。");
  else renderAdjust();

  $("#case").hidden = false;
  document.title = `施工事例 No.${c.no} ${c.title || ""}｜イノウエグリーンハウス ハウスEC`;
  $("#case").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------- 自分の畑に合わせる ----------------
function renderAdjust() {
  const p = state.params;
  const opt = (list, v, fmt = x => x.label, val = x => x.id) => list.map(x => `<option value="${esc(val(x))}"${String(val(x)) === String(v) ? " selected" : ""}>${esc(fmt(x))}</option>`).join("");
  const chg = (key, cur, was) => `<span class="chg${String(cur) !== String(was) ? " on" : ""}" data-chg="${key}">${String(cur) !== String(was) ? `事例は ${esc(was)}` : "事例のまま"}</span>`;
  $("#adj").innerHTML = `
    <label>建設予定地<select data-k="region">${opt(OPTIONS.regions, p.region)}</select>${chg("region", label(OPTIONS.regions, p.region), label(OPTIONS.regions, base.region))}</label>
    <label>間口<select data-k="span">${opt(OPTIONS.spans.map(v => ({ id: v, label: v + " m" })), p.span)}</select>${chg("span", p.span + "m", base.span + "m")}</label>
    <label>奥行(m)<input data-k="length" type="number" inputmode="numeric" min="5" max="100" step="1" value="${p.length}">${chg("length", p.length + "m", base.length + "m")}</label>
    <label>棟数<select data-k="count">${opt(Array.from({ length: 10 }, (_, i) => ({ id: i + 1, label: (i + 1) + " 棟" })), state.count)}</select>${chg("count", state.count + "棟", (current.count || 1) + "棟")}</label>
    <label>被覆資材<select data-k="film">${opt(OPTIONS.films, p.film, x => filmShort(x.id))}</select>${chg("film", filmShort(p.film), filmShort(base.film))}</label>
    <label>側面の巻き上げ<select data-k="ventDrive">${opt(OPTIONS.drives, p.ventDrive)}</select>${chg("ventDrive", label(OPTIONS.drives, p.ventDrive), label(OPTIONS.drives, base.ventDrive))}</label>
    <label>内張カーテン<select data-k="curtain">${opt(OPTIONS.curtains, p.curtain)}</select>${chg("curtain", label(OPTIONS.curtains, p.curtain), label(OPTIONS.curtains, base.curtain))}</label>
    <label>水やり<select data-k="irrigation">${opt(OPTIONS.irrigations, p.irrigation)}</select>${chg("irrigation", label(OPTIONS.irrigations, p.irrigation), label(OPTIONS.irrigations, base.irrigation))}</label>
    <label>施工<select data-k="install">${opt(OPTIONS.installs, p.install)}</select>${chg("install", label(OPTIONS.installs, p.install), label(OPTIONS.installs, base.install))}</label>`;
  renderEstimate();
}
$("#adj").addEventListener("change", e => {
  const el = e.target.closest("[data-k]"); if (!el) return;
  if (el.dataset.k === "count") state.count = Number(el.value);
  else { const raw = { ...state.params, [el.dataset.k]: el.value }; state.params = normalizeParams(raw); }
  renderAdjust();
  history.replaceState(null, "", `?no=${current.no}&count=${state.count}&${encodeParams(state.params)}`);
});
$("#adj").addEventListener("input", e => { if (e.target.dataset.k === "length") { const v = Number(e.target.value); if (v >= 5 && v <= 100) { state.params = normalizeParams({ ...state.params, length: v }); renderEstimate(); } } });

function renderEstimate() {
  const r = estimateCase(state.params, state.count);
  const p = state.params;
  $("#est").innerHTML = `
    <div><small>本体と張るもの(${r.count}棟)</small><b>${yen(r.materials)}</b></div>
    <div><small>運搬・施工</small><b>${r.unresolved ? "要確認" : yen(r.work)}</b></div>
    <div class="total"><small>合計(税込)・概算・現地確認前</small><b>${r.unresolved ? "要確認" : yen(r.total)}</b></div>`;
  $("#est-note").textContent = r.unresolved
    ? "群馬県外(隣接県以外)は運搬費・施工費を作れません。この分は電話で決めます。本体と張るものの金額は目安としてご覧ください。"
    : `${p.install === "full" ? "施工込み" : "資材のみ(お客様施工)"}。${PRICING_VERSION}による概算で、地盤・積雪・風の条件で変わります。現地確認のうえ正式にお見積りします。`;
  const changes = [];
  if (p.span !== base.span) changes.push(`間口 ${base.span}m→${p.span}m`);
  if (p.length !== base.length) changes.push(`奥行 ${base.length}m→${p.length}m`);
  if (state.count !== (current.count || 1)) changes.push(`棟数 ${current.count || 1}→${state.count}`);
  if (p.film !== base.film) changes.push(`被覆材 ${filmShort(base.film)}→${filmShort(p.film)}`);
  if (p.region !== base.region) changes.push(`地域 ${label(OPTIONS.regions, p.region)}`);
  if (p.ventDrive !== base.ventDrive) changes.push(`巻き上げ ${label(OPTIONS.drives, p.ventDrive)}`);
  if (p.curtain !== base.curtain) changes.push(`カーテン ${label(OPTIONS.curtains, p.curtain)}`);
  if (p.irrigation !== base.irrigation) changes.push(`水やり ${label(OPTIONS.irrigations, p.irrigation)}`);
  if (p.install !== base.install) changes.push(label(OPTIONS.installs, p.install));
  $("#basis-body").innerHTML = `
    <dl>
      <dt>基準</dt><dd>施工事例 No.${esc(current.no)}(${esc(current.area || "")} 間口${base.span}m×奥行${base.length}m×${current.count || 1}棟)</dd>
      <dt>変えた点</dt><dd>${changes.length ? esc(changes.join("、")) : "なし(事例と同じ条件)"}</dd>
      <dt>単価の版</dt><dd>${esc(PRICING_VERSION)}${current.pricingVersion && current.pricingVersion !== PRICING_VERSION ? `(事例登録時は ${esc(current.pricingVersion)})` : ""}</dd>
      <dt>作成日</dt><dd>${new Date().toLocaleDateString("ja-JP")}</dd>
      <dt>数量の出し方</dt><dd>1棟の骨組・被覆・設備を寸法から計算し、${r.count}棟分。運搬費は1回分</dd>
    </dl>
    <table>${r.one.lines.map(l => `<tr><td>${esc(l.label)}<br><span style="color:rgba(255,255,255,0.5)">${esc(l.detail)}</span></td><td>${l.key === "delivery" ? yen(l.amount) : yen(l.amount) + (r.count > 1 ? " × " + r.count : "")}</td></tr>`).join("")}</table>`;
  const qs = `case=${encodeURIComponent(current.no)}&count=${state.count}&${encodeParams(p)}`;
  $("#go-quote").href = `quote.html?${qs}`;
  $("#go-3d").href = `simulator.html?${encodeParams(p)}`;
}
$("#copy-url").addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}?no=${current.no}&count=${state.count}&${encodeParams(state.params)}`;
  toast((await copyText(url)) ? "この条件のURLをコピーしました。LINEやメモに貼っておけます" : "コピーできませんでした");
});
$("#go-quote").addEventListener("click", () => logEc("case_inquiry_click", { ref: `case:${current?.no}` }));

// ---------------- 公開中の一覧 ----------------
async function renderCards() {
  const list = await store.listCases(true);
  $("#cards").innerHTML = list.map(c => `<a class="case-card" href="case.html?no=${esc(c.no)}" data-no="${esc(c.no)}"><span class="fig"><img src="${esc((c.photos || [])[0] || "assets/photo/farm-dawn.jpg")}" alt="" loading="lazy"><span class="tag">No.${esc(c.no)}</span></span><span class="txt"><b>${esc(c.title || c.crop || "施工事例")}</b><span>${esc(c.area || "")} ／ ${c.span}m×${c.length}m×${c.count || 1}棟 ／ ${esc(filmShort(c.film))}</span></span></a>`).join("");
  $("#cards-msg").textContent = list.length ? "公開は施主様の許可をいただいた現場だけです。お名前・住所は載せていません。" : "公開中の事例はまだありません。Instagramの投稿の番号を入れるか、お電話でお問い合わせください。";
}
$("#cards").addEventListener("click", e => { const a = e.target.closest("[data-no]"); if (a) { e.preventDefault(); openByNo(a.dataset.no); } });

// ---------------- 起動 ----------------
(async () => {
  await renderCards();
  const no = new URLSearchParams(location.search).get("no");
  if (no) await openByNo(no, false); else $("#no-input").focus();
})();
