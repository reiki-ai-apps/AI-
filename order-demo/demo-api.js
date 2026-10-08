// お試し版（URLを開くだけ版）: サーバーの代わりに、このブラウザの中だけにデータを保存する。
// ログインは「管理者」として入った状態を再現する（お試し版では誰でも管理者）。
(function () {
  const META = window.__DEMO_META__;
  const KEY = "order_demo_v2";
  const realFetch = window.fetch.bind(window);
  const DEMO_USER = {id: 1, username: "demo", display_name: "お試し管理者", role: "admin", role_label: "管理者", contractor: ""};
  const ROLES = {admin: "管理者", manager: "管理職", staff: "営業・事務", contractor: "工事会社"};

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {seq: 0, orders: [], audit: []}; }
    catch (e) { return {seq: 0, orders: [], audit: []}; }
  }
  function save(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {}
  }

  function derive(fields) {
    const m = META.masters;
    const find = (list, name) => list.find((x) => x.name === String(name || "").trim()) || {};
    fields.contractor_code = find(m.contractors, fields.contractor).code || "";
    fields.kubun_cls = find(m.kubun, fields.kubun_company).cls || "";
    fields.work_type_cls = find(m.work_types, fields.work_type).cls || "";
    fields.industry_cls = find(m.industries, fields.industry).cls || "";
  }

  function validate(fields) {
    const errors = [];
    META.fields.forEach((f) => {
      const value = String(fields[f.key] ?? "").trim();
      if (f.required && !value) errors.push(`「${f.label}」を入力してください。`);
      if (f.type === "line" && value.length > f.maxlen) errors.push(`「${f.label}」は${f.maxlen}文字以内にしてください。`);
    });
    if (fields.period_start && fields.period_end && fields.period_start > fields.period_end) {
      errors.push("工期の開始が終了より後になっています。");
    }
    return errors;
  }

  function json(status, data) {
    return new Response(JSON.stringify(data), {status, headers: {"Content-Type": "application/json; charset=utf-8"}});
  }
  const now = () => new Date().toISOString();
  const yearOf = (fields) => Number(String(fields.input_date || "").slice(0, 4)) || new Date().getFullYear();

  function listOrders(db, staff, year, q) {
    let items = db.orders.filter((o) => o.year === year && (!staff || o.staff === staff));
    const needle = String(q || "").trim().toLowerCase();
    if (needle) {
      items = items.filter((o) => ["customer_name", "work_name", "site", "contractor", "billing_to"]
        .some((k) => String(o.fields[k] || "").toLowerCase().includes(needle)));
    }
    return items.sort((a, b) => String(a.fields.input_date).localeCompare(String(b.fields.input_date)) || a.id - b.id);
  }

  async function handle(url, options) {
    const method = (options.method || "GET").toUpperCase();
    const path = url.pathname.replace(/^.*\/api\//, "/api/");
    const body = options.body ? JSON.parse(options.body) : {};
    const db = load();
    let match;

    if (path === "/api/me") return json(200, {user: DEMO_USER});
    if (path === "/api/login") return json(200, {user: DEMO_USER, next: "index.html"});
    if (path === "/api/logout") return json(200, {message: "お試し版ではログアウトしても同じ画面に戻ります。"});
    if (path === "/api/meta") return json(200, {...META, current_year: new Date().getFullYear(), user: DEMO_USER, roles: ROLES});
    if (path === "/api/orders" && method === "GET") {
      return json(200, {orders: listOrders(db, url.searchParams.get("staff") || "", Number(url.searchParams.get("year")), url.searchParams.get("q"))});
    }
    if (path === "/api/orders" && method === "POST") {
      const fields = {};
      META.fields.forEach((f) => { fields[f.key] = (body.fields || {})[f.key] ?? ""; });
      derive(fields);
      const errors = validate(fields);
      if (errors.length) return json(422, {error: errors.join("\n"), code: "validation"});
      db.seq += 1;
      const order = {id: db.seq, staff: fields.staff, year: yearOf(fields), status: "new", approved: 0, approved_by: "", approved_at: "", fields, version: 1, created_at: now(), updated_at: now()};
      db.orders.push(order);
      db.audit.push({order_id: order.id, action: "create", actor: "お試し管理者", reason: "新規入力", created_at: now()});
      save(db);
      return json(201, {order});
    }
    if ((match = path.match(/^\/api\/orders\/(\d+)$/))) {
      const order = db.orders.find((o) => o.id === Number(match[1]));
      if (!order) return json(404, {error: "データが見つかりません。"});
      if (method === "GET") return json(200, {order});
      if (method === "PATCH") {
        const fields = {...order.fields, ...(body.fields || {})};
        derive(fields);
        const errors = validate(fields);
        if (errors.length) return json(422, {error: errors.join("\n"), code: "validation"});
        Object.assign(order, {fields, staff: fields.staff, year: yearOf(fields), version: order.version + 1, updated_at: now()});
        db.audit.push({order_id: order.id, action: "update", actor: "お試し管理者", reason: "内容を修正", created_at: now()});
        save(db);
        return json(200, {order});
      }
    }
    if ((match = path.match(/^\/api\/orders\/(\d+)\/status$/)) && method === "POST") {
      const order = db.orders.find((o) => o.id === Number(match[1]));
      if (!order) return json(404, {error: "データが見つかりません。"});
      order.status = body.status === "mailed" ? "mailed" : "new";
      order.version += 1;
      db.audit.push({order_id: order.id, action: "status", actor: "お試し管理者", reason: order.status === "mailed" ? "郵送済みにした" : "未郵送に戻した", created_at: now()});
      save(db);
      return json(200, {order});
    }
    if ((match = path.match(/^\/api\/orders\/(\d+)\/approve$/)) && method === "POST") {
      const order = db.orders.find((o) => o.id === Number(match[1]));
      if (!order) return json(404, {error: "データが見つかりません。"});
      const approved = body.approved !== false;
      if (approved) {
        const missing = [["contractor", "工事依頼先"], ["period_start", "工期 開始"], ["period_end", "工期 終了"]].filter(([k]) => !String(order.fields[k] || "").trim()).map(([, l]) => l);
        if (missing.length) return json(422, {error: "承認するには「" + missing.join("」「") + "」が必要です（カレンダーに載せるため）。", code: "validation"});
      }
      order.approved = approved ? 1 : 0;
      order.approved_by = approved ? "お試し管理者" : "";
      order.approved_at = approved ? now() : "";
      order.version += 1;
      db.audit.push({order_id: order.id, action: "approval", actor: "お試し管理者", reason: approved ? "承認した" : "承認を取り消した", created_at: now()});
      save(db);
      return json(200, {order});
    }
    if ((match = path.match(/^\/api\/orders\/(\d+)\/delete$/)) && method === "POST") {
      const id = Number(match[1]);
      db.orders = db.orders.filter((o) => o.id !== id);
      save(db);
      return json(200, {deleted: id});
    }
    if ((match = path.match(/^\/api\/orders\/(\d+)\/audit$/))) {
      const logs = db.audit.filter((a) => a.order_id === Number(match[1])).reverse();
      return json(200, {logs});
    }
    if (path === "/api/calendar") {
      const year = Number(url.searchParams.get("year")) || new Date().getFullYear();
      const month = Number(url.searchParams.get("month")) || new Date().getMonth() + 1;
      const contractor = url.searchParams.get("contractor") || "";
      const start = `${year}-${String(month).padStart(2, "0")}-01`;
      const end = `${year}-${String(month).padStart(2, "0")}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
      const items = db.orders.filter((o) => o.approved && o.fields.period_start && o.fields.period_end && o.fields.period_start <= end && o.fields.period_end >= start && (!contractor || o.fields.contractor === contractor))
        .sort((a, b) => a.fields.contractor.localeCompare(b.fields.contractor) || a.fields.period_start.localeCompare(b.fields.period_start))
        .map((o) => ({id: o.id, contractor: o.fields.contractor, customer_name: o.fields.customer_name, work_name: o.fields.work_name, site: o.fields.site, staff: o.fields.staff, period_start: o.fields.period_start, period_end: o.fields.period_end, payment_amount: o.fields.payment_amount, order_amount: o.fields.order_amount, sales_amount: o.fields.sales_amount, status: o.status}));
      const contractors = [...new Set(items.map((it) => it.contractor))];
      return json(200, {start, end, year, month, months: 1, contractors, items, user: DEMO_USER});
    }
    if (path === "/api/users" && method === "GET") {
      return json(200, {users: [{id: 1, username: "demo", display_name: "お試し管理者", role: "admin", contractor: "", active: 1}], contractors: META.masters.contractors.map((c) => c.name), roles: ROLES});
    }
    if (path === "/api/users" && method === "POST") return json(400, {error: "お試し版ではIDの発行はできません（本物のツールでは管理者が発行できます）。"});
    if (path === "/api/logs") return json(200, {logs: [{username: "demo", role: "admin", event: "success", ip: "お試し", user_agent: "", created_at: now()}]});
    if (path === "/api/change-password") return json(400, {error: "お試し版では変更できません。"});
    return json(404, {error: "お試し版では使えない機能です。"});
  }

  window.fetch = function (input, options = {}) {
    const raw = typeof input === "string" ? input : input.url;
    const url = new URL(raw, location.href);
    if (url.pathname.includes("/api/")) return handle(url, options);
    return realFetch(input, options);
  };

  window.demoExportCsv = function (staff, year) {
    const db = load();
    const rows = [["No", "承認", "状態", ...META.fields.map((f) => f.label)]];
    listOrders(db, staff, year, "").forEach((o) => {
      rows.push([o.id, o.approved ? "承認済み" : "未承認", o.status === "mailed" ? "郵送済み" : "未郵送", ...META.fields.map((f) => o.fields[f.key] ?? "")]);
    });
    const text = rows.map((r) => r.map((v) => /[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)).join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["﻿" + text], {type: "text/csv"}));
    link.download = `工事注文台帳_${staff || "全体"}_${year}年.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  document.addEventListener("DOMContentLoaded", () => {
    const bar = document.createElement("div");
    bar.textContent = "お試し版：管理者として入った状態です。入力した内容は、この端末のこのブラウザの中だけに保存されます";
    bar.style.cssText = "background:#fff3d6;color:#6b4a00;font:700 12px/1.6 Meiryo,sans-serif;padding:6px 14px;text-align:center;border-bottom:1px solid #ecd9a0";
    bar.className = "demo-bar";
    document.body.prepend(bar);
    const exit = document.getElementById("shutdown-button");
    if (exit) exit.style.display = "none";
    const logout = document.getElementById("logout-button");
    if (logout) logout.style.display = "none";
  });
})();
