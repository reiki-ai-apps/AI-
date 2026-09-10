// みんなのハウス図鑑: 名前・場所を出さない集計と、作物別の定番構成
import { initSite, esc } from "./site.js";
import { OPTIONS, encodeParams, estimate, yen, normalizeParams } from "./pricing.js";
import { store, CROPS, AREAS } from "./store.js";
initSite();
const $ = s => document.querySelector(s);
const K = 5; // この件数未満の組み合わせは表示しない
const filmLabel = id => (OPTIONS.films.find(f => f.id === id) || {}).label || id;

// 地域サンプル(実データが集まるまでの見本。決まった乱数で毎回同じ内容になります)
function sampleHouses() {
  let seed = 20260901; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (arr, w) => { let r = rnd() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < arr.length; i++) { r -= w[i]; if (r <= 0) return arr[i]; } return arr[arr.length - 1]; };
  const prof = {
    "トマト": { spans: [[5.4, 5], [6.0, 4], [7.2, 3]], films: [["po015", 5], ["po_multi", 3], ["novi010", 1]], len: [30, 60] },
    "きゅうり": { spans: [[5.4, 6], [6.0, 3], [4.5, 1]], films: [["po015", 5], ["novi010", 3], ["po_multi", 1]], len: [25, 50] },
    "いちご": { spans: [[6.0, 5], [5.4, 3], [7.2, 2]], films: [["po_diffuse", 5], ["po015", 3], ["po_multi", 2]], len: [40, 60] },
    "なす": { spans: [[5.4, 5], [6.0, 3], [4.5, 2]], films: [["po015", 5], ["novi010", 4]], len: [25, 45] },
    "ほうれん草": { spans: [[4.5, 4], [5.4, 5], [6.0, 1]], films: [["novi010", 6], ["po015", 3]], len: [20, 50] },
    "花き": { spans: [[4.5, 4], [5.4, 4], [6.0, 2]], films: [["po015", 4], ["novi010", 4], ["po_diffuse", 2]], len: [15, 40] }
  };
  const out = [];
  for (const crop of Object.keys(prof)) {
    const n = 9 + Math.floor(rnd() * 8);
    for (let i = 0; i < n; i++) {
      const pr = prof[crop], span = pick(pr.spans.map(x => x[0]), pr.spans.map(x => x[1])), film = pick(pr.films.map(x => x[0]), pr.films.map(x => x[1]));
      const length = Math.round((pr.len[0] + rnd() * (pr.len[1] - pr.len[0])) / 5) * 5;
      const pipe = span >= 7.2 ? 31.8 : rnd() < 0.7 ? 25.4 : 22.2;
      const eave = span >= 6 ? 1.8 : 1.6, snow = rnd() < (pipe === 31.8 ? 0.6 : 0.2), builtYear = 2000 + Math.floor(rnd() * 25);
      out.push({ sample: true, crop, area: pick(AREAS.slice(0, 6), [5, 3, 3, 2, 2, 2]), builtYear, filmYear: Math.max(builtYear, 2019 + Math.floor(rnd() * 7)),
        params: normalizeParams({ span, length, eave, ridge: eave + span / 2 * 0.52, pitch: span >= 7.2 ? 0.5 : pick([0.45, 0.5, 0.6], [2, 6, 2]), pipe, film, doors: 2, sideVent: "both", ventDrive: rnd() < 0.35 ? "motor" : "manual", roofVent: rnd() < 0.15, curtain: crop === "いちご" || crop === "トマト" ? (rnd() < 0.6 ? "manual" : "none") : "none", insectNet: rnd() < 0.7, irrigation: rnd() < 0.55 ? "drip" : "none", snow }) });
    }
  }
  return out;
}

const state = { crop: "all", area: "all", includeSample: true };
let real = [];
async function main() {
  real = (await store.listAllHouses()).filter(h => !h.consent || h.consent.statsOk !== false).map(h => ({ ...h, sample: false }));
  const s = $("#crop"), a = $("#area");
  s.innerHTML = `<option value="all">すべての作物</option>` + CROPS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  a.innerHTML = `<option value="all">すべての地区</option>` + AREAS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  s.addEventListener("change", () => { state.crop = s.value; render(); });
  a.addEventListener("change", () => { state.area = a.value; render(); });
  $("#include-sample").addEventListener("change", e => { state.includeSample = e.target.checked; render(); });
  render();
}
function dist(list, key, labelFn = v => String(v)) {
  const m = new Map(); for (const h of list) { const k = key(h); m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((x, y) => y[1] - x[1]).map(([k, n]) => ({ label: labelFn(k), n, pct: Math.round(n / list.length * 100) }));
}
function bars(items) { return `<div class="bars">${items.map(i => `<div class="bar"><span class="bl">${esc(i.label)}</span><span class="bt"><span class="bf" style="width:${i.pct}%"></span></span><span class="bn">${i.pct}%<small> (${i.n})</small></span></div>`).join("")}</div>`; }
const median = arr => { const s = [...arr].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

function render() {
  const all = [...real, ...(state.includeSample ? sampleHouses() : [])];
  const list = all.filter(h => (state.crop === "all" || h.crop === state.crop) && (state.area === "all" || h.area === state.area));
  $("#count").textContent = `${list.length}棟(登録データ ${real.length}棟${state.includeSample ? "、地域サンプル含む" : ""})`;
  const stats = $("#stats");
  if (list.length < K) { stats.innerHTML = `<div class="notice">この条件は${K}棟未満のため、個人が特定されないよう集計を表示していません。条件を広げてください。</div>`; $("#templates").innerHTML = ""; return; }
  const lens = list.map(h => h.params.length), snowPct = Math.round(list.filter(h => h.params.snow).length / list.length * 100);
  stats.innerHTML = `
    <div class="stat-grid">
      <div class="card"><h3>間口の分布</h3>${bars(dist(list, h => h.params.span, v => `${v} m`))}</div>
      <div class="card"><h3>被覆材の種類</h3>${bars(dist(list, h => h.params.film, filmLabel))}</div>
      <div class="card"><h3>パイプ径</h3>${bars(dist(list, h => h.params.pipe, v => `φ${v} mm`))}</div>
      <div class="card"><h3>この条件の目安</h3>
        <dl class="kv"><dt>奥行の中央値</dt><dd>${median(lens)} m</dd><dt>耐雪補強あり</dt><dd>${snowPct}%</dd><dt>側面換気 電動</dt><dd>${Math.round(list.filter(h => h.params.ventDrive === "motor" && h.params.sideVent !== "none").length / list.length * 100)}%</dd><dt>内張カーテンあり</dt><dd>${Math.round(list.filter(h => h.params.curtain !== "none").length / list.length * 100)}%</dd><dt>点滴潅水あり</dt><dd>${Math.round(list.filter(h => h.params.irrigation === "drip").length / list.length * 100)}%</dd><dt>建築年の中央値</dt><dd>${median(list.map(h => Number(h.builtYear) || 2015))}年</dd></dl>
      </div>
    </div>`;
  // 定番構成: 作物ごとに最も多い組み合わせを型紙にする
  const crops = state.crop === "all" ? [...new Set(list.map(h => h.crop))] : [state.crop];
  $("#templates").innerHTML = crops.map(crop => {
    const hs = list.filter(h => h.crop === crop); if (hs.length < K) return "";
    const mode = (fn) => dist(hs, fn)[0].label;
    const span = Number(mode(h => h.params.span)), film = dist(hs, h => h.params.film)[0].label, pipe = Number(mode(h => h.params.pipe));
    const p = normalizeParams({ span, length: median(hs.map(h => h.params.length)), eave: span >= 6 ? 1.8 : 1.6, pitch: 0.5, pipe, film, doors: 2, sideVent: "both", ventDrive: dist(hs, h => h.params.ventDrive)[0].label, curtain: dist(hs, h => h.params.curtain)[0].label, insectNet: true, irrigation: dist(hs, h => h.params.irrigation)[0].label, snow: hs.filter(h => h.params.snow).length / hs.length >= 0.5, install: "full", region: "gunma" });
    const e = estimate(p);
    return `<article class="card tpl"><div class="flex between"><h3 style="margin:0">${esc(crop)}の定番構成</h3><span class="badge">${hs.length}棟から</span></div>
      <p class="muted small" style="margin:.4rem 0">間口 ${p.span}m × 奥行 ${p.length}m / φ${p.pipe}mm / ${esc(filmLabel(p.film))} / 側面換気 ${p.ventDrive === "motor" ? "電動" : "手動"}${p.curtain !== "none" ? " / 内張カーテン" : ""}${p.irrigation === "drip" ? " / 点滴潅水" : ""}${p.snow ? " / 耐雪補強" : ""}</p>
      <div class="flex between"><span>概算 <b class="price">${yen(e.total)}</b><span class="muted small">(税込・施工込・仮単価)</span></span><a class="btn sm accent" href="simulator.html?${encodeParams(p)}">この構成で見積る</a></div></article>`;
  }).join("") || `<p class="muted">この条件では定番構成を作れる件数がありません。</p>`;
}
main();
