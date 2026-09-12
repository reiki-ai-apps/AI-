// 3Dシミュレーター画面の制御: 入力 → 数量・見積り計算 → 3D更新 → URL保存
import { initSite, toast, copyText, esc } from "./site.js";
import { OPTIONS, defaultParams, normalizeParams, estimate, encodeParams, decodeParams, ridgeRange, yen, PRICING_VERSION } from "./pricing.js";
import { createViewer } from "./house3d.js";
import { CONFIG } from "./config.js";

initSite();
document.body.classList.add("has-sticky");

const $ = s => document.querySelector(s);
const el = {
  span: $("#f-span"), length: $("#f-length"), lengthNum: $("#f-length-num"),
  eave: $("#f-eave"), eaveNum: $("#f-eave-num"), ridge: $("#f-ridge"), ridgeNum: $("#f-ridge-num"), ridgeMeta: $("#ridge-meta"),
  pipe: $("#f-pipe"), film: $("#f-film"), filmHelp: $("#film-help"), doors: $("#f-doors"), sideVent: $("#f-sidevent"),
  roofVent: $("#f-roofvent"), net: $("#f-net"), curtain: $("#f-curtain"), irrigation: $("#f-irrigation"), snow: $("#f-snow"), region: $("#f-region")
};

function fill(select, pairs) { select.innerHTML = pairs.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join(""); }
function seg(container, name, pairs) {
  container.innerHTML = pairs.map(([v, l]) => `<label><input type="radio" name="${name}" value="${esc(v)}"><span>${esc(l)}</span></label>`).join("");
}
function radio(name) { const r = document.querySelector(`input[name="${name}"]:checked`); return r ? r.value : null; }
function setRadio(name, v) { document.querySelectorAll(`input[name="${name}"]`).forEach(r => { r.checked = String(r.value) === String(v); }); }

fill(el.span, OPTIONS.spans.map(v => [v, `${v} m`]));
fill(el.pipe, OPTIONS.pipes.map(x => [x.d, x.label]));
fill(el.film, OPTIONS.films.map(x => [x.id, x.label]));
fill(el.doors, [[0, "なし"], [1, "片側に1か所"], [2, "両側に2か所"]]);
fill(el.sideVent, OPTIONS.sideVents.map(x => [x.id, x.label]));
fill(el.curtain, OPTIONS.curtains.map(x => [x.id, x.label]));
fill(el.irrigation, OPTIONS.irrigations.map(x => [x.id, x.label]));
fill(el.region, OPTIONS.regions.map(x => [x.id, x.label]));
seg($("#f-pitch"), "pitch", OPTIONS.pitches.map(v => [v, `${Math.round(v * 100)} cm`]));
seg($("#f-ventdrive"), "ventDrive", OPTIONS.drives.map(x => [x.id, x.label]));
seg($("#f-install"), "install", OPTIONS.installs.map(x => [x.id, x.label]));
$("#pricing-version").textContent = PRICING_VERSION;

let ridgeTouched = false;

function applyParams(p) {
  el.span.value = String(p.span);
  el.length.value = el.lengthNum.value = String(p.length);
  el.eave.value = el.eaveNum.value = String(p.eave);
  updateRidgeRange(p.span, p.eave);
  el.ridge.value = el.ridgeNum.value = String(p.ridge);
  setRadio("pitch", p.pitch);
  el.pipe.value = String(p.pipe);
  el.film.value = p.film;
  el.doors.value = String(p.doors);
  el.sideVent.value = p.sideVent;
  setRadio("ventDrive", p.ventDrive);
  el.roofVent.checked = p.roofVent;
  el.net.checked = p.insectNet;
  el.curtain.value = p.curtain;
  el.irrigation.value = p.irrigation;
  el.snow.checked = p.snow;
  setRadio("install", p.install);
  el.region.value = p.region;
}

function updateRidgeRange(span, eave) {
  const rr = ridgeRange(Number(span), Number(eave));
  el.ridge.min = el.ridgeNum.min = rr.min; el.ridge.max = el.ridgeNum.max = rr.max;
  el.ridgeMeta.innerHTML = `<span>${rr.min}m</span><span>おすすめ ${rr.suggested}m</span><span>${rr.max}m</span>`;
  return rr;
}

function readParams() {
  return normalizeParams({
    span: el.span.value, length: el.length.value, eave: el.eave.value, ridge: el.ridge.value,
    pitch: radio("pitch"), pipe: el.pipe.value, film: el.film.value, doors: el.doors.value,
    sideVent: el.sideVent.value, ventDrive: radio("ventDrive"), roofVent: el.roofVent.checked,
    curtain: el.curtain.value, insectNet: el.net.checked, irrigation: el.irrigation.value,
    snow: el.snow.checked, install: radio("install"), region: el.region.value
  });
}

// ---- 結果表示 ----
const out = {
  incl: $("#total-incl"), excl: $("#total-excl"), sqm: $("#per-sqm"), tsubo: $("#per-tsubo"), kpis: $("#kpis"),
  lines: $("#lines"), fsub: $("#foot-sub"), ftax: $("#foot-tax"), ftotal: $("#foot-total"), notes: $("#notes"),
  quote: $("#quote-link"), sticky: $("#sticky-total"), stickyQuote: $("#sticky-quote")
};
function renderResult(est) {
  const g = est.geometry;
  out.incl.textContent = yen(est.total);
  out.excl.textContent = yen(est.subtotal);
  out.sqm.textContent = yen(est.perSqm);
  out.tsubo.textContent = yen(est.perTsubo);
  out.sticky.textContent = yen(est.total);
  out.kpis.innerHTML = [
    [`${g.floorArea.toFixed(1)} m²`, `床面積(約${g.tsubo.toFixed(0)}坪)`],
    [`${g.archCount} 本`, `アーチ本数(1本 約${g.archLen.toFixed(1)}m)`],
    [`${g.coverArea.toFixed(0)} m²`, `被覆材面積(ロス込)`],
    [`${g.volume.toFixed(0)} m³`, `ハウス容積`]
  ].map(([v, k]) => `<div class="kpi"><div class="v">${v}</div><div class="k">${k}</div></div>`).join("");
  out.lines.innerHTML = est.lines.map(l => `<tr><td><div>${esc(l.label)}</div><div class="detail">${esc(l.detail)}</div></td><td class="num">${l.unit === "式" ? "1式" : `${l.qty.toLocaleString("ja-JP")} ${esc(l.unit)}`}</td><td class="num">${l.amount ? yen(l.amount) : (l.note ? esc(l.note) : yen(0))}</td></tr>`).join("");
  out.fsub.textContent = yen(est.subtotal); out.ftax.textContent = yen(est.tax); out.ftotal.textContent = yen(est.total);
  out.notes.innerHTML = est.notes.map(n => `<li>${esc(n)}</li>`).join("");
  const q = "quote.html?" + encodeParams(est.params);
  out.quote.href = q; out.stickyQuote.href = q;
  const film = est.film; el.filmHelp.textContent = `耐用年数の目安: ${film.years} / 仮単価 ${yen(film.perSqm)}/m²`;
  document.querySelectorAll('input[name="ventDrive"]').forEach(r => { r.disabled = est.params.sideVent === "none"; });
  el.net.disabled = est.params.sideVent === "none";
}

// ---- 3D ----
const viewer = createViewer($("#viewer"));
let rebuildTimer = null;
let current = null;

function update(opts = {}) {
  const p = readParams();
  if (opts.refreshRidge) {
    const rr = updateRidgeRange(p.span, p.eave);
    if (!ridgeTouched) p.ridge = rr.suggested;
    el.ridge.value = el.ridgeNum.value = String(p.ridge);
  }
  current = estimate(p);
  applyParams(current.params); // 正規化後の値を反映
  renderResult(current);
  history.replaceState(null, "", location.pathname + "?" + encodeParams(current.params));
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => viewer.update(current, opts), opts.immediate ? 0 : 90);
}

// 入力イベント
const form = $("#controls");
form.addEventListener("input", e => {
  const t = e.target;
  if (t === el.length) el.lengthNum.value = t.value;
  if (t === el.lengthNum) el.length.value = t.value;
  if (t === el.eave) el.eaveNum.value = t.value;
  if (t === el.eaveNum) el.eave.value = t.value;
  if (t === el.ridge) { el.ridgeNum.value = t.value; ridgeTouched = true; }
  if (t === el.ridgeNum) { el.ridge.value = t.value; ridgeTouched = true; }
  const refreshRidge = (t === el.span || t === el.eave || t === el.eaveNum);
  update({ refreshRidge });
});
form.addEventListener("submit", e => e.preventDefault());
$("#btn-reset").addEventListener("click", () => { ridgeTouched = false; applyParams(defaultParams()); update({ refreshRidge: true }); toast("初期値に戻しました"); });

// ビューアの操作
document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll("[data-view]").forEach(x => x.setAttribute("aria-pressed", "false"));
  b.setAttribute("aria-pressed", "true");
  viewer.setView(b.dataset.view);
}));
// サンプルの3Dハウス(.glb)。読み込めたものだけ切り替えボタンを出す
(async () => {
  const list = (CONFIG.sampleModels || []).filter(m => m && m.file);
  if (!list.length || !viewer.ok) return;
  for (const m of list) await viewer.loadModel(m.file, { label: m.label, width: m.width || 0, show: false });
  const loaded = viewer.samples;
  if (!loaded.length) return;
  const pick = $("#sample-pick");
  pick.innerHTML = `<button type="button" data-sample="-1" aria-pressed="true">入力した寸法</button>` +
    loaded.map(s => `<button type="button" data-sample="${s.index}" aria-pressed="false">${esc(s.label)}</button>`).join("");
  pick.hidden = false;
  pick.addEventListener("click", e => {
    const b = e.target.closest("[data-sample]"); if (!b) return;
    const idx = Number(b.dataset.sample);
    pick.querySelectorAll("[data-sample]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    viewer.setSample(idx);
    $("#btn-labels").disabled = idx >= 0;          // サンプルには寸法ラベルが付かない
    toast(idx >= 0 ? "サンプルのハウスを表示しています。数量と見積りは入力した寸法のままです。" : "入力した寸法のハウスに戻しました");
  });
})();

$("#btn-labels").addEventListener("click", e => {
  const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
  e.currentTarget.setAttribute("aria-pressed", String(on)); viewer.setLabels(on);
});
$("#btn-shot").addEventListener("click", () => {
  const url = viewer.screenshot(); if (!url) return toast("この端末では画像を保存できません");
  const a = document.createElement("a"); a.href = url; a.download = `house-${current.params.span}x${current.params.length}.png`; a.click();
  toast("3D画像を保存しました");
});
$("#btn-copy").addEventListener("click", async () => { (await copyText(location.href)) ? toast("共有URLをコピーしました") : toast("コピーできませんでした"); import("./store.js").then(m => m.logEc("sim_save", { ref: `${current.params.span}x${current.params.length}` })).catch(() => {}); });
$("#btn-print").addEventListener("click", () => { document.querySelector("#result details").open = true; window.print(); });

// 初期化: URLに内容があれば復元
const fromUrl = decodeParams(location.search);
if (fromUrl) ridgeTouched = true;
applyParams(fromUrl || defaultParams());
update({ refreshRidge: !fromUrl, immediate: true });
