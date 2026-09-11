// 災害モード: 台風・大雪のあと、どこから回るかを、集めたデータから出す。
// 地区を選ぶ → 対象のハウスが地図と一覧に出る → 1タップで被害度を記録 → 復旧の順番と必要な資材が出る。
import { esc, toast, copyText } from "./site.js";
import { computeGeometry, OPTIONS, yen, estimateRecover } from "./pricing.js";
import { store, houseStatus, DAMAGE, damageOf, AREAS, addDays, normTel } from "./store.js";
import { renderMap } from "./minimap.js";

const $ = s => document.querySelector(s);
const filmLabel = id => (OPTIONS.films.find(f => f.id === id) || {}).label || id;
// 被覆材の1巻あたりの面積(m²)。必要な巻数の見込みに使う
const ROLL_AREA = { novi010: 230, novi013: 230, po015: 540, po_diffuse: 540, po_multi: 600 };
export const KINDS = [
  { id: "typhoon", label: "台風", tip: "巻き上げを下ろし、妻面ドアを固定。通過後はパッカーの飛びと裂けを確認。" },
  { id: "snow", label: "大雪", tip: "積もったら早めに落とす。中柱とタイバーの入っていない棟から回る。" },
  { id: "hail", label: "雹", tip: "被覆材の穴あきが中心。作物の被害もあわせて確認。" },
  { id: "wind", label: "強風", tip: "裾と妻面から抜ける。飛散物の確認も。" }
];

let state = { areas: new Set(), kind: "typhoon", rows: [], onlyUnchecked: false, order: null };

export async function initDisaster() {
  $("#dz-kinds").innerHTML = KINDS.map(k => `<button type="button" data-kind="${k.id}" aria-pressed="${k.id === state.kind}">${esc(k.label)}</button>`).join("");
  $("#dz-kinds").addEventListener("click", e => { const b = e.target.closest("[data-kind]"); if (!b) return; state.kind = b.dataset.kind; $("#dz-kinds").querySelectorAll("[data-kind]").forEach(x => x.setAttribute("aria-pressed", String(x === b))); renderTip(); });
  $("#dz-areas").addEventListener("click", e => {
    const b = e.target.closest("[data-area]"); if (!b) return;
    const a = b.dataset.area;
    if (a === "__all") { state.areas.clear(); } else { state.areas.has(a) ? state.areas.delete(a) : state.areas.add(a); }
    renderAreaChips(); refresh();
  });
  $("#dz-unchecked").addEventListener("change", e => { state.onlyUnchecked = e.target.checked; refresh(); });
  $("#dz-copy").addEventListener("click", copyCallList);
  $("#dz-resort").addEventListener("click", () => { refresh({ resort: true }); toast("被害の重い順に並べ直しました"); });
  $("#dz-list").addEventListener("click", onListClick);
  renderTip(); renderAreaChips(); await refresh();
  addEventListener("resize", debounce(() => drawMap(), 250));
}
const debounce = (fn, ms) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
function renderTip() { const k = KINDS.find(x => x.id === state.kind); $("#dz-tip").textContent = k ? k.tip : ""; }
function renderAreaChips() {
  const all = state.areas.size === 0;
  $("#dz-areas").innerHTML = `<button type="button" data-area="__all" aria-pressed="${all}">全域</button>` +
    AREAS.map(a => `<button type="button" data-area="${esc(a)}" aria-pressed="${state.areas.has(a)}">${esc(a)}</button>`).join("");
}

// 優先順位: 倒壊・大きい被害 → 未確認で弱い棟(要補修・張替期・耐雪なし) → 軽微 → 被害なし
function priority(r) {
  const d = damageOf(r.house.damage || "unknown");
  let p = d.rank * 100;
  if (!r.house.damage) {
    const s = houseStatus(r.house);
    p = 150;
    if (r.house.condition === "要補修") p += 30;
    if (s.level === "due") p += 20;
    if (!r.house.params.snow && state.kind === "snow") p += 25;
    if (r.house.params.length >= 40) p += 10;
  }
  return -p;
}

// resort:false のときは並び順を変えない。記録中に行が動くと、現場で押し間違えるため。
async function refresh({ resort = true } = {}) {
  const [customers, houses] = await Promise.all([store.listCustomers(), store.listAllHouses()]);
  const custById = new Map(customers.map(c => [c.id, c]));
  const plotById = new Map();
  for (const c of customers) for (const p of await store.listPlots(c.id)) plotById.set(p.id, p);
  let rows = houses
    .map(h => ({ house: h, cust: custById.get(h.customerId), plot: plotById.get(h.plotId) }))
    .filter(r => r.cust)
    .filter(r => state.areas.size === 0 || state.areas.has(r.house.area || r.cust.area))
    .filter(r => !state.onlyUnchecked || !r.house.damage);
  if (resort || !state.order) {
    rows.sort((a, b) => priority(a) - priority(b));
    state.order = rows.map(r => r.house.id);
  } else {
    const idx = new Map(state.order.map((id, i) => [id, i]));
    rows.sort((a, b) => (idx.has(a.house.id) ? idx.get(a.house.id) : 9e9) - (idx.has(b.house.id) ? idx.get(b.house.id) : 9e9));
  }
  state.rows = rows;
  renderSummary(); renderList(); drawMap();
}

function renderSummary() {
  const rows = state.rows;
  const by = id => rows.filter(r => (r.house.damage || "unknown") === id).length;
  const checked = rows.filter(r => r.house.damage).length;
  $("#dz-summary").innerHTML = [
    [rows.length, "対象のハウス"], [`${checked}/${rows.length}`, "確認できた棟"],
    [by("destroyed") + by("major"), "大きい被害", "bad"], [by("minor"), "軽微"], [by("none"), "被害なし", "ok"]
  ].map(([v, k, cls]) => `<div class="dz-stat ${cls || ""}"><div class="v">${esc(v)}</div><div class="k">${esc(k)}</div></div>`).join("");

  // 必要な資材の見込み(被害のあった棟の被覆材)
  const need = new Map();
  for (const r of rows) {
    const d = r.house.damage;
    if (d !== "major" && d !== "destroyed") continue;
    const g = computeGeometry(r.house.params);
    const area = d === "destroyed" ? g.coverArea : g.coverArea * 0.4; // 全損は全面、大きい被害は約4割
    need.set(r.house.params.film, (need.get(r.house.params.film) || 0) + area);
  }
  $("#dz-need").innerHTML = need.size
    ? `<h3>必要になりそうな被覆材</h3><div class="table-wrap"><table class="table"><thead><tr><th>被覆材</th><th class="num">面積</th><th class="num">巻数の目安</th></tr></thead><tbody>${[...need].map(([film, a]) => `<tr><td>${esc(filmLabel(film))}</td><td class="num">${Math.round(a).toLocaleString("ja-JP")} m²</td><td class="num">約 ${Math.ceil(a / (ROLL_AREA[film] || 540))} 巻</td></tr>`).join("")}</tbody></table></div><p class="small muted">全損は全面、大きい被害は4割として概算しています。発注の目安にしてください。</p>`
    : `<p class="small muted">被害を記録すると、必要になりそうな被覆材の量がここに出ます。</p>`;
}

function renderList() {
  $("#dz-list").innerHTML = state.rows.length ? state.rows.map((r, i) => {
    const d = damageOf(r.house.damage || "unknown");
    const s = houseStatus(r.house);
    const weak = [r.house.condition === "要補修" ? "要補修" : "", s.level === "due" ? "張替期" : "", !r.house.params.snow ? "耐雪なし" : "", r.house.params.length >= 40 ? "長い棟" : ""].filter(Boolean);
    return `<div class="dz-row ${r.house.damage ? "checked" : ""}" data-house="${esc(r.house.id)}">
      <div class="no">${i + 1}</div>
      <div>
        <div class="nm">${esc(r.cust.farmName || r.cust.name)} <span class="muted">${esc(r.house.name)}</span></div>
        <div class="sub">${esc(r.plot?.name || "")} ${esc(r.house.area || r.cust.area || "")} ・ ${r.house.params.span}m×${r.house.params.length}m ・ ${esc(filmLabel(r.house.params.film))}${weak.length ? ` ・ <span class="weak">${weak.map(esc).join(" / ")}</span>` : ""}</div>
      </div>
      <div class="dmg">${DAMAGE.filter(x => x.id !== "unknown").map(x => `<button type="button" data-set="${x.id}" data-h="${esc(r.house.id)}" aria-pressed="${r.house.damage === x.id}" style="--c:${x.color}">${esc(x.label)}</button>`).join("")}</div>
      <div class="acts">
        ${r.cust.tel ? `<a class="btn sm help" href="tel:${esc(normTel(r.cust.tel))}">電話</a>` : ""}
        <button class="btn sm ghost" type="button" data-quote="${esc(r.house.id)}">復旧見積</button>
      </div>
    </div>`;
  }).join("") : `<p class="muted">この条件のハウスはありません。</p>`;
}

function drawMap() {
  const el = $("#dz-map"); if (!el) return;
  const byPlot = new Map();
  for (const r of state.rows) {
    if (!r.plot || !isFinite(r.plot.lat) || !isFinite(r.plot.lng)) continue;
    const k = r.plot.id;
    if (!byPlot.has(k)) byPlot.set(k, { plot: r.plot, cust: r.cust, rows: [] });
    byPlot.get(k).rows.push(r);
  }
  const points = [...byPlot.values()].map(g => {
    const worst = g.rows.map(r => damageOf(r.house.damage || "unknown")).sort((a, b) => b.rank - a.rank)[0];
    return { lat: g.plot.lat, lng: g.plot.lng, color: worst.color, count: g.rows.length, label: `${g.cust.farmName || g.cust.name} ${g.plot.name}`,
      onClick: () => { const row = $(`[data-house="${g.rows[0].house.id}"]`); row?.scrollIntoView({ behavior: "smooth", block: "center" }); row?.classList.add("flash"); setTimeout(() => row?.classList.remove("flash"), 1200); } };
  });
  renderMap(el, points);
}

async function onListClick(e) {
  const set = e.target.closest("[data-set]");
  if (set) {
    const houses = await store.listAllHouses();
    const h = houses.find(x => x.id === set.dataset.h); if (!h) return;
    const id = set.dataset.set;
    h.damage = h.damage === id ? null : id;
    h.damageCheckedAt = h.damage ? new Date().toISOString() : null;
    if (h.damage === "major" || h.damage === "destroyed") h.condition = "要補修";
    await store.saveHouse(h);
    await store.saveHouseEvent({ houseId: h.id, type: "damage", summary: `${KINDS.find(k => k.id === state.kind)?.label || "災害"}: ${damageOf(h.damage || "none").label}`, staff: localStorage.getItem("mitaka-staff-name") || "" });
    if (h.damage === "major" || h.damage === "destroyed") {
      await store.saveTask({ customerId: h.customerId, houseId: h.id, kind: "disaster_check", title: `${h.name}: 被害あり。復旧の手配`, dueOn: addDays(1) });
    }
    await refresh({ resort: false });
    return;
  }
  const q = e.target.closest("[data-quote]");
  if (q) {
    const houses = await store.listAllHouses();
    const h = houses.find(x => x.id === q.dataset.quote); if (!h) return;
    const r = estimateRecover(h.params);
    toast(`${h.name} の張り替え概算: ${yen(r.total)}(税込)`);
    window.open(`quote.html?house=${encodeURIComponent(h.id)}&mode=recover`, "_blank");
  }
}

async function copyCallList() {
  const rows = state.rows.filter(r => !r.house.damage);
  if (!rows.length) return toast("未確認の棟はありません");
  const seen = new Set(); const lines = [`【${KINDS.find(k => k.id === state.kind)?.label || "災害"}後の確認リスト】`];
  for (const r of rows) {
    const key = r.cust.id; if (seen.has(key)) continue; seen.add(key);
    const mine = rows.filter(x => x.cust.id === r.cust.id);
    lines.push(`${r.cust.farmName || r.cust.name} 様(${r.cust.tel || "電話未登録"}) ${r.cust.area || ""} / ${mine.length}棟: ${mine.map(x => x.house.name).join("・")}`);
  }
  lines.push("", "※ お見舞いの連絡と、被害の有無の確認をお願いします。");
  toast((await copyText(lines.join("\n"))) ? `${seen.size}件の連絡リストをコピーしました` : "コピーできませんでした");
}
