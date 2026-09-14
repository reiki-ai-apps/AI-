// 30秒診断の中身(純関数)と、トップページの帯。check.js(診断ページ)と index.js(トップ)の両方から使う。
import { esc } from "./site.js";
import { OPTIONS, estimateRecover, normalizeParams } from "./pricing.js";
import { FILM_YEARS } from "./store.js";

export const thisYear = new Date().getFullYear();

// 4種の被覆材を、農家さんの言葉で。
export const FILMS = [
  { id: "novi010", short: "農ビ(毎年張る薄いもの)", band: "農ビ(薄いもの)", hint: "0.1mm前後。手で触るとやわらかい" },
  { id: "po015", short: "農PO(3年もの)", band: "農PO(3年もの)", hint: "0.15mm前後。少し張りがある" },
  { id: "po_multi", short: "長持ちPO(5年以上)", band: "長持ちPO", hint: "厚手。メーカー保証つきが多い" },
  { id: "po_diffuse", short: "梨地・散乱光", band: "梨地", hint: "白っぽく曇って見える" }
];
export const YEARS = [
  { v: thisYear, label: "今年" }, { v: thisYear - 1, label: "去年" }, { v: thisYear - 2, label: "2年前" },
  { v: thisYear - 3, label: "3年前" }, { v: thisYear - 4, label: "4年以上前" }, { v: 0, label: "おぼえていない" }
];
export const filmLabel = id => (OPTIONS.films.find(f => f.id === id) || {}).label || id;

// 診断そのもの。
export function diagnose({ film, year, span = 5.4, length = 30 }) {
  const life = FILM_YEARS[film] || 3;
  const y = year || null;
  const due = y ? y + life : null;
  const remain = due ? due - thisYear : null;
  const p = normalizeParams({ span, length, film, install: "full", region: "gunma" });
  const est = estimateRecover(p, { film });
  const filmOnly = est.lines.find(l => l.key === "film");
  let head, sub, level;
  if (!y) { level = "unknown"; head = "張った年がわかれば、目安が出ます"; sub = `${filmLabel(film)}の持ちはふつう${life}年ほど。担当が伺ってフィルムを見れば、だいたいの年はわかります。`; }
  else if (remain <= 0) { level = "due"; head = `いま張り替え時期です(目安 ${due}年)`; sub = `${filmLabel(film)}を${y}年に張ったなら、${life}年の持ちを過ぎています。破れてからだと作付けに間に合わないことがあります。`; }
  else if (remain === 1) { level = "soon"; head = `来年(${due}年)が張り替えの目安です`; sub = `作付け前の2〜4月は施工が混みます。秋のうちに数量だけ決めておくと楽です。`; }
  else { level = "ok"; head = `次の目安は ${due}年ごろ`; sub = `あと${remain}年ほど。台風・降雪の前に、パッカーの緩みと裂けだけ見ておけば大丈夫です。`; }
  return { level, head, sub, due, remain, life, area: est.geometry.coverArea, filmCost: filmOnly ? filmOnly.amount : 0, total: est.total, est, params: p };
}

// トップページの帯: 2問押すと、その場で一行の答え。量と費用は診断ページへ(押した内容はURLで引き継ぐ)。
export function mountBand() {
  const $ = s => document.querySelector(s);
  const films = $("#chk-films"), years = $("#chk-years"), ans = $("#chk-ans");
  if (!films || !years || !ans) return;
  const st = { film: null, year: null };
  const draw = () => {
    films.innerHTML = FILMS.map(f => `<button type="button" data-film="${f.id}" aria-pressed="${st.film === f.id}">${esc(f.band)}</button>`).join("");
    years.innerHTML = YEARS.map(y => `<button type="button" data-year="${y.v}" aria-pressed="${st.year === y.v}">${esc(y.label)}</button>`).join("");
    if (st.film && st.year != null) {
      const d = diagnose(st);
      ans.hidden = false; ans.className = `chk-ans ${d.level}`;
      $("#chk-head").textContent = d.head; $("#chk-sub").textContent = d.sub;
      $("#chk-go").href = `check.html?film=${st.film}&year=${st.year}`;
    } else ans.hidden = true;
  };
  $("#chk-form").addEventListener("submit", e => e.preventDefault());
  films.addEventListener("click", e => { const b = e.target.closest("[data-film]"); if (b) { st.film = b.dataset.film; draw(); } });
  years.addEventListener("click", e => { const b = e.target.closest("[data-year]"); if (b) { st.year = Number(b.dataset.year); draw(); } });
  draw();
}
