// ハウスカルテのデータ層。
// 既定はブラウザ保存(localStorage)。config.js に Supabase の接続情報を入れると本番DBに保存します。
import { CONFIG } from "./config.js";
import { normalizeParams } from "./pricing.js";

const KEY = "mitaka-karte-v1";
export const CROPS = ["トマト", "きゅうり", "いちご", "なす", "ほうれん草", "小松菜", "花き", "ぶどう", "その他"];
export const CONDITIONS = ["良好", "要補修", "要相談"];
export const AREAS = ["桐生市", "みどり市", "太田市", "伊勢崎市", "前橋市", "足利市", "館林市", "その他"];

export function uid(prefix = "") { return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }
export function customerCode() { const s = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let c = ""; for (let i = 0; i < 6; i++) c += s[Math.floor(Math.random() * s.length)]; return c; }
const now = () => new Date().toISOString();

// ---- ブラウザ保存 ----
class LocalStore {
  constructor() { this.kind = "local"; }
  _read() { try { return JSON.parse(localStorage.getItem(KEY) || "null") || { customers: [], plots: [], houses: [] }; } catch { return { customers: [], plots: [], houses: [] }; } }
  _write(db) { localStorage.setItem(KEY, JSON.stringify(db)); document.dispatchEvent(new CustomEvent("karte:change")); }
  async listCustomers() { return this._read().customers.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")); }
  async getCustomer(id) { return this._read().customers.find(c => c.id === id) || null; }
  async getCustomerByCode(code) { return this._read().customers.find(c => c.code === String(code).toUpperCase()) || null; }
  async saveCustomer(c) { const db = this._read(); c.updatedAt = now(); if (!c.id) { c.id = uid("c_"); c.code = c.code || customerCode(); c.createdAt = c.updatedAt; db.customers.push(c); } else { const i = db.customers.findIndex(x => x.id === c.id); i >= 0 ? db.customers[i] = c : db.customers.push(c); } this._write(db); return c; }
  async listPlots(customerId) { return this._read().plots.filter(p => p.customerId === customerId); }
  async savePlot(p) { const db = this._read(); if (!p.id) { p.id = uid("p_"); db.plots.push(p); } else { const i = db.plots.findIndex(x => x.id === p.id); i >= 0 ? db.plots[i] = p : db.plots.push(p); } this._write(db); return p; }
  async listHouses(customerId) { return this._read().houses.filter(h => h.customerId === customerId); }
  async listAllHouses() { return this._read().houses; }
  async saveHouse(h) { const db = this._read(); h.updatedAt = now(); if (!h.id) { h.id = uid("h_"); h.createdAt = h.updatedAt; db.houses.push(h); } else { const i = db.houses.findIndex(x => x.id === h.id); i >= 0 ? db.houses[i] = h : db.houses.push(h); } this._write(db); return h; }
  async deleteHouse(id) { const db = this._read(); db.houses = db.houses.filter(h => h.id !== id); this._write(db); }
  async exportAll() { return this._read(); }
  async importAll(json) { const db = this._read(); for (const k of ["customers", "plots", "houses"]) for (const r of (json[k] || [])) { const i = db[k].findIndex(x => x.id === r.id); i >= 0 ? db[k][i] = r : db[k].push(r); } this._write(db); }
  async clearAll() { localStorage.removeItem(KEY); document.dispatchEvent(new CustomEvent("karte:change")); }
}

// ---- Supabase(PostgREST) 保存。テーブル定義は supabase/schema.sql ----
class SupabaseStore {
  constructor(url, key) { this.kind = "supabase"; this.url = url.replace(/\/$/, ""); this.key = key; }
  async _req(path, opts = {}) {
    const r = await fetch(`${this.url}/rest/v1/${path}`, { ...opts, headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, "Content-Type": "application/json", Prefer: opts.prefer || "return=representation", ...(opts.headers || {}) } });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  }
  // 各テーブルは id / customer_id / code / updated_at と、レコード全体を入れる data(jsonb) 列で構成(supabase/schema.sql)
  _wrap(row) { return { id: row.id, customer_id: row.customerId || null, code: row.code || null, updated_at: row.updatedAt || now(), data: row }; }
  _unwrap(rows) { return (rows || []).map(r => r.data); }
  _upsert(table, row) { return this._req(`${table}?on_conflict=id`, { method: "POST", prefer: "resolution=merge-duplicates,return=representation", body: JSON.stringify(this._wrap(row)) }).then(rows => rows[0].data); }
  async listCustomers() { return this._unwrap(await this._req("customers?select=data&order=updated_at.desc")); }
  async getCustomer(id) { return this._unwrap(await this._req(`customers?id=eq.${encodeURIComponent(id)}&select=data`))[0] || null; }
  async getCustomerByCode(code) { return this._unwrap(await this._req(`customers?code=eq.${encodeURIComponent(String(code).toUpperCase())}&select=data`))[0] || null; }
  async saveCustomer(c) { c.id = c.id || uid("c_"); c.code = c.code || customerCode(); c.updatedAt = now(); c.createdAt = c.createdAt || c.updatedAt; return this._upsert("customers", c); }
  async listPlots(customerId) { return this._unwrap(await this._req(`plots?customer_id=eq.${encodeURIComponent(customerId)}&select=data`)); }
  async savePlot(p) { p.id = p.id || uid("p_"); return this._upsert("plots", p); }
  async listHouses(customerId) { return this._unwrap(await this._req(`houses?customer_id=eq.${encodeURIComponent(customerId)}&select=data`)); }
  async listAllHouses() { return this._unwrap(await this._req("houses?select=data")); }
  async saveHouse(h) { h.id = h.id || uid("h_"); h.updatedAt = now(); h.createdAt = h.createdAt || h.updatedAt; return this._upsert("houses", h); }
  async deleteHouse(id) { return this._req(`houses?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", prefer: "return=minimal" }); }
  async exportAll() { const [customers, plots, houses] = await Promise.all([this.listCustomers(), this._req("plots?select=data").then(r => this._unwrap(r)), this.listAllHouses()]); return { customers, plots, houses }; }
  async importAll(json) { for (const c of json.customers || []) await this._upsert("customers", c); for (const p of json.plots || []) await this._upsert("plots", p); for (const h of json.houses || []) await this._upsert("houses", h); }
  async clearAll() { throw new Error("本番DBの全削除は管理画面から行ってください"); }
}

export const store = CONFIG.supabaseUrl && CONFIG.supabaseAnonKey ? new SupabaseStore(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey) : new LocalStore();

// ---- ハウスの派生情報(張り替え目安など) ----
export const FILM_YEARS = { novi010: 2, po015: 3, po_multi: 5, po_diffuse: 4 };
export function houseStatus(h, today = new Date()) {
  const y = today.getFullYear();
  const life = FILM_YEARS[h.params?.film] || 3;
  const due = h.filmYear ? Number(h.filmYear) + life : null;
  const remain = due ? due - y : null;
  let level = "ok", text = "被覆材は当面問題ありません";
  if (remain != null && remain <= 0) { level = "due"; text = `被覆材の張り替え時期です(目安 ${due}年)`; }
  else if (remain != null && remain === 1) { level = "soon"; text = `来年(${due}年)が張り替えの目安です`; }
  else if (remain != null) text = `次の張り替え目安は ${due}年ごろ`; 
  if (h.condition === "要補修") { level = "due"; text = "要補修: 点検・修理をおすすめします"; }
  if (h.condition === "要相談") { level = level === "due" ? "due" : "soon"; text = "ご相談中の内容があります"; }
  const age = h.builtYear ? y - Number(h.builtYear) : null;
  return { level, text, due, remain, age, life };
}

// ---- デモデータ(サンプル。実際の顧客ではありません) ----
export async function seedDemo(force = false) {
  const existing = await store.listCustomers();
  if (existing.length && !force) return false;
  const base = { lat: 36.405, lng: 139.33 };
  const demo = [
    { code: "DEMO01", name: "山田 太郎", farmName: "山田農園(デモ)", tel: "0277-00-0001", area: "桐生市", address: "群馬県桐生市新里町", crop: "トマト", consent: { agreedAt: "2026-06-12", statsOk: true, showcaseOk: false, staff: "担当A" },
      plots: [
        { name: "自宅裏", lat: base.lat + 0.002, lng: base.lng + 0.001, houses: [
          { name: "1号", params: { span: 5.4, length: 30, eave: 1.6, ridge: 3.0, pitch: 0.5, pipe: 25.4, film: "po015", doors: 2, sideVent: "both", ventDrive: "manual", roofVent: false, curtain: "manual", insectNet: true, irrigation: "drip", snow: false }, filmYear: 2023, builtYear: 2015, crop: "トマト", condition: "良好", notes: "南側の巻き上げがやや重い", history: [{ date: "2023-03-10", type: "張り替え", summary: "農PO 0.15mm 全面張り替え", amount: 198000 }, { date: "2025-09-02", type: "修理", summary: "台風後、妻面ドア調整・パッカー交換", amount: 12800 }] },
          { name: "2号", params: { span: 5.4, length: 30, eave: 1.6, ridge: 3.0, pitch: 0.5, pipe: 25.4, film: "novi010", doors: 2, sideVent: "both", ventDrive: "manual", roofVent: false, curtain: "none", insectNet: false, irrigation: "drip", snow: false }, filmYear: 2024, builtYear: 2015, crop: "トマト", condition: "良好", notes: "", history: [{ date: "2024-02-20", type: "張り替え", summary: "農ビ 0.1mm 張り替え", amount: 86000 }] }
        ] },
        { name: "川向こう", lat: base.lat - 0.004, lng: base.lng + 0.006, houses: [
          { name: "3号", params: { span: 7.2, length: 40, eave: 1.8, ridge: 3.6, pitch: 0.5, pipe: 31.8, film: "po_multi", doors: 2, sideVent: "both", ventDrive: "motor", roofVent: true, curtain: "motor", insectNet: true, irrigation: "drip", snow: true }, filmYear: 2021, builtYear: 2021, crop: "トマト", condition: "要補修", notes: "北側妻面のフィルムに裂け目(2026-08 確認)", history: [{ date: "2021-05-15", type: "新設", summary: "7.2m×40m 耐雪仕様 新設", amount: 4380000 }] }
        ] }
      ] },
    { code: "DEMO02", name: "佐々木 花子", farmName: "ささき苺園(デモ)", tel: "0277-00-0002", area: "みどり市", address: "群馬県みどり市笠懸町", crop: "いちご", consent: { agreedAt: "2026-07-03", statsOk: true, showcaseOk: true, staff: "担当B" },
      plots: [
        { name: "笠懸第1", lat: base.lat + 0.012, lng: base.lng + 0.02, houses: [
          { name: "A棟", params: { span: 6.0, length: 50, eave: 1.8, ridge: 3.4, pitch: 0.5, pipe: 25.4, film: "po_diffuse", doors: 2, sideVent: "both", ventDrive: "motor", roofVent: false, curtain: "motor", insectNet: true, irrigation: "drip", snow: false }, filmYear: 2022, builtYear: 2018, crop: "いちご", condition: "良好", notes: "高設栽培", history: [{ date: "2022-08-01", type: "張り替え", summary: "散乱光PO 張り替え・内張カーテン更新", amount: 420000 }] },
          { name: "B棟", params: { span: 6.0, length: 50, eave: 1.8, ridge: 3.4, pitch: 0.5, pipe: 25.4, film: "po_diffuse", doors: 2, sideVent: "both", ventDrive: "motor", roofVent: false, curtain: "motor", insectNet: true, irrigation: "drip", snow: false }, filmYear: 2022, builtYear: 2018, crop: "いちご", condition: "良好", notes: "", history: [] }
        ] }
      ] },
    { code: "DEMO03", name: "鈴木 一郎", farmName: "鈴木園芸(デモ)", tel: "0277-00-0003", area: "太田市", address: "群馬県太田市", crop: "花き", consent: { agreedAt: "2026-08-20", statsOk: false, showcaseOk: false, staff: "担当A" },
      plots: [
        { name: "本圃場", lat: base.lat - 0.02, lng: base.lng + 0.05, houses: [
          { name: "花1", params: { span: 4.5, length: 20, eave: 1.5, ridge: 2.7, pitch: 0.45, pipe: 22.2, film: "novi010", doors: 1, sideVent: "one", ventDrive: "manual", roofVent: false, curtain: "none", insectNet: false, irrigation: "none", snow: false }, filmYear: 2022, builtYear: 2009, crop: "花き", condition: "要相談", notes: "建て替えを検討中。補助金の相談あり", history: [] }
        ] }
      ] }
  ];
  for (const d of demo) {
    const { plots, ...cust } = d;
    const c = await store.saveCustomer({ ...cust, lineLinked: false, id: undefined });
    for (const pl of plots) {
      const { houses, ...plot } = pl;
      const p = await store.savePlot({ ...plot, customerId: c.id, area: c.area });
      for (const h of houses) await store.saveHouse({ ...h, params: normalizeParams(h.params), customerId: c.id, plotId: p.id, photos: [] });
    }
  }
  return true;
}
