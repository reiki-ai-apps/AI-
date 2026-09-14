// うちのハウス、いつ張り替え？ ── 30秒診断
// 登録もログインも要らない。被覆材の種類と張った年を押すだけで、次の目安・必要なフィルム量・概算が出る。
// 「残す」を押した時だけ、お客様として保存し、担当者の「今日やること」に「電話して実測の訪問日を決める」が載る。
import { CONFIG } from "./config.js";
import { initSite, toast, copyText, esc, yen } from "./site.js";
import { store, addDays } from "./store.js";
import { FILMS, YEARS, diagnose, filmLabel } from "./check-lite.js";

initSite();
const $ = s => document.querySelector(s);
// ---------------- 画面 ----------------
const state = { film: null, year: null, span: 5.4, length: 30 };
const q = new URLSearchParams(location.search);
if (q.get("film")) state.film = q.get("film");
if (q.get("year") != null) state.year = Number(q.get("year"));
if (q.get("span")) state.span = Number(q.get("span"));
if (q.get("length")) state.length = Number(q.get("length"));

function renderChoices() {
  $("#films").innerHTML = FILMS.map(f => `<button type="button" class="choice${state.film === f.id ? " on" : ""}" data-film="${f.id}"><b>${esc(f.short)}</b><small>${esc(f.hint)}</small></button>`).join("");
  $("#years").innerHTML = YEARS.map(y => `<button type="button" class="choice yr${state.year === y.v ? " on" : ""}" data-year="${y.v}"><b>${esc(y.label)}</b>${y.v ? `<small>${y.v}年</small>` : ""}</button>`).join("");
  $("#span").value = String(state.span); $("#length").value = String(state.length);
}
function renderResult() {
  const box = $("#result");
  if (!state.film || state.year == null) { box.hidden = true; $("#save").hidden = true; return; }
  const d = diagnose(state);
  box.hidden = false; box.className = `result ${d.level}`;
  $("#r-head").textContent = d.head; $("#r-sub").textContent = d.sub;
  $("#r-area").textContent = `${Math.round(d.area)} m²`;
  $("#r-film").textContent = yen(d.filmCost);
  $("#r-total").textContent = yen(d.total);
  $("#r-size").textContent = `間口${state.span}m × 奥行${state.length}m の1棟あたり(ロス1割込・税込)`;
  $("#save").hidden = false;
  $("#s-sum").textContent = `${filmLabel(state.film)} ／ ${state.year ? state.year + "年張り" : "張った年は未定"} ／ ${state.span}m × ${state.length}m`;
  const sim = `simulator.html?span=${state.span}&length=${state.length}&film=${state.film}`;
  $("#r-sim").href = sim;
  $("#r-quote").href = "quote.html";
  history.replaceState(null, "", `?film=${state.film}&year=${state.year}&span=${state.span}&length=${state.length}`);
}
document.addEventListener("click", e => {
  const f = e.target.closest("[data-film]"); const y = e.target.closest("[data-year]");
  if (f) { state.film = f.dataset.film; renderChoices(); renderResult(); if (state.year == null) $("#years").scrollIntoView({ behavior: "smooth", block: "center" }); }
  if (y) { state.year = Number(y.dataset.year); renderChoices(); renderResult(); $("#result").scrollIntoView({ behavior: "smooth", block: "start" }); }
});
$("#span").addEventListener("change", e => { state.span = Number(e.target.value); renderResult(); });
$("#length").addEventListener("input", e => { const v = Number(e.target.value); if (v >= 5 && v <= 100) { state.length = v; renderResult(); } });

// ---------------- 残す(お客様として保存) ----------------
$("#save-form").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("#s-name").value.trim(), tel = $("#s-tel").value.trim();
  if (!name || tel.replace(/[^\d]/g, "").length < 9) { toast("お名前と電話番号をご記入ください"); return; }
  const btn = $("#s-submit"); btn.disabled = true;
  try {
    const agreedAt = new Date().toISOString().slice(0, 10);
    const consent = { agreedAt, statsOk: $("#s-stats").checked, shareOk: $("#s-share").checked, showcaseOk: $("#s-showcase").checked, staff: "", source: "self" };
    // 同じ電話番号の登録があれば、その人に1棟を足す(担当者の登録と二重にしない)
    const same = (await store.findByTel(tel)).filter(c => c.tel && c.tel.replace(/[^\d]/g, "") === tel.replace(/[^\d]/g, ""));
    const cust = same[0]
      ? await store.saveCustomer({ ...same[0], crop: same[0].crop || $("#s-crop").value.trim(), consent: same[0].consent || consent })
      : await store.saveCustomer({ name, farmName: $("#s-farm").value.trim(), tel, kind: "farmer", area: "", address: $("#s-place").value.trim(), crop: $("#s-crop").value.trim(), staff: "", consent, note: "サイトの30秒診断から本人が登録" });
    if (!same[0]) for (const [purpose, granted] of [["karte", true], ["stats", consent.statsOk], ["share_ja", consent.shareOk], ["showcase", consent.showcaseOk]]) await store.saveConsent({ customerId: cust.id, purpose, granted, grantedOn: agreedAt });
    const plots = await store.listPlots(cust.id);
    const plot = plots[0] || await store.savePlot({ customerId: cust.id, name: $("#s-place").value.trim() || "自宅ちかく", area: "" });
    const houses = await store.listHouses(cust.id);
    const d = diagnose(state);
    await store.saveHouse({ customerId: cust.id, plotId: plot.id, name: `${houses.length + 1}号`, crop: $("#s-crop").value.trim(), condition: "良好", status: "active", params: d.params, filmYear: state.year || null, notes: "本人がサイトで登録。寸法・骨組は未実測", history: [] });
    await store.saveInteraction({ customerId: cust.id, channel: "web", topic: "カルテ", body: `30秒診断から本人がハウスを登録(${filmLabel(state.film)} / ${state.year || "年不明"} / ${state.span}×${state.length}m)。寸法は未実測`, staff: "" });
    await store.saveTask({ customerId: cust.id, kind: "self_reg", title: "本人がサイトで登録: 電話して、実測に伺う日を決める", dueOn: addDays(1) });
    try { await store.logEvent({ type: "self_karte", customerId: cust.id }); } catch {}
    const url = new URL(`mypage.html?c=${encodeURIComponent(cust.code)}`, location.href).href;
    $("#done").hidden = false; $("#save").hidden = true;
    $("#d-code").textContent = cust.code; $("#d-link").href = url;
    $("#d-copy").onclick = async () => toast((await copyText(url)) ? "マイページのURLをコピーしました" : "コピーできませんでした");
    const line = $("#d-line");
    if (CONFIG.lineAddFriendUrl) line.href = CONFIG.lineAddFriendUrl; else line.addEventListener("click", ev => { ev.preventDefault(); toast("LINEは準備中です。お知らせは電話でお伝えします"); });
    $("#done").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) { console.error(err); toast("保存できませんでした。お手数ですがお電話ください"); btn.disabled = false; }
});

renderChoices(); renderResult();
