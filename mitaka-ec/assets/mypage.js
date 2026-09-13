// お客様向け: マイページ(購入履歴 + ハウスカルテ + 次にやること)
import { CONFIG } from "./config.js";
import { initSite, toast, copyText, esc, addToQuoteList } from "./site.js";
import { OPTIONS, computeGeometry, encodeParams, estimateRecover, yen } from "./pricing.js";
import { store, seedDemo, houseStatus, logEc, QUOTE_STATUS } from "./store.js";
import { PRODUCTS } from "./catalog-data.js";

initSite();
const $ = s => document.querySelector(s);
const filmLabel = id => (OPTIONS.films.find(f => f.id === id) || {}).label || id;
const label = (list, id) => (list.find(x => x.id === id) || {}).label || id;

async function main() {
  const code = (new URLSearchParams(location.search).get("c") || "").trim().toUpperCase();
  if (!code) return showEnter();
  let cust = await store.getCustomerByCode(code);
  if (!cust && code.startsWith("DEMO")) { await seedDemo(); cust = await store.getCustomerByCode(code); }
  if (!cust) return showEnter(`お客様コード「${code}」のカルテが見つかりません。コードをご確認ください。`);
  const [plots, houses, quotes] = await Promise.all([store.listPlots(cust.id), store.listHouses(cust.id), store.listQuotes(cust.id)]);
  render(cust, plots, houses, quotes);
}
function showEnter(msg = "") {
  $("#enter").hidden = false; $("#enter-msg").textContent = msg;
  $("#enter-form").addEventListener("submit", e => { e.preventDefault(); const v = $("#code-input").value.trim(); if (v) location.href = `mypage.html?c=${encodeURIComponent(v.toUpperCase())}`; });
}

function render(c, plots, houses, quotes = []) {
  $("#karte").hidden = false;
  try { localStorage.setItem("mitaka-karte-last", JSON.stringify({ code: c.code, token: c.karteToken, customerId: c.id, name: c.name, farmName: c.farmName, houses: houses.map(h => ({ id: h.id, name: h.name, params: h.params })) })); } catch {}
  logEc("karte_view", { customerId: c.id });
  document.title = `${c.farmName || c.name} のマイページ｜三高産業 ハウスEC`;
  $("#k-title").textContent = `${c.farmName ? c.farmName + " " : ""}${c.name} 様`;
  $("#k-sub").textContent = `${c.area || ""}${c.address ? " " + c.address : ""} / 主な作物: ${c.crop || "-"} / お客様コード ${c.code}${c.staff ? " / 担当: " + c.staff : ""}`;
  const line = $("#k-line");
  if (CONFIG.lineAddFriendUrl) line.href = CONFIG.lineAddFriendUrl; else { line.href = "#"; line.addEventListener("click", e => { e.preventDefault(); toast("LINE公式アカウントは準備中です。お知らせは担当者から電話・メールでお伝えします"); }); }
  $("#k-share").addEventListener("click", async () => toast((await copyText(location.href)) ? "マイページのURLをコピーしました" : "コピーできませんでした"));
  const cs = c.consent || {};
  const mark = v => v ? "はい" : "いいえ";
  $("#k-consent").innerHTML = `ご登録日: ${esc(cs.agreedAt || "-")}<br>
    個人がわからない集計(ハウス図鑑)への利用: <b>${mark(cs.statsOk)}</b> ／
    JA・提携する資材店・メーカーへの提供: <b>${mark(cs.shareOk)}</b> ／
    事例としての掲載: <b>${mark(cs.showcaseOk)}</b><br>
    <a href="privacy.html" style="text-decoration:underline">それぞれの内容はこちら</a>。変更・取り消しは担当者へお申し付けください。すぐに反映します。`;

  // 次にやること
  const todo = [];
  for (const h of houses) {
    const s = houseStatus(h);
    if (s.level === "due" || s.level === "soon") todo.push({ level: s.level, t: `${h.name}: ${s.text}`, s: `${h.params.span}m × ${h.params.length}m / ${filmLabel(h.params.film)}`, act: h.condition === "要補修" || h.condition === "要相談" ? `<a class="btn sm" href="quote.html?house=${esc(h.id)}">相談する</a>` : `<a class="btn sm" href="quote.html?house=${esc(h.id)}&mode=recover">張り替えを見積る</a>` });
  }
  const m = new Date().getMonth() + 1;
  const season = m >= 8 && m <= 10 ? "台風シーズンです。パッカーの緩み、妻面ドアのガタつき、被覆材の裂けを点検しましょう。" : m >= 11 || m <= 1 ? "降雪期です。積雪時の補強(中柱・タイバー)と、保温カーテンの点検をおすすめします。" : m >= 2 && m <= 4 ? "張り替えの適期です。作付け前の張り替えは早めのご予約をおすすめします。" : "高温期です。換気・遮光・潅水の状態を確認しましょう。";
  todo.push({ level: "ok", t: "季節のお手入れ", s: season, act: `<a class="btn sm ghost" href="catalog.html">資材を見る</a>` });
  $("#todo").innerHTML = todo.map(x => `<div class="todo-item ${x.level}"><span class="dot"></span><div><div class="t">${esc(x.t)}</div><div class="s">${esc(x.s)}</div></div><div class="no-print">${x.act}</div></div>`).join("");

  // 買ったもの・見積りの履歴
  $("#house-count").textContent = `${houses.length}棟`;
  renderOrders(quotes, houses);

  // 圃場ごと
  const groups = plots.map(p => ({ plot: p, houses: houses.filter(h => h.plotId === p.id) }));
  const orphan = houses.filter(h => !plots.some(p => p.id === h.plotId));
  if (orphan.length) groups.push({ plot: { id: "none", name: "圃場未設定", area: c.area }, houses: orphan });
  $("#plots").innerHTML = groups.map(g => `
    <section class="plot">
      <div class="plot-head">
        <div class="card" style="padding:1rem 1.2rem">
          <h2 style="font-size:1.25rem;margin:0 0 .25rem">${esc(g.plot.name)} <span class="muted small" style="font-weight:400">${esc(g.plot.area || "")}</span></h2>
          <div class="muted small">${g.houses.length}棟 / 合計 ${g.houses.reduce((s, h) => s + computeGeometry(h.params).floorArea, 0).toFixed(0)} m²${g.plot.note ? " / " + esc(g.plot.note) : ""}</div>
          ${g.plot.lat && g.plot.lng ? `<a class="small no-print" href="https://www.google.com/maps?q=${g.plot.lat},${g.plot.lng}" target="_blank" rel="noopener">地図アプリで開く</a>` : `<span class="small muted">位置は未登録です</span>`}
        </div>
        <div class="mini-map" data-lat="${g.plot.lat || ""}" data-lng="${g.plot.lng || ""}"></div>
      </div>
      <div class="houses">${g.houses.map(h => houseCard(h)).join("")}</div>
    </section>`).join("");
  document.querySelectorAll(".mini-map").forEach(el => miniMap(el, parseFloat(el.dataset.lat), parseFloat(el.dataset.lng)));

  // 操作
  $("#plots").addEventListener("click", e => {
    const img = e.target.closest(".photos img"); if (img) { img.classList.toggle("big"); return; }
    const b = e.target.closest("[data-recover]"); if (!b) return;
    const h = houses.find(x => x.id === b.dataset.recover); const box = document.getElementById(`rc-${h.id}`);
    if (!box.hidden) { box.hidden = true; return; }
    const r = estimateRecover(h.params);
    box.hidden = false;
    box.innerHTML = `<div class="muted small">被覆材 ${esc(r.film.label)} への張り替え概算(施工込み・税込)</div><div class="big">${yen(r.total)}</div><div class="small muted">${r.lines.map(l => `${esc(l.label)} ${yen(l.amount)}`).join(" / ")}<br>${esc(r.notes[0])}</div><a class="btn sm accent mt-1" href="quote.html?house=${esc(h.id)}&mode=recover">この内容で見積依頼</a>`;
  });
}

// ---- 買ったもの・見積りの履歴 ----
const statusLabel = id => (QUOTE_STATUS.find(x => x.id === id) || {}).label || id;
const statusClass = id => ["done", "approved", "in_progress"].includes(id) ? "ok" : id === "lost" ? "" : "soon";
function renderOrders(quotes, houses) {
  const rows = [];
  for (const q of quotes) {
    rows.push({
      date: (q.createdAt || "").slice(0, 10),
      what: q.message || "お見積り",
      sum: q.total,
      badge: statusLabel(q.status), badgeCls: statusClass(q.status),
      items: Array.isArray(q.items) ? q.items : [],
      kind: "quote"
    });
  }
  for (const h of houses) for (const x of (h.history || [])) {
    rows.push({ date: x.date, what: `${h.name}: ${x.type} — ${x.summary}`, sum: x.amount || null, badge: "工事", badgeCls: "ok", items: [], kind: "work" });
  }
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const el = $("#orders");
  if (!rows.length) {
    el.innerHTML = `<div class="empty-box">まだ履歴がありません。ご注文やお見積りをいただくと、ここに並びます。<br><a href="catalog.html">資材をさがす</a></div>`;
    return;
  }
  el.innerHTML = `<div class="orders">${rows.map((r, i) => {
    const names = r.items.map(it => (PRODUCTS.find(p => p.id === it.id) || {}).name).filter(Boolean);
    return `<div class="order">
      <div>
        <div class="when">${esc(r.date || "")} <span class="badge ${r.badgeCls}">${esc(r.badge)}</span></div>
        <div class="what">${esc(r.what)}</div>
        ${names.length ? `<div class="muted small">${esc(names.join(" / "))}</div>` : ""}
      </div>
      <div style="text-align:right">
        ${r.sum != null ? `<div class="sum">${yen(r.sum)}<small class="muted" style="font-weight:400"> 税込</small></div>` : `<div class="muted small">金額はご相談</div>`}
        <div class="acts2 no-print" style="justify-content:flex-end;margin-top:6px">
          ${r.items.length ? `<button class="btn sm accent" type="button" data-reorder="${i}">もう一度かごに入れる</button>` : ""}
          <a class="btn sm ghost" href="quote.html">同じ内容で相談</a>
        </div>
      </div>
    </div>`;
  }).join("")}</div>`;
  el.addEventListener("click", e => {
    const b = e.target.closest("[data-reorder]"); if (!b) return;
    const r = rows[Number(b.dataset.reorder)];
    let n = 0;
    for (const it of r.items) {
      const p = PRODUCTS.find(x => x.id === it.id); if (!p) continue;
      addToQuoteList({ id: p.id, name: p.name, spec: p.spec, price: p.price, unit: p.unit }, it.qty || 1); n++;
    }
    toast(n ? `${n}品をかごに入れました。「資材をさがす」のかごから見積依頼できます` : "この履歴には品番の記録がありません");
  });
}

function houseCard(h) {
  const g = computeGeometry(h.params), s = houseStatus(h), p = h.params;
  return `<article class="house" id="house-${esc(h.id)}">
    <div class="hd"><h3>${esc(h.name)}</h3><span class="badge ${s.level}">${s.level === "due" ? "要対応" : s.level === "soon" ? "来年目安" : "良好"}</span></div>
    <dl class="spec">
      <dt>大きさ</dt><dd>間口 ${p.span}m × 奥行 ${p.length}m(${g.floorArea.toFixed(0)}m² / 約${g.tsubo.toFixed(0)}坪)</dd>
      <dt>高さ・骨組</dt><dd>肩高 ${p.eave}m / 棟高 ${p.ridge}m / φ${p.pipe}mm @${Math.round(p.pitch * 100)}cm${p.snow ? " / 耐雪補強" : ""}</dd>
      <dt>被覆材</dt><dd>${esc(filmLabel(p.film))}${h.filmYear ? `(${h.filmYear}年張り)` : ""}</dd>
      <dt>設備</dt><dd>${esc(label(OPTIONS.sideVents, p.sideVent))}${p.sideVent !== "none" ? "(" + esc(label(OPTIONS.drives, p.ventDrive)) + ")" : ""} / カーテン: ${esc(label(OPTIONS.curtains, p.curtain))} / 潅水: ${esc(label(OPTIONS.irrigations, p.irrigation))}${p.roofVent ? " / 天窓" : ""}</dd>
      <dt>作物・建築</dt><dd>${esc(h.crop || "-")}${h.builtYear ? ` / ${h.builtYear}年建築(${s.age}年)` : ""}</dd>
      <dt>状態</dt><dd>${esc(h.condition || "-")} <span class="muted">${esc(s.text)}</span></dd>
    </dl>
    ${h.notes ? `<div class="note-box">${esc(h.notes)}</div>` : ""}
    ${(h.photos || []).length ? `<div class="photos">${h.photos.map(src => `<img src="${src}" alt="${esc(h.name)}の写真">`).join("")}</div>` : ""}
    ${(h.history || []).length ? `<ul class="hist">${h.history.map(x => `<li>${esc(x.date)} ${esc(x.type)}: ${esc(x.summary)}${x.amount ? ` (${yen(x.amount)})` : ""}</li>`).join("")}</ul>` : ""}
    <div class="recover" id="rc-${esc(h.id)}" hidden></div>
    <div class="acts">
      <a class="btn sm outline" href="simulator.html?${encodeParams(p)}" target="_blank">3Dで見る</a>
      <button class="btn sm" type="button" data-recover="${esc(h.id)}">張り替えを見積る</button>
      <a class="btn sm ghost" href="quote.html?house=${esc(h.id)}">修理・相談</a>
      <a class="btn sm ghost" href="simulator.html?${encodeParams(p)}" target="_blank">同じ仕様で新設を見積る</a>
    </div>
  </article>`;
}

// 地理院タイル(淡色地図)で簡易マップを描く
function miniMap(el, lat, lng) {
  if (!isFinite(lat) || !isFinite(lng)) { el.innerHTML = `<div class="nopos">位置が未登録です</div>`; return; }
  const z = 16, n = 2 ** z;
  const xf = (lng + 180) / 360 * n;
  const latR = lat * Math.PI / 180;
  const yf = (1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n;
  const x0 = Math.floor(xf), y0 = Math.floor(yf);
  const px = 256 + (xf - x0) * 256, py = 256 + (yf - y0) * 256; // 3×3タイル内のピン位置
  const w = el.clientWidth || 260, hgt = el.clientHeight || 180;
  const tiles = document.createElement("div"); tiles.className = "tiles";
  tiles.style.left = `${w / 2 - px}px`; tiles.style.top = `${hgt / 2 - py}px`;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const img = document.createElement("img"); img.alt = ""; img.loading = "lazy"; img.onerror = () => { img.style.visibility = "hidden"; };
    img.src = `https://cyberjapandata.gsi.go.jp/xyz/pale/${z}/${x0 + dx}/${y0 + dy}.png`; tiles.appendChild(img);
  }
  el.innerHTML = ""; el.append(tiles); const pin = document.createElement("div"); pin.className = "pin"; el.append(pin);
  const attr = document.createElement("div"); attr.className = "attr"; attr.textContent = "地理院タイル"; el.append(attr);
}

main().catch(err => { console.error(err); showEnter("読み込みに失敗しました: " + err.message); });
