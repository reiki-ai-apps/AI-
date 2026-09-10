// 担当者コンソール: 今日やること / 電話メモ / お客様360 / カルテ登録 / データ
import { CONFIG } from "./config.js";
import { initSite, toast, copyText, esc } from "./site.js";
import { OPTIONS, ridgeRange, normalizeParams, encodeParams, yen } from "./pricing.js";
import { ICONS } from "./icons.js";
import { attachVoiceSearch } from "./voice.js";
import { store, seedDemo, todayList, healthStats, houseStatus, addDays, normTel,
         CROPS, CONDITIONS, AREAS, TOPICS, CHANNELS, QUOTE_STATUS, TASK_KIND } from "./store.js";

initSite();
const $ = s => document.querySelector(s);
const thisYear = new Date().getFullYear();
const years = Array.from({ length: 31 }, (_, i) => thisYear - i);
const fill = (sel, pairs, selected) => { sel.innerHTML = pairs.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(selected) ? " selected" : ""}>${esc(l)}</option>`).join(""); };
const fmtDate = s => s ? new Date(s).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }) : "";
const fmtDateTime = s => s ? new Date(s).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
const statusLabel = id => (QUOTE_STATUS.find(s => s.id === id) || {}).label || id;
const channelLabel = id => (CHANNELS.find(c => c.id === id) || {}).label || id;

// ---------------- 簡易ロック ----------------
const lock = $("#lock"), app = $("#app");
function openApp() { lock.hidden = true; app.hidden = false; $("#store-kind").textContent = store.kind === "supabase" ? "本番DBに保存" : "ブラウザ保存モード"; $("#who").textContent = `担当: ${localStorage.getItem("mitaka-staff-name") || "未設定"}`; refreshAll(); }
$("#unlock").addEventListener("click", () => { if ($("#pin").value === CONFIG.staffPin) { sessionStorage.setItem("mitaka-staff-ok", "1"); openApp(); } else $("#lock-msg").textContent = "コードが違います"; });
$("#pin").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("#unlock").click(); } });
if (sessionStorage.getItem("mitaka-staff-ok") === "1") openApp();

// ---------------- タブ ----------------
document.querySelectorAll("[role=tab]").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll("[role=tab]").forEach(x => x.setAttribute("aria-selected", String(x === b)));
  document.querySelectorAll(".pane-main").forEach(p => { p.hidden = p.id !== `pane-${b.dataset.tab}`; });
  if (b.dataset.tab === "phone") $("#tel").focus();
}));

// ---------------- 今日やること ----------------
async function renderToday() {
  const items = await todayList();
  $("#n-today").textContent = String(items.filter(i => i.level === "due").length);
  $("#todo-list").innerHTML = items.length ? items.slice(0, 30).map(i => {
    const who = i.who ? `${i.who.farmName || ""} ${i.who.name || ""}`.trim() : "";
    const act = i.quoteId ? `<a class="btn sm" href="#" data-open-cust="${esc(i.customerId || "")}">見積を見る</a>`
      : i.houseId ? `<a class="btn sm" href="#" data-open-cust="${esc(i.customerId || "")}">カルテ</a>`
      : `<a class="btn sm ghost" href="#" data-open-cust="${esc(i.customerId || "")}">開く</a>`;
    return `<div class="todo-row ${esc(i.level)}"><span class="dot"></span><div><div class="t">${esc(i.title)}</div><div class="s">${esc(who)}${i.due ? ` ・ ${fmtDate(i.due)}まで` : ""}</div></div><div class="acts">${act}${i.taskId ? `<button class="btn sm ghost" type="button" data-done="${esc(i.taskId)}">済</button>` : ""}</div></div>`;
  }).join("") : `<p class="muted">いまのところ、急ぎのやることはありません。</p>`;

  const quotes = await store.listQuotes();
  const open = quotes.filter(q => !["done", "lost"].includes(q.status)).slice(0, 12);
  $("#pipeline").innerHTML = open.length ? open.map(q => `<div class="pipe-row"><div><b>${esc(q.name || "")}</b> ${q.total ? yen(q.total) : ""}<div class="small muted">${esc(q.message || q.quoteNo || "")}</div></div><span class="st ${esc(q.status)}">${esc(statusLabel(q.status))}</span></div>`).join("") : `<p class="muted small">動いている見積はありません。</p>`;

  const h = await healthStats();
  $("#kpis").innerHTML = [
    [h.customers, "お客様", ""], [h.houses, "登録ハウス", ""],
    [h.interactions30, "30日の接点ログ", h.interactions30 < 5 ? "warn" : ""],
    [h.quotesOpen, "動いている見積", ""],
    [`${h.telRate}%`, "電話番号あり", h.telRate < 90 ? "warn" : ""],
    [`${h.filmYearRate}%`, "張った年あり", h.filmYearRate < 80 ? "warn" : ""],
    [h.dup, "電話の重複", h.dup ? "warn" : ""],
    [`${h.freshRate}%`, "1年以内に更新", h.freshRate < 80 ? "warn" : ""]
  ].map(([v, k, w]) => `<div class="kpi-box ${w}"><div class="v">${esc(v)}</div><div class="k">${esc(k)}</div></div>`).join("");
}
$("#todo-list").addEventListener("click", async e => {
  const done = e.target.closest("[data-done]");
  if (done) { const t = (await store.listTasks(true)).find(x => x.id === done.dataset.done); if (t) { t.status = "done"; await store.saveTask(t); toast("済にしました"); renderToday(); } return; }
  const open = e.target.closest("[data-open-cust]");
  if (open) { e.preventDefault(); document.querySelector('[data-tab="cust"]').click(); selectCustomer(open.dataset.openCust); }
});

// ---------------- 電話メモ ----------------
let phoneTarget = null, phoneChannel = "phone_in", phoneTopic = "見積", phoneNext = null;
$("#ch-channel").innerHTML = CHANNELS.map(c => `<button type="button" data-ch="${c.id}" aria-pressed="${c.id === phoneChannel}">${esc(c.label)}</button>`).join("");
$("#ch-topic").innerHTML = TOPICS.map(t => `<button type="button" data-topic="${esc(t)}" aria-pressed="${t === phoneTopic}">${esc(t)}</button>`).join("");
$("#ch-next").innerHTML = [["", "なし"], [2, "2日後"], [7, "来週"], [30, "来月"]].map(([d, l]) => `<button type="button" data-next="${d}" aria-pressed="${d === ""}">${esc(l)}</button>`).join("") + `<input class="input" id="next-date" type="date" style="width:11rem;margin:0">`;
const pressGroup = (root, attr, cb) => root.addEventListener("click", e => { const b = e.target.closest(`[data-${attr}]`); if (!b) return; root.querySelectorAll(`[data-${attr}]`).forEach(x => x.setAttribute("aria-pressed", String(x === b))); cb(b.dataset[attr]); });
pressGroup($("#ch-channel"), "ch", v => phoneChannel = v);
pressGroup($("#ch-topic"), "topic", v => phoneTopic = v);
pressGroup($("#ch-next"), "next", v => { phoneNext = v ? addDays(Number(v)) : null; $("#next-date").value = phoneNext || ""; });
$("#next-date").addEventListener("change", e => { phoneNext = e.target.value || null; $("#ch-next").querySelectorAll("[data-next]").forEach(x => x.setAttribute("aria-pressed", "false")); });
$("#memo-mic").innerHTML = ICONS.mic;
attachVoiceSearch($("#memo"), $("#memo-mic"), t => { const m = $("#memo"); m.value = (m.value ? m.value + " " : "") + t; });

async function findByTel() {
  const v = $("#tel").value.trim();
  const hits = v ? await store.findByTel(v) : [];
  const box = $("#tel-hits");
  if (!v) { box.innerHTML = ""; return; }
  box.innerHTML = hits.length
    ? hits.map(c => `<button class="tel-hit" type="button" data-cust="${esc(c.id)}" aria-pressed="false"><span><span class="nm">${esc(c.farmName || "")} ${esc(c.name)}</span><span class="sub">${esc(c.tel || "")} ・ ${esc(c.area || "")} ・ ${esc(c.code)}</span></span><span class="badge gray">選ぶ</span></button>`).join("")
    : `<div class="notice">この番号のお客様が見つかりません。<button class="btn sm mt-1" type="button" id="new-from-tel">新規のお客様として残す</button></div>`;
}
$("#tel-find").addEventListener("click", findByTel);
let telTimer; $("#tel").addEventListener("input", () => { clearTimeout(telTimer); telTimer = setTimeout(findByTel, 300); });
$("#tel-hits").addEventListener("click", async e => {
  const hit = e.target.closest("[data-cust]");
  if (hit) { $("#tel-hits").querySelectorAll("[data-cust]").forEach(x => x.setAttribute("aria-pressed", String(x === hit))); phoneTarget = await store.getCustomer(hit.dataset.cust); $("#phone-form").hidden = false; $("#memo").focus(); return; }
  if (e.target.id === "new-from-tel") {
    const tel = $("#tel").value.trim();
    phoneTarget = await store.saveCustomer({ name: `未登録(${tel})`, tel, status: "prospect", staff: localStorage.getItem("mitaka-staff-name") || "" });
    toast("新規のお客様として作りました。あとでカルテ登録で整えてください");
    $("#phone-form").hidden = false; findByTel(); refreshCustomers();
  }
});
$("#save-memo").addEventListener("click", async () => {
  if (!phoneTarget) return ($("#memo-msg").textContent = "お客様を選んでください");
  const body = $("#memo").value.trim();
  if (!body) return ($("#memo-msg").textContent = "話した内容を一言でも入れてください");
  await store.saveInteraction({ customerId: phoneTarget.id, channel: phoneChannel, topic: phoneTopic, body, staff: localStorage.getItem("mitaka-staff-name") || "", nextActionOn: phoneNext });
  if (phoneNext) await store.saveTask({ customerId: phoneTarget.id, kind: "callback", title: `折り返し: ${body.slice(0, 20)}`, dueOn: phoneNext });
  $("#memo").value = ""; $("#memo-msg").textContent = `${phoneTarget.name} 様の記録を残しました${phoneNext ? `(${fmtDate(phoneNext)}に折り返し)` : ""}`;
  toast("残しました ✓");
  renderToday(); if (currentCustomerId === phoneTarget.id) selectCustomer(phoneTarget.id);
});

// ---------------- お客様360 ----------------
let customers = [], currentCustomerId = null;
async function refreshCustomers() {
  customers = await store.listCustomers();
  fill($("#c-existing"), [["", "(新規のお客様)"], ...customers.map(c => [c.id, `${c.name}${c.farmName ? " / " + c.farmName : ""}(${c.code})`])]);
  renderCustList();
}
function renderCustList() {
  const kw = ($("#cust-search").value || "").trim();
  const list = customers.filter(c => !kw || [c.name, c.farmName, c.tel, c.code, c.area].join(" ").includes(kw) || normTel(c.tel).includes(normTel(kw)));
  $("#cust-list").innerHTML = list.length ? list.map(c => `<button class="cust-item" type="button" data-cust="${esc(c.id)}" aria-pressed="${c.id === currentCustomerId}"><div class="nm">${esc(c.name)} <span class="muted small">${esc(c.farmName || "")}</span></div><div class="sub">${esc(c.area || "")} ・ ${esc(c.tel || "")} ・ ${esc(c.code)}</div></button>`).join("") : `<p class="muted small">見つかりません。</p>`;
}
$("#cust-search").addEventListener("input", renderCustList);
$("#cust-list").addEventListener("click", e => { const b = e.target.closest("[data-cust]"); if (b) selectCustomer(b.dataset.cust); });

async function selectCustomer(id) {
  currentCustomerId = id; renderCustList();
  const c = await store.getCustomer(id); if (!c) return;
  const [plots, houses, talks, quotes] = await Promise.all([store.listPlots(id), store.listHouses(id), store.listInteractions(id), store.listQuotes(id)]);
  const plotName = pid => (plots.find(p => p.id === pid) || {}).name || "";
  const timeline = [
    ...talks.map(t => ({ at: t.occurredAt, cls: "", what: `${channelLabel(t.channel)}${t.topic ? " ・ " + t.topic : ""}`, body: t.body + (t.nextActionOn ? `\n→ ${fmtDate(t.nextActionOn)}に折り返し` : ""), who: t.staff })),
    ...quotes.map(q => ({ at: q.createdAt, cls: "quote", what: `見積 ${statusLabel(q.status)}${q.total ? " " + yen(q.total) : ""}`, body: q.message || q.quoteNo || "" })),
    ...houses.flatMap(h => (h.history || []).map(x => ({ at: x.date, cls: "house", what: `${h.name} ${x.type}`, body: `${x.summary}${x.amount ? ` (${yen(x.amount)})` : ""}` })))
  ].filter(x => x.at).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const cs = c.consent || {};
  $("#c360").innerHTML = `
    <h2>${esc(c.farmName ? c.farmName + " " : "")}${esc(c.name)} 様</h2>
    <div class="meta">${esc(c.area || "")} ${esc(c.address || "")} / ${esc(c.tel || "")} / ${esc(c.crop || "")} / コード ${esc(c.code)}${c.staff ? ` / 担当 ${esc(c.staff)}` : ""}</div>
    <div class="acts">
      ${c.tel ? `<a class="btn sm help" href="tel:${esc(normTel(c.tel))}">電話する</a>` : ""}
      <button class="btn sm" type="button" data-memo="${esc(c.id)}">この方の電話メモ</button>
      <a class="btn sm outline" href="karte.html?c=${esc(c.karteToken || c.code)}" target="_blank">カルテを開く</a>
      <a class="btn sm ghost" href="quote.html" target="_blank">見積を作る</a>
    </div>
    <div class="flex mb-2">${houses.map(h => { const s = houseStatus(h); return `<span class="house-chip"><span class="badge ${s.level === "due" ? "warn" : ""}">${s.level === "due" ? "要対応" : s.level === "soon" ? "来年" : "良好"}</span><span><span class="b">${esc(h.name)}</span> ${h.params.span}m×${h.params.length}m ${esc(plotName(h.plotId))}<br><span class="muted small">${esc(s.text)}</span></span></span>`; }).join("") || `<span class="muted small">ハウスは未登録です。</span>`}</div>
    <div class="consent-row mb-2">同意: カルテ ${cs.agreedAt ? "○" : "-"} / 統計 ${cs.statsOk ? "○" : "×"} / 事例掲載 ${cs.showcaseOk ? "○" : "×"}</div>
    <h3>やりとり</h3>
    <div class="timeline">${timeline.length ? timeline.slice(0, 40).map(t => `<div class="tl-item ${esc(t.cls)}"><div class="when">${esc(fmtDateTime(t.at))}${t.who ? ` ・ ${esc(t.who)}` : ""}</div><div class="what">${esc(t.what)}</div><div class="body">${esc(t.body)}</div></div>`).join("") : `<p class="muted small">まだ記録がありません。電話メモから残せます。</p>`}</div>`;
  $("#c360").querySelector("[data-memo]")?.addEventListener("click", () => { document.querySelector('[data-tab="phone"]').click(); $("#tel").value = c.tel || ""; findByTel().then(() => { const b = $("#tel-hits").querySelector(`[data-cust="${c.id}"]`); b?.click(); }); });
}

// ---------------- カルテ登録 ----------------
fill($("#c-area"), AREAS.map(a => [a, a])); fill($("#p-area"), AREAS.map(a => [a, a]));
fill($("#c-crop"), CROPS.map(c => [c, c])); fill($("#h-crop"), CROPS.map(c => [c, c]));
fill($("#h-span"), OPTIONS.spans.map(v => [v, `${v} m`]), 5.4);
fill($("#h-pitch"), OPTIONS.pitches.map(v => [v, `${Math.round(v * 100)} cm`]), 0.5);
fill($("#h-pipe"), OPTIONS.pipes.map(x => [x.d, x.label]), 25.4);
fill($("#h-film"), OPTIONS.films.map(x => [x.id, x.label]), "po015");
fill($("#h-filmyear"), [["", "不明"], ...years.map(y => [y, `${y}年`])], thisYear - 1);
fill($("#h-builtyear"), [["", "不明"], ...years.map(y => [y, `${y}年`]), ["old", `${thisYear - 31}年以前`]], "");
fill($("#h-sidevent"), OPTIONS.sideVents.map(x => [x.id, x.label]), "both");
fill($("#h-ventdrive"), OPTIONS.drives.map(x => [x.id, x.label]), "manual");
fill($("#h-curtain"), OPTIONS.curtains.map(x => [x.id, x.label]), "none");
fill($("#h-irrigation"), OPTIONS.irrigations.map(x => [x.id, x.label]), "none");
fill($("#h-condition"), CONDITIONS.map(c => [c, c]), "良好");
const ridgeHelp = () => { const rr = ridgeRange(Number($("#h-span").value), Number($("#h-eave").value)); $("#h-ridge-help").textContent = `目安 ${rr.min}〜${rr.max}m(標準 ${rr.suggested}m)`; if (!$("#h-ridge").dataset.touched) $("#h-ridge").value = rr.suggested; };
$("#h-span").addEventListener("change", ridgeHelp); $("#h-eave").addEventListener("input", ridgeHelp); $("#h-ridge").addEventListener("input", () => { $("#h-ridge").dataset.touched = "1"; }); ridgeHelp();
$("#c-crop").addEventListener("change", () => { $("#h-crop").value = $("#c-crop").value; });
$("#c-area").addEventListener("change", () => { $("#p-area").value = $("#c-area").value; });
$("#c-staff").addEventListener("change", e => { localStorage.setItem("mitaka-staff-name", e.target.value.trim()); $("#who").textContent = `担当: ${e.target.value.trim()}`; });
$("#c-existing").addEventListener("change", async () => {
  const c = customers.find(x => x.id === $("#c-existing").value); const dis = !!c;
  ["c-name", "c-farm", "c-tel", "c-address"].forEach(id => { $("#" + id).readOnly = dis; });
  if (c) { $("#c-name").value = c.name || ""; $("#c-farm").value = c.farmName || ""; $("#c-tel").value = c.tel || ""; $("#c-address").value = c.address || ""; $("#c-area").value = c.area || AREAS[0]; $("#c-crop").value = c.crop || CROPS[0]; $("#p-area").value = c.area || AREAS[0]; }
  else ["c-name", "c-farm", "c-tel", "c-address"].forEach(id => { $("#" + id).value = ""; });
});
$("#geo-btn").addEventListener("click", () => {
  if (!navigator.geolocation) return ($("#geo-msg").textContent = "この端末では位置情報を使えません");
  $("#geo-msg").textContent = "取得中...";
  navigator.geolocation.getCurrentPosition(pos => { $("#p-lat").value = pos.coords.latitude.toFixed(6); $("#p-lng").value = pos.coords.longitude.toFixed(6); $("#geo-msg").textContent = `精度 約${Math.round(pos.coords.accuracy)}m`; }, err => { $("#geo-msg").textContent = "取得できませんでした: " + err.message; }, { enableHighAccuracy: true, timeout: 10000 });
});
let photos = [];
async function shrink(file) { const bmp = await createImageBitmap(file); const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height)); const c = document.createElement("canvas"); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale); c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", 0.72); }
$("#h-photos").addEventListener("change", async e => { for (const f of [...e.target.files].slice(0, 2 - photos.length)) { try { photos.push(await shrink(f)); } catch { toast("画像を読み込めませんでした"); } } $("#photo-strip").innerHTML = photos.map(p => `<img src="${p}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid var(--line)">`).join(""); e.target.value = ""; });
let houses = [];
function readHouse() {
  const params = normalizeParams({ span: $("#h-span").value, length: $("#h-length").value, eave: $("#h-eave").value, ridge: $("#h-ridge").value, pitch: $("#h-pitch").value, pipe: $("#h-pipe").value, film: $("#h-film").value, doors: $("#h-doors").value, sideVent: $("#h-sidevent").value, ventDrive: $("#h-ventdrive").value, roofVent: $("#h-roofvent").checked, curtain: $("#h-curtain").value, insectNet: $("#h-net").checked, irrigation: $("#h-irrigation").value, snow: $("#h-snow").checked, install: "full", region: "gunma" });
  return { name: $("#h-name").value.trim() || `${houses.length + 1}号`, params, crop: $("#h-crop").value, filmYear: $("#h-filmyear").value || null, builtYear: $("#h-builtyear").value === "old" ? thisYear - 35 : ($("#h-builtyear").value || null), condition: $("#h-condition").value, notes: $("#h-notes").value.trim(), photos: [...photos], history: [] };
}
function renderHouses() {
  $("#house-count").textContent = String(houses.length);
  $("#house-list").innerHTML = houses.map((h, i) => `<div class="flex between" style="border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin-bottom:6px"><span><b>${esc(h.name)}</b> 間口${h.params.span}m×奥行${h.params.length}m / ${esc(OPTIONS.films.find(f => f.id === h.params.film).label)}</span><button class="btn sm ghost" type="button" data-rm="${i}" style="color:var(--danger)">削除</button></div>`).join("");
}
$("#add-house").addEventListener("click", () => { houses.push(readHouse()); photos = []; $("#photo-strip").innerHTML = ""; $("#h-name").value = ""; $("#h-notes").value = ""; renderHouses(); toast(`${houses[houses.length - 1].name} を追加しました`); $("#h-name").placeholder = `例: ${houses.length + 1}号`; });
$("#house-list").addEventListener("click", e => { const b = e.target.closest("[data-rm]"); if (b) { houses.splice(Number(b.dataset.rm), 1); renderHouses(); } });
$("#reg").addEventListener("submit", async e => {
  e.preventDefault();
  const msg = $("#reg-msg");
  if (!$("#k-agree").checked) return (msg.textContent = "同意の確認にチェックを入れてください");
  if (!$("#c-name").value.trim() || !$("#c-tel").value.trim()) return (msg.textContent = "お名前と電話番号は必須です");
  if (!$("#p-name").value.trim()) return (msg.textContent = "圃場名を入れてください");
  if (!houses.length) houses.push(readHouse());
  msg.textContent = "保存中...";
  try {
    const existing = customers.find(x => x.id === $("#c-existing").value);
    const consent = { agreedAt: new Date().toISOString().slice(0, 10), statsOk: $("#k-stats").checked, showcaseOk: $("#k-showcase").checked, staff: $("#c-staff").value.trim() };
    const cust = await store.saveCustomer(existing
      ? { ...existing, area: $("#c-area").value, crop: $("#c-crop").value, consent: existing.consent || consent }
      : { name: $("#c-name").value.trim(), farmName: $("#c-farm").value.trim(), tel: $("#c-tel").value.trim(), kind: $("#c-kind").value, area: $("#c-area").value, address: $("#c-address").value.trim(), crop: $("#c-crop").value, staff: $("#c-staff").value.trim(), consent });
    for (const [purpose, granted] of [["karte", true], ["stats", consent.statsOk], ["showcase", consent.showcaseOk]]) await store.saveConsent({ customerId: cust.id, purpose, granted, grantedOn: consent.agreedAt });
    const plot = await store.savePlot({ customerId: cust.id, name: $("#p-name").value.trim(), area: $("#p-area").value, lat: parseFloat($("#p-lat").value) || null, lng: parseFloat($("#p-lng").value) || null, note: $("#p-note").value.trim() });
    let last = null;
    for (const h of houses) last = await store.saveHouse({ ...h, customerId: cust.id, plotId: plot.id, area: cust.area });
    await store.saveInteraction({ customerId: cust.id, channel: "visit", topic: "雑談", body: `訪問してハウスカルテを登録(${houses.length}棟)`, staff: consent.staff });
    const url = new URL(`karte.html?c=${cust.karteToken || cust.code}`, location.href).href;
    $("#result").hidden = false;
    $("#karte-link").textContent = url; $("#karte-link").href = url; $("#cust-code").textContent = cust.code;
    $("#show3d").href = `simulator.html?${encodeParams(last.params)}`;
    $("#qr").innerHTML = ""; try { const qr = window.qrcode(0, "M"); qr.addData(url); qr.make(); $("#qr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2 }); } catch { $("#qr").textContent = "QRコードを作成できませんでした"; }
    $("#share-btn").onclick = async () => { const text = `${cust.farmName || cust.name} 様のハウスカルテです。${url}`; if (navigator.share) { try { await navigator.share({ title: "ハウスカルテ", text, url }); } catch {} } else { (await copyText(text)) && toast("送る文面をコピーしました"); } };
    $("#copy-link").onclick = async () => toast((await copyText(url)) ? "URLをコピーしました" : "コピーできませんでした");
    msg.textContent = `${cust.name} 様: ${houses.length}棟を登録しました`;
    houses = []; renderHouses(); $("#k-agree").checked = false;
    await refreshAll(); $("#result").scrollIntoView({ behavior: "smooth" });
  } catch (err) { console.error(err); msg.textContent = "保存に失敗しました: " + err.message; }
});

// ---------------- データ ----------------
$("#export").addEventListener("click", async () => { const data = await store.exportAll(); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" })); a.download = `mitaka-crm-${new Date().toISOString().slice(0, 10)}.json`; a.click(); });
$("#import").addEventListener("change", async e => { const f = e.target.files[0]; if (!f) return; try { await store.importAll(JSON.parse(await f.text())); toast("読み込みました"); refreshAll(); } catch (err) { toast("読み込めませんでした: " + err.message); } e.target.value = ""; });
$("#seed").addEventListener("click", async () => { await seedDemo(true); toast("デモデータを追加しました"); refreshAll(); });
$("#wipe").addEventListener("click", async () => { if (!confirm("この端末に保存されたデータを全て削除します。よろしいですか?")) return; try { await store.clearAll(); toast("削除しました"); refreshAll(); } catch (err) { toast(err.message); } });
async function renderData() {
  $("#data-msg").textContent = store.kind === "supabase" ? "本番DB(Supabase)に保存しています。" : "ブラウザ保存モードです。この端末のブラウザにだけデータが残ります。本番はconfig.jsでSupabaseに接続します。";
  const ev = await store.listEvents(20);
  $("#ec-list").innerHTML = ev.length ? ev.map(e => `<div>${esc(fmtDateTime(e.occurredAt))} ・ ${esc({ product_view: "商品を見た", cart_add: "かごに入れた", sim_save: "3Dで作った", quote_request: "見積を依頼", karte_view: "カルテを見た" }[e.type] || e.type)}${e.productCode ? ` ・ ${esc(e.productCode)}` : ""}</div>`).join("") : `<p class="muted">まだ記録がありません。</p>`;
}

async function refreshAll() { await refreshCustomers(); await renderToday(); await renderData(); }
document.addEventListener("karte:change", () => { if (!app.hidden) refreshAll(); });
