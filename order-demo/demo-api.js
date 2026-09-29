// お試し版（URLを開くだけ版）: サーバーの代わりに、このブラウザの中だけにデータを保存する。
(function () {
  const META = window.__DEMO_META__;
  const KEY = "order_demo_v1";
  const realFetch = window.fetch.bind(window);

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {seq: 0, orders: [], audit: []}; }
    catch (e) { return {seq: 0, orders: [], audit: []}; }
  }
  function save(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {}
  }
  if (!window.__demoMemory) window.__demoMemory = null;

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

    if (path === "/api/meta") return json(200, {...META, current_year: new Date().getFullYear()});
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
      const order = {id: db.seq, staff: fields.staff, year: yearOf(fields), status: "new", fields, version: 1, created_at: now(), updated_at: now()};
      db.orders.push(order);
      db.audit.push({order_id: order.id, action: "create", actor: "利用者", reason: "新規入力", created_at: now()});
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
        db.audit.push({order_id: order.id, action: "update", actor: "利用者", reason: "内容を修正", created_at: now()});
        save(db);
        return json(200, {order});
      }
    }
    if ((match = path.match(/^\/api\/orders\/(\d+)\/status$/)) && method === "POST") {
      const order = db.orders.find((o) => o.id === Number(match[1]));
      if (!order) return json(404, {error: "データが見つかりません。"});
      order.status = body.status === "mailed" ? "mailed" : "new";
      order.version += 1;
      db.audit.push({order_id: order.id, action: "status", actor: "利用者", reason: order.status === "mailed" ? "郵送済みにした" : "未郵送に戻した", created_at: now()});
      save(db);
      return json(200, {order});
    }
    if ((match = path.match(/^\/api\/orders\/(\d+)\/audit$/))) {
      const logs = db.audit.filter((a) => a.order_id === Number(match[1])).reverse();
      return json(200, {logs});
    }
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
    const rows = [["No", "状態", ...META.fields.map((f) => f.label)]];
    listOrders(db, staff, year, "").forEach((o) => {
      rows.push([o.id, o.status === "mailed" ? "郵送済み" : "未郵送", ...META.fields.map((f) => o.fields[f.key] ?? "")]);
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
    bar.textContent = "お試し版：入力した内容は、この端末のこのブラウザの中だけに保存されます（他の人には見えません）";
    bar.style.cssText = "background:#fff3d6;color:#6b4a00;font:700 12px/1.6 Meiryo,sans-serif;padding:6px 14px;text-align:center;border-bottom:1px solid #ecd9a0";
    bar.className = "demo-bar";
    document.body.prepend(bar);
    const exit = document.getElementById("shutdown-button");
    if (exit) exit.style.display = "none";
  });
})();
