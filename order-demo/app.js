const state = {
  meta: null,
  staff: "",
  year: new Date().getFullYear(),
  orders: [],
  editing: null, // null=閉 / {id:null}=新規 / {id,version}=編集
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {"Content-Type": "application/json", ...(options.headers || {})},
  });
  if (response.status === 401) {
    location.href = "login.html?next=" + encodeURIComponent(location.pathname + location.search);
    throw new Error("ログインしてください。");
  }
  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  const body = isJson ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(body.error || `HTTP ${response.status}`);
    error.code = body.code;
    throw error;
  }
  return body;
}

function toast(message, kind = "success") {
  const item = document.createElement("div");
  item.className = `toast ${kind}`;
  item.textContent = message;
  $("#toast-stack").append(item);
  setTimeout(() => item.remove(), 4500);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  }[char]));
}

function formatMoney(value) {
  if (value === "" || value == null) return "—";
  const number = Number(String(value).replace(/[^0-9-]/g, ""));
  return Number.isFinite(number) ? `¥${number.toLocaleString("ja-JP")}` : value;
}

function canApprove() {
  return ["admin", "manager"].includes(state.user?.role);
}
function isAdmin() {
  return state.user?.role === "admin";
}

async function initialize() {
  state.meta = await api("api/meta");
  state.user = state.meta.user;
  $("#user-label").textContent = `${state.user.display_name}（${state.user.role_label}）`;
  $("#admin-link").hidden = !isAdmin();
  const companyName = (state.meta.company || {}).name || "";
  if (companyName) {
    $("#brand-title").textContent = `${companyName} 工事注文書`;
    document.title = `${companyName} 工事注文書`;
  }
  renderYearOptions();
  renderStaffOptions();
  renderTableHeader();
  bindEvents();
  await loadOrders();
  const openId = new URLSearchParams(location.search).get("open");
  if (openId) {
    history.replaceState(null, "", "index.html");
    await openEdit(Number(openId));
    return;
  }
  let seen = false;
  try { seen = localStorage.getItem("order_demo_notes_v3") === "seen"; } catch (e) {}
  // 吹き出しの案内はパソコンの広い画面向け。スマホでは画面からはみ出すので出さない
  const wideScreen = Math.min(window.screen.width || 9999, window.outerWidth || 9999) >= 900;
  if (!seen && wideScreen) showUpdateNotes();
}

function renderYearOptions() {
  const current = state.meta.current_year;
  $("#year-select").innerHTML = [current - 2, current - 1, current, current + 1]
    .map((year) => `<option value="${year}" ${year === state.year ? "selected" : ""}>${year}年</option>`)
    .join("");
}

function renderStaffOptions() {
  const options = state.meta.masters.staff
    .filter((person) => person.short)
    .map((person) => `<option value="${escapeHtml(person.short)}">${escapeHtml(person.short)}</option>`)
    .join("");
  $("#staff-select").innerHTML = `<option value="">担当：全体</option>` + options;
}

const LIST_COLUMNS = [
  {key: "input_date", label: "入力日"},
  {key: "staff", label: "担当"},
  {key: "contractor", label: "工事依頼先"},
  {key: "customer_name", label: "お客様名"},
  {key: "work_name", label: "工事名"},
  {key: "site", label: "工事場所"},
  {key: "kubun_cls", label: "工事区分"},
  {key: "work_type_cls", label: "種別"},
  {key: "order_amount", label: "受注金額", money: true},
  {key: "payment_amount", label: "支払金額", money: true},
  {key: "sales_amount", label: "売上金額", money: true},
  {key: "period", label: "工期"},
];

function renderTableHeader() {
  const labels = LIST_COLUMNS.map((col, index) => {
    const stickyClass = index === 0 ? "sticky sticky-1" : "";
    return `<th class="${stickyClass}">${escapeHtml(col.label)}</th>`;
  }).join("");
  $("#ledger-head").innerHTML = `<tr><th>承認</th><th>状態</th>${labels}<th>印刷</th><th>編集</th></tr>`;
}

async function loadOrders() {
  const query = encodeURIComponent($("#search-input")?.value || "");
  const response = await api(`api/orders?staff=${encodeURIComponent(state.staff)}&year=${state.year}&q=${query}`);
  state.orders = response.orders;
  $("#current-staff").textContent = state.staff ? `${state.staff}さん` : "全体";
  renderRows();
}

function renderRows() {
  const body = $("#ledger-body");
  body.innerHTML = state.orders.map((order) => {
    const f = order.fields;
    const cells = LIST_COLUMNS.map((col, index) => {
      const stickyClass = index === 0 ? "sticky sticky-1" : "";
      let content;
      if (col.key === "period") {
        content = f.period_start || f.period_end ? `${escapeHtml(f.period_start || "")}〜${escapeHtml(f.period_end || "")}` : "—";
      } else if (col.money) {
        content = formatMoney(f[col.key]);
      } else {
        content = escapeHtml(f[col.key] || "—");
      }
      return `<td class="${stickyClass} ${col.money ? "money" : ""}">${content}</td>`;
    }).join("");
    const statusChip = order.status === "mailed"
      ? `<span class="status-chip ready">郵送済み</span><button class="mini-link" data-status-id="${order.id}" data-next="new">戻す</button>`
      : `<span class="status-chip needs_review">未郵送</span><button class="mini-link strong" data-status-id="${order.id}" data-next="mailed">郵送済みにする</button>`;
    const approveCell = order.approved
      ? `<span class="approve-chip yes">承認済み</span>${canApprove() ? `<button class="mini-link" data-approve-id="${order.id}" data-next="0">取り消す</button>` : ""}`
      : `<span class="approve-chip no">未承認</span>${canApprove() ? `<button class="mini-link strong" data-approve-id="${order.id}" data-next="1">承認する</button>` : ""}`;
    return `<tr>
      <td class="status-cell">${approveCell}</td>
      <td class="status-cell">${statusChip}</td>
      ${cells}
      <td class="print-cell">
        <a class="print-link" href="print-koji.html?id=${order.id}" target="_blank">工事注文書</a>
        <a class="print-link" href="print-chumon.html?id=${order.id}" target="_blank">注文書</a>
      </td>
      <td><button class="edit-button" data-edit-id="${order.id}" aria-label="編集">✎</button></td>
    </tr>`;
  }).join("");
  body.querySelectorAll("[data-edit-id]").forEach((button) => button.addEventListener("click", () => openEdit(Number(button.dataset.editId))));
  body.querySelectorAll("[data-status-id]").forEach((button) => button.addEventListener("click", () => setStatus(Number(button.dataset.statusId), button.dataset.next)));
  body.querySelectorAll("[data-approve-id]").forEach((button) => button.addEventListener("click", () => setApproval(Number(button.dataset.approveId), button.dataset.next === "1")));
  const mailed = state.orders.filter((item) => item.status === "mailed").length;
  $("#count-unapproved").textContent = state.orders.filter((item) => !item.approved).length;
  $("#count-all").textContent = state.orders.length;
  $("#count-new").textContent = state.orders.length - mailed;
  $("#count-mailed").textContent = mailed;
  $("#record-count").textContent = `${state.orders.length}件・入力日順`;
  $("#empty-state").hidden = state.orders.length !== 0;
  $(".ledger-table").hidden = state.orders.length === 0;
  $("#csv-button").disabled = state.orders.length === 0;
}

function bindEvents() {
  $("#year-select").addEventListener("change", async (event) => {
    state.year = Number(event.target.value);
    await loadOrders();
  });
  $("#staff-select").addEventListener("change", async (event) => {
    state.staff = event.target.value;
    await loadOrders();
  });
  let searchTimer;
  $("#search-input").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadOrders, 250);
  });
  [$("#add-button"), $("#empty-add-button")].forEach((button) => button.addEventListener("click", openNew));
  $("#csv-button").addEventListener("click", () => {
    window.demoExportCsv(state.staff, state.year);
    toast("一覧のCSVを作成しました。");
  });
  $("#save-button").addEventListener("click", saveEntry);
  $("#delete-button").addEventListener("click", deleteEntry);
  $("#shutdown-button").addEventListener("click", shutdownTool);
  $("#logout-button").addEventListener("click", async () => {
    try { await api("api/logout", {method: "POST", body: "{}"}); } catch (e) {}
    location.href = "login.html";
  });
  $("#whats-new-button").addEventListener("click", showUpdateNotes);
  $$('[data-close]').forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.close).close()));
}

async function shutdownTool() {
  if (!window.confirm("工事注文書ツールを終了しますか？")) return;
  try {
    await api("api/shutdown", {method: "POST", body: "{}"});
    document.body.innerHTML = `<main style="min-width:0;display:grid;place-items:center;min-height:100vh;background:#f0f7f2;font-family:Meiryo,sans-serif"><div style="text-align:center"><h1 style="color:#075c34">ツールを終了しました</h1><p>このブラウザー画面を閉じてください。</p></div></main>`;
  } catch (error) {
    toast(error.message, "error");
  }
}

// ---- 入力フォーム ----

const FORM_SECTIONS = [
  {title: "基本情報", keys: ["input_date", "staff", "contractor", "customer_name", "billing_to", "kubun_company", "site", "work_name", "work_type", "industry"]},
  {title: "金額・工期（すべて消費税抜）", keys: ["order_amount", "period_start", "period_end", "payment_amount", "sales_amount"]},
  {title: "工事内容（1行30文字・注文書にこのまま印刷されます）", keys: ["content_1","content_2","content_3","content_4","content_5","content_6","content_7","content_8","content_9","content_10"], lines: true},
  {title: "他 連絡事項", keys: ["note_1","note_2","note_3","note_4","note_5","note_6"], lines: true},
];

function fieldSpec(key) {
  return state.meta.fields.find((field) => field.key === key);
}

function inputHtml(spec, value) {
  const masters = state.meta.masters;
  const options = (list, labelFn) => `<option value="">（選択してください）</option>` + list.map((item) => {
    const name = labelFn(item);
    return `<option value="${escapeHtml(name)}" ${name === value ? "selected" : ""}>${escapeHtml(name)}</option>`;
  }).join("");
  switch (spec.type) {
    case "staff":
      return `<select name="${spec.key}">${options(masters.staff.filter((s) => s.short), (s) => s.short)}</select>`;
    case "contractor":
      return `<select name="${spec.key}">${options(masters.contractors, (c) => c.name)}</select>`;
    case "kubun":
      return `<select name="${spec.key}">${options(masters.kubun, (k) => k.name)}</select>`;
    case "work_type":
      return `<select name="${spec.key}">${options(masters.work_types, (w) => w.name)}</select>`;
    case "industry":
      return `<select name="${spec.key}">${options(masters.industries, (i) => i.name)}</select>`;
    case "date":
      return `<input type="date" name="${spec.key}" value="${escapeHtml(value)}">`;
    case "money":
      return `<input type="number" name="${spec.key}" min="0" step="1" value="${escapeHtml(value)}" placeholder="0">`;
    case "line":
      return `<input type="text" name="${spec.key}" maxlength="${spec.maxlen}" value="${escapeHtml(value)}">`;
    default:
      return `<input type="text" name="${spec.key}" value="${escapeHtml(value)}">`;
  }
}

const DERIVED_HINTS = {
  contractor: {key: "contractor_code", label: "仕入先コード"},
  kubun_company: {key: "kubun_cls", label: "工事区分"},
  work_type: {key: "work_type_cls", label: "種別"},
  industry: {key: "industry_cls", label: "業種種別"},
};

function renderForm(fields) {
  $("#entry-form").innerHTML = FORM_SECTIONS.map((section) => {
    const rows = section.keys.map((key) => {
      const spec = fieldSpec(key);
      const value = fields[key] ?? "";
      const hint = DERIVED_HINTS[key];
      const hintHtml = hint ? `<span class="derived-hint" data-derived="${hint.key}">${escapeHtml(hint.label)}: <strong>—</strong></span>` : "";
      const shortLabel = section.lines ? spec.label.replace(/^(工事内容|連絡事項)\s*/, "") : spec.label;
      return `<label class="field ${section.lines ? "line-field" : ""}">
        <span class="field-label"><span>${escapeHtml(shortLabel)} ${spec.required ? '<em class="required">必須</em>' : ""}</span>${hintHtml}</span>
        ${inputHtml(spec, value)}
      </label>`;
    }).join("");
    return `<fieldset class="form-section"><legend>${escapeHtml(section.title)}</legend><div class="field-grid">${rows}</div></fieldset>`;
  }).join("");
  ["contractor", "kubun_company", "work_type", "industry"].forEach((key) => {
    const select = $(`#entry-form [name="${key}"]`);
    if (select) {
      select.addEventListener("change", updateDerivedHints);
    }
  });
  updateDerivedHints();
}

function updateDerivedHints() {
  const masters = state.meta.masters;
  const value = (key) => $(`#entry-form [name="${key}"]`)?.value || "";
  const setHint = (derivedKey, text) => {
    const hint = $(`#entry-form [data-derived="${derivedKey}"] strong`);
    if (hint) hint.textContent = text || "—";
  };
  setHint("contractor_code", (masters.contractors.find((c) => c.name === value("contractor")) || {}).code);
  setHint("kubun_cls", (masters.kubun.find((k) => k.name === value("kubun_company")) || {}).cls);
  setHint("work_type_cls", (masters.work_types.find((w) => w.name === value("work_type")) || {}).cls);
  setHint("industry_cls", (masters.industries.find((i) => i.name === value("industry")) || {}).cls);
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function openNew() {
  state.editing = {id: null};
  $("#entry-title").textContent = "新規入力";
  $("#entry-note").textContent = "保存すると一覧に載り、印刷できるようになります";
  $("#entry-error").hidden = true;
  $("#audit-wrap").hidden = true;
  $("#delete-button").hidden = true;
  setLocked(false);
  renderForm({input_date: todayIso(), staff: state.staff});
  $("#entry-dialog").showModal();
}

async function openEdit(orderId) {
  try {
    const response = await api(`api/orders/${orderId}`);
    state.editing = {id: orderId, version: response.order.version};
    $("#entry-title").textContent = `内容の確認・修正（No.${orderId}）`;
    $("#entry-note").textContent = "修正して保存すると、印刷にもすぐ反映されます";
    $("#entry-error").hidden = true;
    const locked = Boolean(response.order.approved) && !isAdmin();
    $("#delete-button").hidden = locked;
    renderForm(response.order.fields);
    setLocked(locked);
    if (response.order.approved) {
      $("#entry-title").textContent = `内容の確認（No.${orderId}・承認済み）`;
      $("#entry-note").textContent = isAdmin() ? "承認済みですが、管理者なので修正できます" : "承認済みのため、閲覧のみです";
    }
    const audit = await api(`api/orders/${orderId}/audit`);
    $("#audit-wrap").hidden = false;
    $("#audit-list").innerHTML = audit.logs.length
      ? audit.logs.map((log) => `<div class="audit-row"><span>${escapeHtml(new Date(log.created_at).toLocaleString("ja-JP"))}</span><strong>${escapeHtml(log.reason || log.action)}</strong><span>${escapeHtml(log.actor)}</span></div>`).join("")
      : "履歴はありません。";
    $("#entry-dialog").showModal();
  } catch (error) { toast(error.message, "error"); }
}

function collectFields() {
  const data = new FormData($("#entry-form"));
  const fields = {};
  state.meta.fields.forEach((field) => {
    if (field.derived) return;
    fields[field.key] = data.get(field.key) ?? "";
  });
  return fields;
}

async function saveEntry() {
  if (!state.editing) return;
  const button = $("#save-button");
  button.disabled = true;
  try {
    if (state.editing.id == null) {
      await api("api/orders", {method: "POST", body: JSON.stringify({fields: collectFields(), actor: "利用者"})});
      toast("登録しました。一覧から印刷できます。");
    } else {
      await api(`api/orders/${state.editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({fields: collectFields(), version: state.editing.version, actor: "利用者"}),
      });
      toast("修正内容を保存しました。");
    }
    $("#entry-dialog").close();
    state.editing = null;
    await loadOrders();
  } catch (error) {
    const box = $("#entry-error");
    box.textContent = error.message;
    box.hidden = false;
    box.scrollIntoView({block: "nearest"});
  } finally {
    button.disabled = false;
  }
}

async function deleteEntry() {
  if (!state.editing || state.editing.id == null) return;
  const name = $('#entry-form [name="customer_name"]')?.value || "";
  if (!window.confirm(`No.${state.editing.id}「${name}」を削除します。元に戻せません。よろしいですか？`)) return;
  try {
    await api(`api/orders/${state.editing.id}/delete`, {method: "POST", body: JSON.stringify({actor: "利用者"})});
    $("#entry-dialog").close();
    state.editing = null;
    toast("削除しました。");
    await loadOrders();
  } catch (error) { toast(error.message, "error"); }
}

function setLocked(locked) {
  $("#entry-locked").hidden = !locked;
  $("#entry-form").classList.toggle("readonly", locked);
  $("#save-button").hidden = locked;
}

async function setApproval(orderId, approved) {
  const message = approved
    ? `No.${orderId} を承認しますか？\n承認すると工事カレンダーに載り、工事会社からも予定が見えるようになります。`
    : `No.${orderId} の承認を取り消しますか？\nカレンダーから外れ、修正できる状態に戻ります。`;
  if (!window.confirm(message)) return;
  try {
    await api(`api/orders/${orderId}/approve`, {method: "POST", body: JSON.stringify({approved})});
    toast(approved ? "承認しました。カレンダーに載りました。" : "承認を取り消しました。");
    await loadOrders();
  } catch (error) { toast(error.message, "error"); }
}

async function setStatus(orderId, next) {
  try {
    await api(`api/orders/${orderId}/status`, {method: "POST", body: JSON.stringify({status: next, actor: "利用者"})});
    toast(next === "mailed" ? "郵送済みにしました。" : "未郵送に戻しました。");
    await loadOrders();
  } catch (error) { toast(error.message, "error"); }
}

// ---- 今回の更新（吹き出し） ----

const UPDATE_NOTES = [
  {selector: "#table-wrap", text: "一覧に「承認」の列が付きました。管理職か管理者が「承認する」を押すと、工事カレンダーに予定が載ります。承認済みの案件は管理者以外は修正できません。"},
  {selector: "#calendar-link", text: "「カレンダー」で、どの工事会社がいつ工事に入るかが月ごとに一目で分かります。工事会社のIDでログインすると、その会社の予定と委託金額だけが見えます。"},
  {selector: "#user-label", text: "ログインが必要になりました。役割（管理者・管理職・営業事務・工事会社）で見える物と押せるボタンが変わります。ログインの記録は設定画面に残ります。"},
  {selector: ".summary-cards", text: "「未承認」の件数が増えました。管理職は、ここが0になるように承認してください。"},
  {selector: "#admin-link", text: "「設定」で、会社情報（注文書の差出人欄）と、工事依頼先・担当者・工事区分のリストを登録します。ツールには見本の名前しか入っていないので、最初に管理者が入力してください。"},
];

function showUpdateNotes() {
  document.querySelector(".update-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "update-overlay";
  overlay.innerHTML = `<div class="update-intro">
      <strong>💬 今回の更新（承認・カレンダー・ログイン）</strong>
      <p>工事注文書の承認、工事会社ごとのカレンダー、IDでのログインが加わりました。右上の「💬 今回の更新」でいつでも見返せます。</p>
      <button class="button primary" id="update-close" type="button">わかりました（閉じる）</button>
    </div>`;
  const items = UPDATE_NOTES.map((note, index) => {
    const target = document.querySelector(note.selector);
    if (!target || target.hidden) return null;
    const bubble = document.createElement("div");
    bubble.className = "update-bubble";
    bubble.innerHTML = `<span class="update-num">${index + 1}</span><p>${escapeHtml(note.text)}</p>`;
    const ring = document.createElement("div");
    ring.className = "update-ring";
    overlay.append(bubble, ring);
    return {target, bubble, ring};
  }).filter(Boolean);
  document.body.append(overlay);

  const positionAll = () => {
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if (!vw || !vh) return;
    items.forEach(({target, bubble, ring}) => {
      const rect = target.getBoundingClientRect();
      const width = 264;
      const anchorX = rect.left + rect.width / 2;
      const left = Math.min(Math.max(anchorX - width / 2, 10), vw - width - 10);
      const below = rect.bottom + 14 <= vh - 150;
      bubble.classList.remove("tail-top", "tail-bottom");
      bubble.classList.add(below ? "tail-top" : "tail-bottom");
      bubble.style.left = `${left}px`;
      if (below) {
        bubble.style.top = `${rect.bottom + 14}px`;
        bubble.style.bottom = "auto";
      } else {
        bubble.style.top = "auto";
        bubble.style.bottom = `${Math.min(vh - rect.top + 14, vh - 24)}px`;
      }
      bubble.style.setProperty("--tail-x", `${Math.min(Math.max(anchorX - left, 20), width - 20)}px`);
      ring.style.left = `${rect.left - 5}px`;
      ring.style.top = `${rect.top - 5}px`;
      ring.style.width = `${rect.width + 10}px`;
      ring.style.height = `${rect.height + 10}px`;
    });
  };
  positionAll();
  setTimeout(positionAll, 350);
  const onResize = () => positionAll();
  window.addEventListener("resize", onResize);

  const close = () => {
    window.removeEventListener("resize", onResize);
    overlay.remove();
    try { localStorage.setItem("order_demo_notes_v3", "seen"); } catch (e) {}
  };
  overlay.querySelector("#update-close").addEventListener("click", close);
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
}

initialize().catch((error) => {
  console.error(error);
  toast(`起動に失敗しました: ${error.message}`, "error");
});
