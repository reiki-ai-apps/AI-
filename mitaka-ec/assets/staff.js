// 担当者用: ハウスカルテ登録・お客様一覧・データ管理
import { CONFIG } from "./config.js";
import { initSite, toast, copyText, esc } from "./site.js";
import { OPTIONS, ridgeRange, normalizeParams, encodeParams } from "./pricing.js";
import { store, seedDemo, CROPS, CONDITIONS, AREAS, houseStatus } from "./store.js";

initSite();
const $ = s => document.querySelector(s);
const fill = (sel, pairs, selected) => { sel.innerHTML = pairs.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(selected) ? " selected" : ""}>${esc(l)}</option>`).join(""); };
const thisYear = new Date().getFullYear();
const years = Array.from({ length: 31 }, (_, i) => thisYear - i);

// ---- 簡易ロック ----
const lock = $("#lock"), app = $("#app");
function unlocked() { return sessionStorage.getItem("mitaka-staff-ok") === "1"; }
function open() { lock.hidden = true; app.hidden = false; refreshCustomers(); }
$("#unlock").addEventListener("click", () => { if ($("#pin").value === CONFIG.staffPin) { sessionStorage.setItem("mitaka-staff-ok", "1"); open(); } else $("#lock-msg").textContent = "コードが違います"; });
$("#pin").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("#unlock").click(); } });
if (unlocked()) open();
$("#store-kind").textContent = store.kind === "supabase" ? "本番DB(Supabase)に保存" : "ブラウザ保存モード";

// ---- 選択肢 ----
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

// ステップ表示(スクロール位置で更新)
const steps = [...document.querySelectorAll(".stepper span")];
const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { const n = e.target.id.replace("step", ""); steps.forEach(s => s.classList.toggle("on", s.dataset.step === n)); } }, { rootMargin: "-40% 0px -50% 0px" });
["step1", "step2", "step3", "step4"].forEach(id => io.observe(document.getElementById(id)));

// ---- 既存のお客様 ----
let customers = [];
async function refreshCustomers() {
  customers = await store.listCustomers();
  fill($("#c-existing"), [["", "(新規のお客様)"], ...customers.map(c => [c.id, `${c.name}${c.farmName ? " / " + c.farmName : ""}(${c.code})`])]);
  renderCustList();
}
$("#c-existing").addEventListener("change", () => {
  const c = customers.find(x => x.id === $("#c-existing").value);
  const dis = !!c;
  ["c-name", "c-farm", "c-tel", "c-address"].forEach(id => { $("#" + id).readOnly = dis; });
  if (c) { $("#c-name").value = c.name || ""; $("#c-farm").value = c.farmName || ""; $("#c-tel").value = c.tel || ""; $("#c-address").value = c.address || ""; $("#c-area").value = c.area || AREAS[0]; $("#c-crop").value = c.crop || CROPS[0]; $("#p-area").value = c.area || AREAS[0]; }
  else ["c-name", "c-farm", "c-tel", "c-address"].forEach(id => { $("#" + id).value = ""; });
});
async function renderCustList() {
  const kw = ($("#cust-search").value || "").trim();
  const all = await store.listAllHouses();
  const list = customers.filter(c => !kw || [c.name, c.farmName, c.tel, c.code].join(" ").includes(kw));
  $("#cust-total").textContent = `${customers.length}名 / ${all.length}棟`;
  $("#cust-list").innerHTML = list.length ? list.slice(0, 50).map(c => {
    const hs = all.filter(h => h.customerId === c.id);
    const due = hs.filter(h => houseStatus(h).level === "due").length;
    return `<div class="cust-row"><div><div class="nm">${esc(c.name)} <span class="muted small">${esc(c.farmName || "")}</span></div><div class="sub">${esc(c.area || "")} / ${hs.length}棟${due ? ` / <span style="color:var(--danger)">要対応 ${due}棟</span>` : ""} / ${esc(c.code)}</div></div>
      <div class="tools"><a class="btn sm ghost" href="karte.html?c=${esc(c.code)}" target="_blank">カルテ</a><button class="btn sm ghost" type="button" data-add-to="${esc(c.id)}">棟を追加</button></div></div>`;
  }).join("") : `<p class="muted small mt-2">まだ登録がありません。</p>`;
}
$("#cust-search").addEventListener("input", renderCustList);
$("#cust-list").addEventListener("click", e => { const b = e.target.closest("[data-add-to]"); if (!b) return; $("#c-existing").value = b.dataset.addTo; $("#c-existing").dispatchEvent(new Event("change")); document.getElementById("step2").scrollIntoView({ behavior: "smooth" }); });

// ---- 位置 ----
$("#geo-btn").addEventListener("click", () => {
  if (!navigator.geolocation) return ($("#geo-msg").textContent = "この端末では位置情報を使えません");
  $("#geo-msg").textContent = "取得中...";
  navigator.geolocation.getCurrentPosition(pos => { $("#p-lat").value = pos.coords.latitude.toFixed(6); $("#p-lng").value = pos.coords.longitude.toFixed(6); $("#geo-msg").textContent = `精度 約${Math.round(pos.coords.accuracy)}m`; }, err => { $("#geo-msg").textContent = "取得できませんでした: " + err.message; }, { enableHighAccuracy: true, timeout: 10000 });
});

// ---- 写真 ----
let photos = [];
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.72);
}
$("#h-photos").addEventListener("change", async e => {
  for (const f of [...e.target.files].slice(0, 2 - photos.length)) { try { photos.push(await shrink(f)); } catch { toast("画像を読み込めませんでした"); } }
  $("#photo-strip").innerHTML = photos.map(p => `<img src="${p}" alt="">`).join("");
  e.target.value = "";
});

// ---- ハウスの追加 ----
let houses = [];
function readHouse() {
  const params = normalizeParams({
    span: $("#h-span").value, length: $("#h-length").value, eave: $("#h-eave").value, ridge: $("#h-ridge").value, pitch: $("#h-pitch").value, pipe: $("#h-pipe").value,
    film: $("#h-film").value, doors: $("#h-doors").value, sideVent: $("#h-sidevent").value, ventDrive: $("#h-ventdrive").value, roofVent: $("#h-roofvent").checked,
    curtain: $("#h-curtain").value, insectNet: $("#h-net").checked, irrigation: $("#h-irrigation").value, snow: $("#h-snow").checked, install: "full", region: "gunma"
  });
  return { name: $("#h-name").value.trim() || `${houses.length + 1}号`, params, crop: $("#h-crop").value, filmYear: $("#h-filmyear").value || null, builtYear: $("#h-builtyear").value === "old" ? thisYear - 35 : ($("#h-builtyear").value || null), condition: $("#h-condition").value, notes: $("#h-notes").value.trim(), photos: [...photos], history: [] };
}
function renderHouses() {
  $("#house-count").textContent = String(houses.length);
  $("#house-list").innerHTML = houses.map((h, i) => `<div class="house-item"><span><b>${esc(h.name)}</b> 間口${h.params.span}m×奥行${h.params.length}m / ${esc(OPTIONS.films.find(f => f.id === h.params.film).label)} / ${esc(h.crop)}${h.photos.length ? ` / 写真${h.photos.length}枚` : ""}</span><button class="rm" type="button" data-rm="${i}" style="background:none;border:0;color:var(--danger);cursor:pointer">削除</button></div>`).join("");
}
$("#add-house").addEventListener("click", () => {
  houses.push(readHouse()); photos = []; $("#photo-strip").innerHTML = ""; $("#h-name").value = ""; $("#h-notes").value = ""; renderHouses(); toast(`${houses[houses.length - 1].name} を追加しました`);
  $("#h-name").placeholder = `例: ${houses.length + 1}号`;
});
$("#house-list").addEventListener("click", e => { const b = e.target.closest("[data-rm]"); if (!b) return; houses.splice(Number(b.dataset.rm), 1); renderHouses(); });

// ---- 登録・発行 ----
$("#reg").addEventListener("submit", async e => {
  e.preventDefault();
  const msg = $("#reg-msg");
  if (!$("#k-agree").checked) return (msg.textContent = "同意の確認にチェックを入れてください");
  if (!$("#c-name").value.trim() || !$("#c-tel").value.trim()) return (msg.textContent = "お名前と電話番号は必須です");
  if (!$("#p-name").value.trim()) return (msg.textContent = "圃場名を入れてください");
  if (!houses.length) houses.push(readHouse()); // 「追加」を押していなければ入力中の1棟を登録
  msg.textContent = "保存中...";
  try {
    const existing = customers.find(x => x.id === $("#c-existing").value);
    const consent = { agreedAt: new Date().toISOString().slice(0, 10), statsOk: $("#k-stats").checked, showcaseOk: $("#k-showcase").checked, staff: $("#c-staff").value.trim() };
    const cust = await store.saveCustomer(existing ? { ...existing, area: $("#c-area").value, crop: $("#c-crop").value, consent: existing.consent || consent } :
      { name: $("#c-name").value.trim(), farmName: $("#c-farm").value.trim(), tel: $("#c-tel").value.trim(), area: $("#c-area").value, address: $("#c-address").value.trim(), crop: $("#c-crop").value, staff: $("#c-staff").value.trim(), lineLinked: false, consent });
    const plot = await store.savePlot({ customerId: cust.id, name: $("#p-name").value.trim(), area: $("#p-area").value, lat: parseFloat($("#p-lat").value) || null, lng: parseFloat($("#p-lng").value) || null, note: $("#p-note").value.trim() });
    let last = null;
    for (const h of houses) last = await store.saveHouse({ ...h, customerId: cust.id, plotId: plot.id, area: cust.area, consent: cust.consent });
    const url = new URL(`karte.html?c=${cust.code}`, location.href).href;
    $("#result").hidden = false;
    $("#karte-link").textContent = url; $("#karte-link").href = url; $("#cust-code").textContent = cust.code;
    $("#show3d").href = `simulator.html?${encodeParams(last.params)}`;
    $("#qr").innerHTML = ""; try { const qr = window.qrcode(0, "M"); qr.addData(url); qr.make(); $("#qr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2 }); } catch (err) { $("#qr").textContent = "QRコードを作成できませんでした"; }
    $("#share-btn").onclick = async () => { const text = `${cust.farmName || cust.name} 様のハウスカルテです。${url}`; if (navigator.share) { try { await navigator.share({ title: "ハウスカルテ", text, url }); } catch {} } else { (await copyText(text)) && toast("送る文面をコピーしました。LINEやメールに貼り付けてください"); } };
    $("#copy-link").onclick = async () => toast((await copyText(url)) ? "URLをコピーしました" : "コピーできませんでした");
    msg.textContent = `${cust.name} 様: ${houses.length}棟を登録しました`;
    houses = []; renderHouses(); $("#k-agree").checked = false;
    await refreshCustomers();
    $("#result").scrollIntoView({ behavior: "smooth" });
  } catch (err) { console.error(err); msg.textContent = "保存に失敗しました: " + err.message; }
});

// ---- データ管理 ----
$("#export").addEventListener("click", async () => {
  const data = await store.exportAll();
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" })); a.download = `karte-${new Date().toISOString().slice(0, 10)}.json`; a.click();
});
$("#import").addEventListener("change", async e => { const f = e.target.files[0]; if (!f) return; try { await store.importAll(JSON.parse(await f.text())); toast("読み込みました"); refreshCustomers(); } catch (err) { toast("読み込めませんでした: " + err.message); } e.target.value = ""; });
$("#seed").addEventListener("click", async () => { await seedDemo(true); toast("デモデータを追加しました"); refreshCustomers(); });
$("#wipe").addEventListener("click", async () => { if (!confirm("この端末に保存されたカルテを全て削除します。よろしいですか?")) return; try { await store.clearAll(); toast("削除しました"); refreshCustomers(); } catch (err) { toast(err.message); } });
document.addEventListener("karte:change", () => { if (!app.hidden) refreshCustomers(); });
