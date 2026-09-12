// 顧客データ層。既定はブラウザ保存(localStorage)、config.js に Supabase を入れると本番DB。
// 中心は「顧客・圃場・ハウス」に加えて、接点ログ(interactions)・見積(quotes)・やること(tasks)。
// 接点ログと同意とECイベントは追記型: 消さずに足す。
import { CONFIG } from "./config.js";
import { normalizeParams } from "./pricing.js";

const KEY = "mitaka-karte-v2";
const EMPTY = { customers: [], plots: [], houses: [], interactions: [], quotes: [], tasks: [], events: [], consents: [], houseEvents: [] };
export const CROPS = ["トマト", "きゅうり", "いちご", "なす", "ほうれん草", "小松菜", "花き", "ぶどう", "その他"];
export const CONDITIONS = ["良好", "要補修", "要相談"];
export const AREAS = ["桐生市", "みどり市", "太田市", "伊勢崎市", "前橋市", "足利市", "館林市", "その他"];
export const TOPICS = ["見積", "修理", "納期", "注文", "苦情", "雑談"];
export const CHANNELS = [
  { id: "phone_in", label: "電話(受)" }, { id: "phone_out", label: "電話(架)" },
  { id: "line", label: "LINE" }, { id: "visit", label: "訪問" }, { id: "fax", label: "FAX" }, { id: "mail", label: "メール" }
];
export const QUOTE_STATUS = [
  { id: "requested", label: "依頼あり" }, { id: "drafted", label: "作成中" }, { id: "sent", label: "提出済" },
  { id: "approved", label: "受注" }, { id: "in_progress", label: "施工中" }, { id: "done", label: "完了" }, { id: "lost", label: "失注" }
];
export const TASK_KIND = { film_due: "張り替え時期", quote_followup: "見積の追いかけ", inspection: "点検", callback: "折り返し", disaster_check: "災害後の確認" };

export function uid(prefix = "") { return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }
export function customerCode() { const s = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let c = ""; for (let i = 0; i < 6; i++) c += s[Math.floor(Math.random() * s.length)]; return c; }
// カルテURL用のトークン。お客様コード(6桁)とは分ける: 6桁は総当たりできてしまうため
export function karteToken() { const a = new Uint8Array(16); (globalThis.crypto || {}).getRandomValues?.(a); return [...a].map(v => v.toString(16).padStart(2, "0")).join("") || uid("t_") + uid(""); }
export function normTel(t) { return String(t || "").replace(/[^\d]/g, ""); }
const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (n, from = new Date()) => { const d = new Date(from); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// ---------------- ブラウザ保存 ----------------
class LocalStore {
  constructor() { this.kind = "local"; }
  _read() { try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); return v ? { ...EMPTY, ...v } : { ...EMPTY }; } catch { return { ...EMPTY }; } }
  _write(db) { localStorage.setItem(KEY, JSON.stringify(db)); document.dispatchEvent(new CustomEvent("karte:change")); }
  _put(table, row, prefix) {
    const db = this._read(); row.updatedAt = now();
    if (!row.id) { row.id = uid(prefix); row.createdAt = row.createdAt || row.updatedAt; db[table].push(row); }
    else { const i = db[table].findIndex(x => x.id === row.id); i >= 0 ? db[table][i] = row : db[table].push(row); }
    this._write(db); return row;
  }
  async listCustomers() { return this._read().customers.filter(c => !c.mergedIntoId).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")); }
  async getCustomer(id) { return this._read().customers.find(c => c.id === id) || null; }
  async getCustomerByCode(code) { const k = String(code || "").toUpperCase(); return this._read().customers.find(c => c.code === k || c.karteToken === String(code)) || null; }
  async findByTel(tel) { const t = normTel(tel); if (t.length < 3) return []; return this._read().customers.filter(c => normTel(c.tel).includes(t)); }
  async saveCustomer(c) { if (!c.code) c.code = customerCode(); if (!c.karteToken) c.karteToken = karteToken(); if (!c.status) c.status = "active"; return this._put("customers", c, "c_"); }
  async listPlots(customerId) { return this._read().plots.filter(p => p.customerId === customerId); }
  async savePlot(p) { return this._put("plots", p, "p_"); }
  async listHouses(customerId) { return this._read().houses.filter(h => h.customerId === customerId); }
  async listAllHouses() { return this._read().houses; }
  async saveHouse(h) { return this._put("houses", h, "h_"); }
  async deleteHouse(id) { const db = this._read(); db.houses = db.houses.filter(h => h.id !== id); this._write(db); }
  async listInteractions(customerId) { const all = this._read().interactions; return (customerId ? all.filter(i => i.customerId === customerId) : all).sort((a, b) => (b.occurredAt || "").localeCompare(a.occurredAt || "")); }
  async saveInteraction(i) { if (!i.occurredAt) i.occurredAt = now(); return this._put("interactions", i, "i_"); }
  async listQuotes(customerId) { const all = this._read().quotes; return (customerId ? all.filter(q => q.customerId === customerId) : all).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")); }
  async saveQuote(q) { if (!q.status) q.status = "requested"; if (!q.quoteNo) q.quoteNo = "Q" + new Date().toISOString().slice(2, 10).replace(/-/g, "") + "-" + Math.floor(Math.random() * 900 + 100); return this._put("quotes", q, "q_"); }
  async listTasks(onlyOpen = true) { const all = this._read().tasks; return (onlyOpen ? all.filter(t => t.status === "open") : all).sort((a, b) => (a.dueOn || "").localeCompare(b.dueOn || "")); }
  async saveTask(t) { if (!t.status) t.status = "open"; return this._put("tasks", t, "t_"); }
  async logEvent(e) { const db = this._read(); db.events.push({ id: uid("e_"), occurredAt: now(), ...e }); if (db.events.length > 500) db.events = db.events.slice(-500); this._write(db); }
  async listEvents(limit = 50) { return this._read().events.slice(-limit).reverse(); }
  async saveConsent(c) { return this._put("consents", { grantedOn: today(), ...c }, "s_"); }
  async listHouseEvents(houseId) { const all = this._read().houseEvents; return (houseId ? all.filter(e => e.houseId === houseId) : all).sort((a, b) => (b.occurredOn || "").localeCompare(a.occurredOn || "")); }
  async saveHouseEvent(e) { if (!e.occurredOn) e.occurredOn = today(); return this._put("houseEvents", e, "he_"); }
  async exportAll() { return this._read(); }
  async importAll(json) { const db = this._read(); for (const k of Object.keys(EMPTY)) for (const r of (json[k] || [])) { const i = db[k].findIndex(x => x.id === r.id); i >= 0 ? db[k][i] = r : db[k].push(r); } this._write(db); }
  async clearAll() { localStorage.removeItem(KEY); document.dispatchEvent(new CustomEvent("karte:change")); }
}

// ---------------- Supabase(schema.sql v2 の列に対応) ----------------
const CUSTOMER_COLS = { id: "id", code: "customer_code", karteToken: "karte_token", kind: "kind", name: "name", farmName: "farm_name", tel: "tel_display", email: "email", area: "area_code", address: "address", crop: "crop", staff: "owner_staff_id", salesCode: "sales_system_code", status: "status", mergedIntoId: "merged_into_id", note: "note", createdAt: "created_at", updatedAt: "updated_at" };
const HOUSE_COLS = { id: "id", customerId: "customer_id", plotId: "plot_id", name: "house_no", crop: "crop", area: "area_code", condition: "condition", status: "status", builtYear: "built_year", notes: "note", createdAt: "created_at", updatedAt: "updated_at" };
const PLOT_COLS = { id: "id", customerId: "customer_id", name: "name", area: "area_code", lat: "lat", lng: "lng", note: "note" };
const INTERACTION_COLS = { id: "id", customerId: "customer_id", houseId: "house_id", channel: "channel", topic: "topic_tag", occurredAt: "occurred_at", staff: "staff_id", body: "body", nextActionOn: "next_action_on" };
const QUOTE_COLS = { id: "id", quoteNo: "quote_no", customerId: "customer_id", houseId: "house_id", source: "source", status: "status", pricingVersion: "pricing_version", subtotal: "subtotal", tax: "tax", total: "total", name: "contact_name", tel: "contact_tel", email: "contact_email", place: "place", message: "message", createdAt: "created_at", updatedAt: "updated_at" };
const TASK_COLS = { id: "id", customerId: "customer_id", houseId: "house_id", quoteId: "quote_id", kind: "kind", title: "title", dueOn: "due_on", status: "status" };
const toRow = (obj, cols, extra = {}) => { const r = { ...extra }; for (const [k, col] of Object.entries(cols)) if (obj[k] !== undefined) r[col] = obj[k]; return r; };
const fromRow = (row, cols, extra = () => ({})) => { const o = { ...extra(row) }; for (const [k, col] of Object.entries(cols)) if (row[col] !== undefined && row[col] !== null) o[k] = row[col]; return o; };

class SupabaseStore {
  constructor(url, key) { this.kind = "supabase"; this.url = url.replace(/\/$/, ""); this.key = key; }
  async _req(path, opts = {}) {
    const r = await fetch(`${this.url}/rest/v1/${path}`, { ...opts, headers: { apikey: this.key, Authorization: `Bearer ${this.token || this.key}`, "Content-Type": "application/json", Prefer: opts.prefer || "return=representation", ...(opts.headers || {}) } });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  }
  _upsert(table, row) { return this._req(`${table}?on_conflict=id`, { method: "POST", prefer: "resolution=merge-duplicates,return=representation", body: JSON.stringify(row) }).then(rows => rows[0]); }
  async listCustomers() { return (await this._req("customers?select=*&merged_into_id=is.null&order=updated_at.desc&limit=500")).map(r => fromRow(r, CUSTOMER_COLS)); }
  async getCustomer(id) { const r = await this._req(`customers?id=eq.${encodeURIComponent(id)}&select=*`); return r[0] ? fromRow(r[0], CUSTOMER_COLS) : null; }
  async getCustomerByCode(code) { const r = await this._req(`customers?or=(customer_code.eq.${encodeURIComponent(String(code).toUpperCase())},karte_token.eq.${encodeURIComponent(code)})&select=*`); return r[0] ? fromRow(r[0], CUSTOMER_COLS) : null; }
  async findByTel(tel) { const t = normTel(tel); if (t.length < 3) return []; return (await this._req(`customers?tel_norm=like.*${t}*&select=*&limit=20`)).map(r => fromRow(r, CUSTOMER_COLS)); }
  async saveCustomer(c) { c.id = c.id || uid("c_"); c.code = c.code || customerCode(); c.karteToken = c.karteToken || karteToken(); c.updatedAt = now(); return fromRow(await this._upsert("customers", toRow(c, CUSTOMER_COLS, { tel_norm: normTel(c.tel), data: c.data || {} })), CUSTOMER_COLS); }
  async listPlots(customerId) { return (await this._req(`plots?customer_id=eq.${encodeURIComponent(customerId)}&select=*`)).map(r => fromRow(r, PLOT_COLS)); }
  async savePlot(p) { p.id = p.id || uid("p_"); return fromRow(await this._upsert("plots", toRow(p, PLOT_COLS)), PLOT_COLS); }
  _houseRow(h) { const p = h.params || {}; return toRow(h, HOUSE_COLS, { span_m: p.span, length_m: p.length, eave_m: p.eave, ridge_m: p.ridge, pipe_mm: p.pipe, pitch_m: p.pitch, film_type: p.film, film_installed_on: h.filmYear ? `${h.filmYear}-01-01` : null, spec: p }); }
  _houseObj(r) { return fromRow(r, HOUSE_COLS, row => ({ params: row.spec || {}, filmYear: row.film_installed_on ? Number(String(row.film_installed_on).slice(0, 4)) : null, history: [] })); }
  async listHouses(customerId) { return (await this._req(`houses?customer_id=eq.${encodeURIComponent(customerId)}&select=*`)).map(r => this._houseObj(r)); }
  async listAllHouses() { return (await this._req("houses?select=*&status=eq.active&limit=2000")).map(r => this._houseObj(r)); }
  async saveHouse(h) { h.id = h.id || uid("h_"); h.updatedAt = now(); return this._houseObj(await this._upsert("houses", this._houseRow(h))); }
  async deleteHouse(id) { return this._req(`houses?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ status: "dismantled" }) }); }
  async listInteractions(customerId) { const q = customerId ? `&customer_id=eq.${encodeURIComponent(customerId)}` : ""; return (await this._req(`interactions?select=*${q}&order=occurred_at.desc&limit=200`)).map(r => fromRow(r, INTERACTION_COLS)); }
  async saveInteraction(i) { i.id = i.id || uid("i_"); i.occurredAt = i.occurredAt || now(); return fromRow(await this._upsert("interactions", toRow(i, INTERACTION_COLS)), INTERACTION_COLS); }
  async listQuotes(customerId) { const q = customerId ? `&customer_id=eq.${encodeURIComponent(customerId)}` : ""; return (await this._req(`quotes?select=*${q}&order=created_at.desc&limit=200`)).map(r => fromRow(r, QUOTE_COLS)); }
  async saveQuote(q) { q.id = q.id || uid("q_"); q.updatedAt = now(); const row = toRow(q, QUOTE_COLS, { sim_params: q.simParams || null }); return fromRow(await this._upsert("quotes", row), QUOTE_COLS); }
  async listTasks(onlyOpen = true) { const f = onlyOpen ? "&status=eq.open" : ""; return (await this._req(`tasks?select=*${f}&order=due_on.asc&limit=200`)).map(r => fromRow(r, TASK_COLS)); }
  async saveTask(t) { t.id = t.id || uid("t_"); return fromRow(await this._upsert("tasks", toRow(t, TASK_COLS)), TASK_COLS); }
  async logEvent(e) { try { await this._req("ec_events", { method: "POST", prefer: "return=minimal", body: JSON.stringify({ id: uid("e_"), occurred_at: now(), visitor_id: e.visitorId || null, customer_id: e.customerId || null, event_type: e.type, product_code: e.productCode || null, ref: e.ref || null }) }); } catch { /* 記録できなくても操作は止めない */ } }
  async listEvents(limit = 50) { return (await this._req(`ec_events?select=*&order=occurred_at.desc&limit=${limit}`)).map(r => ({ id: r.id, occurredAt: r.occurred_at, type: r.event_type, productCode: r.product_code, customerId: r.customer_id })); }
  async saveConsent(c) { return this._upsert("consents", { id: c.id || uid("s_"), customer_id: c.customerId, purpose: c.purpose, granted: c.granted, granted_on: c.grantedOn || today() }); }
  async listHouseEvents(houseId) { const q = houseId ? `&house_id=eq.${encodeURIComponent(houseId)}` : ""; return (await this._req(`house_events?select=*${q}&order=occurred_on.desc&limit=500`)).map(r => ({ id: r.id, houseId: r.house_id, type: r.event_type, occurredOn: r.occurred_on, summary: r.summary, amount: r.amount, staff: r.staff_id })); }
  async saveHouseEvent(e) { const row = { id: e.id || uid("he_"), house_id: e.houseId, event_type: e.type, occurred_on: e.occurredOn || today(), summary: e.summary || null, amount: e.amount || null, staff_id: e.staff || null }; await this._upsert("house_events", row); return e; }
  async exportAll() { const [customers, plots, houses, interactions, quotes] = await Promise.all([this.listCustomers(), this._req("plots?select=*").then(r => r.map(x => fromRow(x, PLOT_COLS))), this.listAllHouses(), this.listInteractions(), this.listQuotes()]); return { customers, plots, houses, interactions, quotes }; }
  async importAll(json) { for (const c of json.customers || []) await this.saveCustomer(c); for (const p of json.plots || []) await this.savePlot(p); for (const h of json.houses || []) await this.saveHouse(h); }
  async clearAll() { throw new Error("本番DBの全削除は管理画面から行ってください"); }
}

export const store = CONFIG.supabaseUrl && CONFIG.supabaseAnonKey ? new SupabaseStore(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey) : new LocalStore();

// ---------------- 災害時の被害度 ----------------
export const DAMAGE = [
  { id: "none", label: "被害なし", rank: 0, color: "#7FB069" },
  { id: "minor", label: "軽微", rank: 1, color: "#F2C14E" },
  { id: "major", label: "大きい", rank: 2, color: "#E8622A" },
  { id: "destroyed", label: "倒壊・全損", rank: 3, color: "#B3261E" },
  { id: "unknown", label: "未確認", rank: 1.5, color: "#8A948E" }
];
export const damageOf = id => DAMAGE.find(d => d.id === id) || DAMAGE[4];

// ---------------- ECの行動ログ ----------------
// 取るのは5種だけ: 商品を見た / かごに入れた / 3Dで作った / 見積を依頼 / カルテを見た。
// マウスの動きや広告IDは取らない。訪問者IDは端末内の乱数で、後からお客様に結びついたときだけ紐づく。
export function visitorId() {
  try { let v = localStorage.getItem("mitaka-visitor"); if (!v) { v = uid("v_"); localStorage.setItem("mitaka-visitor", v); } return v; } catch { return null; }
}
export async function logEc(type, extra = {}) {
  try {
    let customerId = extra.customerId || null;
    if (!customerId) { const k = JSON.parse(localStorage.getItem("mitaka-karte-last") || "null"); customerId = k?.customerId || null; }
    await store.logEvent({ type, visitorId: visitorId(), customerId, ...extra });
  } catch { /* 記録できなくても操作は止めない */ }
}

// ---------------- ハウスの状態(張り替え時期) ----------------
export const FILM_YEARS = { novi010: 2, po015: 3, po_multi: 5, po_diffuse: 4 };
export function houseStatus(h, base = new Date()) {
  const y = base.getFullYear();
  const life = FILM_YEARS[h.params?.film] || 3;
  const due = h.filmYear ? Number(h.filmYear) + life : null;
  const remain = due ? due - y : null;
  let level = "ok", text = "被覆材は当面問題ありません";
  if (remain != null && remain <= 0) { level = "due"; text = `被覆材の張り替え時期です(目安 ${due}年)`; }
  else if (remain === 1) { level = "soon"; text = `来年(${due}年)が張り替えの目安です`; }
  else if (remain != null) text = `次の張り替え目安は ${due}年ごろ`;
  if (h.condition === "要補修") { level = "due"; text = "要補修: 点検・修理をおすすめします"; }
  if (h.condition === "要相談") { level = level === "due" ? "due" : "soon"; text = "ご相談中の内容があります"; }
  return { level, text, due, remain, age: h.builtYear ? y - Number(h.builtYear) : null, life };
}

// ---------------- 「今日やること」の組み立て ----------------
// 入力させるのではなく、溜まったデータから自動で出す。
export async function todayList() {
  const [tasks, quotes, houses, customers, interactions] = await Promise.all([
    store.listTasks(true), store.listQuotes(), store.listAllHouses(), store.listCustomers(), store.listInteractions()
  ]);
  const byId = new Map(customers.map(c => [c.id, c]));
  const out = [];
  const t0 = today();
  for (const t of tasks) out.push({ kind: t.kind, level: (t.dueOn || "9999") <= t0 ? "due" : "soon", title: t.title || TASK_KIND[t.kind] || "やること", who: byId.get(t.customerId), due: t.dueOn, taskId: t.id, customerId: t.customerId });
  for (const q of quotes.filter(q => ["requested", "drafted", "sent"].includes(q.status))) {
    const days = Math.floor((Date.now() - new Date(q.createdAt || q.updatedAt || Date.now())) / 86400000);
    if (q.status === "requested") out.push({ kind: "quote_new", level: "due", title: `見積の依頼が来ています(${q.quoteNo || ""})`, who: byId.get(q.customerId) || { name: q.name, farmName: "" }, due: null, quoteId: q.id, customerId: q.customerId });
    else if (days >= 7) out.push({ kind: "quote_followup", level: "soon", title: `提出から${days}日、返事がありません(${q.quoteNo || ""})`, who: byId.get(q.customerId), quoteId: q.id, customerId: q.customerId });
  }
  for (const h of houses) {
    const s = houseStatus(h);
    if (s.level === "due") out.push({ kind: "film_due", level: "due", title: `${h.name}: ${s.text}`, who: byId.get(h.customerId), houseId: h.id, customerId: h.customerId });
  }
  for (const i of interactions.filter(i => i.nextActionOn && i.nextActionOn <= t0)) out.push({ kind: "callback", level: "due", title: `折り返し: ${(i.body || "").slice(0, 24)}`, who: byId.get(i.customerId), due: i.nextActionOn, customerId: i.customerId });
  const rank = { due: 0, soon: 1, ok: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || (a.due || "").localeCompare(b.due || ""));
}

// データが溜まっているかの目安
export async function healthStats() {
  const [customers, houses, interactions, quotes] = await Promise.all([store.listCustomers(), store.listAllHouses(), store.listInteractions(), store.listQuotes()]);
  const m30 = Date.now() - 30 * 86400000;
  const withTel = customers.filter(c => normTel(c.tel).length >= 9).length;
  const dup = new Set(); const seen = new Map();
  for (const c of customers) { const t = normTel(c.tel); if (!t) continue; if (seen.has(t)) dup.add(t); seen.set(t, c.id); }
  const fresh = customers.filter(c => new Date(c.updatedAt || 0).getTime() > Date.now() - 365 * 86400000).length;
  return {
    customers: customers.length, houses: houses.length,
    interactions30: interactions.filter(i => new Date(i.occurredAt || 0).getTime() > m30).length,
    quotesOpen: quotes.filter(q => ["requested", "drafted", "sent"].includes(q.status)).length,
    telRate: customers.length ? Math.round(withTel / customers.length * 100) : 0,
    filmYearRate: houses.length ? Math.round(houses.filter(h => h.filmYear).length / houses.length * 100) : 0,
    dup: dup.size, freshRate: customers.length ? Math.round(fresh / customers.length * 100) : 0
  };
}

// ---------------- デモデータ ----------------
export async function seedDemo(force = false) {
  const existing = await store.listCustomers();
  // デモ3件が無ければ入れる(他のデータが入っていても、デモのカルテは開けるように)
  if (existing.some(c => c.code === "DEMO01") && !force) return false;
  const base = { lat: 36.405, lng: 139.33 };
  const demo = [
    { code: "DEMO01", name: "山田 太郎", farmName: "山田農園(デモ)", tel: "0277-00-0001", area: "桐生市", address: "群馬県桐生市新里町", crop: "トマト", kind: "individual", staff: "担当A",
      consent: { agreedAt: "2026-06-12", statsOk: true, shareOk: true, showcaseOk: false, staff: "担当A" },
      plots: [
        { name: "自宅裏", lat: base.lat + 0.002, lng: base.lng + 0.001, houses: [
          { name: "1号", params: { span: 5.4, length: 30, eave: 1.6, ridge: 3.0, pitch: 0.5, pipe: 25.4, film: "po015", doors: 2, sideVent: "both", ventDrive: "manual", roofVent: false, curtain: "manual", insectNet: true, irrigation: "drip", snow: false }, filmYear: 2023, builtYear: 2015, crop: "トマト", condition: "良好", notes: "南側の巻き上げがやや重い", history: [{ date: "2023-03-10", type: "張り替え", summary: "農PO 0.15mm 全面張り替え", amount: 198000 }, { date: "2025-09-02", type: "修理", summary: "台風後、妻面ドア調整・パッカー交換", amount: 12800 }] },
          { name: "2号", params: { span: 5.4, length: 30, eave: 1.6, ridge: 3.0, pitch: 0.5, pipe: 25.4, film: "novi010", doors: 2, sideVent: "both", ventDrive: "manual", roofVent: false, curtain: "none", insectNet: false, irrigation: "drip", snow: false }, filmYear: 2024, builtYear: 2015, crop: "トマト", condition: "良好", notes: "", history: [{ date: "2024-02-20", type: "張り替え", summary: "農ビ 0.1mm 張り替え", amount: 86000 }] }
        ] },
        { name: "川向こう", lat: base.lat - 0.004, lng: base.lng + 0.006, houses: [
          { name: "3号", params: { span: 7.2, length: 40, eave: 1.8, ridge: 3.6, pitch: 0.5, pipe: 31.8, film: "po_multi", doors: 2, sideVent: "both", ventDrive: "motor", roofVent: true, curtain: "motor", insectNet: true, irrigation: "drip", snow: true }, filmYear: 2021, builtYear: 2021, crop: "トマト", condition: "要補修", notes: "北側妻面のフィルムに裂け目(2026-08 確認)", history: [{ date: "2021-05-15", type: "新設", summary: "7.2m×40m 耐雪仕様 新設", amount: 4380000 }] }
        ] }
      ],
      talks: [
        { channel: "phone_in", topic: "修理", body: "3号の妻面が破れたので見てほしい。来週は在宅。", days: -3, next: 2 },
        { channel: "visit", topic: "見積", body: "訪問。3号の張り替えと妻面修理を提案。予算感は50万まで。", days: -2, next: null }
      ],
      quotes: [
        { source: "karte", status: "sent", total: 528000, subtotal: 480000, days: -9, message: "3号の被覆材張り替え" },
        { source: "catalog", status: "done", total: 268400, subtotal: 244000, days: -186, message: "1号 農PO 0.15mm 張り替え資材一式", items: [{ id: "GN-FL-PO015", qty: 2 }, { id: "GN-PK-25", qty: 6 }, { id: "TT-FS-SP", qty: 4 }] },
        { source: "catalog", status: "done", total: 12760, subtotal: 11600, days: -305, message: "パイプクロス・パッカー 追加", items: [{ id: "ST-CR-PC", qty: 3 }, { id: "GN-PK-25", qty: 2 }] },
        { source: "catalog", status: "done", total: 24200, subtotal: 22000, days: -462, message: "潅水の部材", items: [{ id: "GN-IR-DRIP", qty: 1 }, { id: "GN-IR-FILTER", qty: 1 }] }
      ]
    },
    { code: "DEMO02", name: "佐々木 花子", farmName: "ささき苺園(デモ)", tel: "0277-00-0002", area: "みどり市", address: "群馬県みどり市笠懸町", crop: "いちご", kind: "corporate", staff: "担当B",
      consent: { agreedAt: "2026-07-03", statsOk: true, shareOk: true, showcaseOk: true, staff: "担当B" },
      plots: [{ name: "笠懸第1", lat: base.lat + 0.012, lng: base.lng + 0.02, houses: [
        { name: "A棟", params: { span: 6.0, length: 50, eave: 1.8, ridge: 3.4, pitch: 0.5, pipe: 25.4, film: "po_diffuse", doors: 2, sideVent: "both", ventDrive: "motor", roofVent: false, curtain: "motor", insectNet: true, irrigation: "drip", snow: false }, filmYear: 2022, builtYear: 2018, crop: "いちご", condition: "良好", notes: "高設栽培", history: [{ date: "2022-08-01", type: "張り替え", summary: "散乱光PO 張り替え・内張カーテン更新", amount: 420000 }] },
        { name: "B棟", params: { span: 6.0, length: 50, eave: 1.8, ridge: 3.4, pitch: 0.5, pipe: 25.4, film: "po_diffuse", doors: 2, sideVent: "both", ventDrive: "motor", roofVent: false, curtain: "motor", insectNet: true, irrigation: "drip", snow: false }, filmYear: 2022, builtYear: 2018, crop: "いちご", condition: "良好", notes: "", history: [] }
      ] }],
      talks: [{ channel: "line", topic: "注文", body: "点滴チューブ2巻を追加。次回配達のときに。", days: -1, next: null }],
      quotes: [
        { source: "catalog", status: "requested", total: 32560, subtotal: 29600, days: 0, message: "点滴チューブ 2巻", items: [{ id: "GN-IR-DRIP", qty: 2 }] },
        { source: "karte", status: "done", total: 462000, subtotal: 420000, days: -1140, message: "A棟 散乱光PO 張り替え・内張カーテン更新" }
      ]
    },
    { code: "DEMO03", name: "鈴木 一郎", farmName: "鈴木園芸(デモ)", tel: "0277-00-0003", area: "太田市", address: "群馬県太田市", crop: "花き", kind: "individual", staff: "担当A",
      consent: { agreedAt: "2026-08-20", statsOk: false, shareOk: false, showcaseOk: false, staff: "担当A" },
      plots: [{ name: "本圃場", lat: base.lat - 0.02, lng: base.lng + 0.05, houses: [
        { name: "花1", params: { span: 4.5, length: 20, eave: 1.5, ridge: 2.7, pitch: 0.45, pipe: 22.2, film: "novi010", doors: 1, sideVent: "one", ventDrive: "manual", roofVent: false, curtain: "none", insectNet: false, irrigation: "none", snow: false }, filmYear: 2022, builtYear: 2009, crop: "花き", condition: "要相談", notes: "建て替えを検討中。補助金の相談あり", history: [] }
      ] }],
      talks: [{ channel: "phone_in", topic: "見積", body: "建て替えの補助金の話。来年度の申請に間に合わせたい。", days: -12, next: 5 }],
      quotes: []
    }
  ];
  for (const d of demo) {
    const { plots, talks, quotes, consent, ...cust } = d;
    const c = await store.saveCustomer({ ...cust, id: undefined, consent });
    for (const [purpose, granted] of [["karte", true], ["stats", !!consent.statsOk], ["share_ja", !!consent.shareOk], ["showcase", !!consent.showcaseOk]]) await store.saveConsent({ customerId: c.id, purpose, granted, grantedOn: consent.agreedAt });
    for (const pl of plots) {
      const { houses, ...plot } = pl;
      const p = await store.savePlot({ ...plot, customerId: c.id, area: c.area });
      for (const h of houses) await store.saveHouse({ ...h, params: normalizeParams(h.params), customerId: c.id, plotId: p.id, area: c.area, photos: [] });
    }
    for (const t of talks || []) await store.saveInteraction({ customerId: c.id, channel: t.channel, topic: t.topic, body: t.body, staff: c.staff, occurredAt: new Date(Date.now() + t.days * 86400000).toISOString(), nextActionOn: t.next ? addDays(t.next) : null });
    for (const q of quotes || []) await store.saveQuote({ customerId: c.id, source: q.source, status: q.status, total: q.total, subtotal: q.subtotal, message: q.message, items: q.items || null, name: c.name, tel: c.tel, createdAt: new Date(Date.now() + q.days * 86400000).toISOString() });
  }
  return true;
}
