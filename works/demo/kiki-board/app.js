
(() => {
  "use strict";
  const TZ = "Asia/Tokyo";
  const DOW = ["日", "月", "火", "水", "木", "金", "土"];
  const PLATS = [["x", "X"], ["ig", "インスタ"], ["yt", "YouTube"], ["ig_story", "インスタ ストーリーズ"]];
  const S = { mode: "loading", loaded: false, err: "", docs: [], notes: [], db: null, dl: null, mcp: null, mcpChecked: false, fromCache: false, drive: null };
  const ui = new Map();
  const timers = new Map();
  const busy = new Set();
  const vidEls = new Map();
  const blobs = new Map();
  const openRows = new Set(readOpen());
  const retries = { videos: 0, notes: 0 };
  let lastSig = "";

  const view = document.getElementById("view");
  const eyebrow = document.getElementById("eyebrow");

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function readOpen() {
    try { return JSON.parse(localStorage.getItem("portfolio.kiki-board.open.v1") || "[]"); } catch (_) { return []; }
  }
  function saveOpen() {
    try { localStorage.setItem("portfolio.kiki-board.open.v1", JSON.stringify([...openRows])); } catch (_) {}
  }
  function blobUrl(id) { return id === "sample-story" ? "sample-story.svg" : "sample-poster.svg"; }

  const fYmd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const fHm = new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const ymd = (d) => fYmd.format(d);
  const hm = (iso) => fHm.format(new Date(iso));
  const md = (s) => { const p = s.split("-"); return Number(p[1]) + "/" + Number(p[2]); };
  const dow = (s) => { const p = s.split("-").map(Number); return DOW[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()]; };
  const eff = (d) => d.tt_plan || d.date;
  const moved = (d) => !!d.tt_plan && d.tt_plan !== d.date;
  const addDay = (s, n) => { const p = s.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); };

  // 各媒体の状態。予約の時刻を過ぎたものは公開として出す
  function plat(d, k, now) {
    const st = d[k + "_state"] || "none";
    const at = d[k + "_at"];
    const url = d[k + "_url"] || "";
    if (st === "done") return { kind: "ok", text: "公開済み", url };
    if (st === "scheduled" && at) {
      const t = Date.parse(at);
      const day = ymd(new Date(t));
      const when = (day === d.date ? "" : md(day) + " ") + hm(at);
      if (now >= t) return { kind: "ok", text: when + " 公開", url };
      return { kind: "wait", text: when + " 予約", url: "" };
    }
    if (st === "skip") return { kind: "no", text: "出さない", url: "" };
    return { kind: "no", text: "まだ", url: "" };
  }
  function platGroups(d, now) {
    const groups = new Map();
    for (const [k, name] of PLATS) {
      const p = plat(d, k, now);
      const key = p.kind + "|" + p.text;
      if (!groups.has(key)) groups.set(key, { p, names: [] });
      groups.get(key).names.push(name);
    }
    return [...groups.values()];
  }
  function platLine(d, now) {
    const parts = platGroups(d, now).map((g) => g.names.join("・") + " " + g.p.text);
    if (d.tt_skip) parts.push("TikTok 出さない（YouTube だけの本編）");
    else { parts.push("TikTok " + (d.tt_done ? "出した" : "まだ")); parts.push("TikTok ストーリーズ " + (d.tt_story_done ? "出した" : "まだ")); }
    const line = el("div", "sumstate");
    parts.forEach((t, i) => {
      if (i) line.append(" ／ ");
      line.append(el("span", "nw", t));
    });
    return line;
  }
  function platSentence(d, now) {
    return platGroups(d, now).map((g) => {
      const who = g.names.join("・");
      if (g.p.kind === "wait") return who + " は " + g.p.text.replace(" 予約", "") + " の架空の予定を表示しています（自動投稿なし）。";
      if (g.p.kind === "ok") return who + " は公開済みです。";
      if (g.p.text === "出さない") return who + " には出しません。";
      return who + " は未完了のサンプル状態です。";
    }).join("");
  }
  function movedNote(d) {
    return "TikTok は " + md(d.tt_plan) + " に出す分（ほかは " + md(d.date) + " に公開）";
  }
  function metaLine(d) {
    const part = [d.moment, d.part].filter(Boolean).join(" ");
    return [part, d.sec ? d.sec + "秒" : ""].filter(Boolean).join("・");
  }

  function split(docs, today) {
    const g = { today: [], past: [], next: [], done: [] };
    for (const d of docs) {
      if (!d.date) continue;
      if (eff(d) === today && !(d.tt_done && moved(d))) g.today.push(d);
      else if (d.tt_done || d.tt_skip) g.done.push(d);
      else if (eff(d) < today) g.past.push(d);
      else g.next.push(d);
    }
    const asc = (a, b) => (eff(a) < eff(b) ? -1 : eff(a) > eff(b) ? 1 : (a.ver || 0) - (b.ver || 0));
    g.today.sort(asc);
    g.next.sort(asc);
    g.past.sort((a, b) => asc(b, a));
    g.done.sort((a, b) => asc(b, a));
    return g;
  }

  // ---------- 描画 ----------
  function signature(now) {
    const today = ymd(new Date(now));
    const derived = S.docs.map((d) => PLATS.map(([k]) => plat(d, k, now).text).join(",")).join(";");
    return [S.mode, S.loaded, S.err, today, derived, JSON.stringify(S.docs), JSON.stringify(S.notes), [...busy].join(","), S.mcpChecked, !!S.mcp, JSON.stringify(S.drive)].join("#");
  }
  function render(force) {
    const now = Date.now();
    const sig = signature(now);
    if (!force && sig === lastSig) return;
    lastSig = sig;
    draw(now);
  }

  function draw(now) {
    const today = ymd(new Date(now));
    if (S.mode !== "live" || S.err || !S.loaded) {
      view.replaceChildren(statusBox());
      return;
    }
    const docs = S.docs;
    const latest = docs.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    eyebrow.textContent = "kikitoa" + (latest && latest.song ? " ／ " + latest.song : "");
    if (!docs.length) {
      view.replaceChildren(el("p", "statusline", "架空の予定がありません。上のリセットでサンプルに戻せます。"));
      return;
    }
    const g = split(docs, today);
    const frag = document.createDocumentFragment();
    frag.append(tonightBox(g, today, now));

    if (g.today.length) {
      const sec = section("今日の動画");
      g.today.forEach((d) => sec.append(panel(d, now)));
      frag.append(sec);
    }

    const notes = S.notes.filter((n) => !n.done && n.text);
    if (notes.length) frag.append(notesBox(notes));
    if (g.past.length) {
      const sec = section("前の日で、TikTok がまだの分");
      g.past.forEach((d) => sec.append(row(d, now)));
      frag.append(sec);
    }
    if (g.next.length) {
      const sec = section("これからの分");
      g.next.forEach((d) => sec.append(row(d, now)));
      frag.append(sec);
    }
    if (g.done.length) {
      const sec = section("TikTok まで出し終わった分");
      const box = el("details", "donebox");
      if (openRows.has("__done")) box.open = true;
      box.addEventListener("toggle", () => { if (box.open) openRows.add("__done"); else openRows.delete("__done"); saveOpen(); });
      box.append(el("summary", null, g.done.length + " 本を見る"));
      const list = el("div", "donelist");
      g.done.forEach((d) => list.append(row(d, now)));
      box.append(list);
      sec.append(box);
      frag.append(sec);
    }
    frag.append(driveBox());
    frag.append(foot(docs, today));
    view.replaceChildren(frag);
    for (const k of ui.keys()) paint(k);
  }

  function statusBox() {
    let t = "読み込み中…";
    if (S.mode === "nohost") t = "このページは claude.ai で開いてください。";
    else if (S.mode === "nodb") t = "データを読み込めませんでした。claude.ai にサインインしてから、開き直してください。";
    else if (S.err === "revoked") t = "このページを見る権限が変わりました。";
    else if (S.err) t = "読み込みが止まりました。ページを開き直してください。";
    return el("p", "statusline", t);
  }

  function section(title) {
    const s = el("section", "sec");
    s.append(el("h2", null, title));
    return s;
  }

  function tonightBox(g, today, now) {
    const box = el("section", "tonight");
    box.setAttribute("aria-label", "今夜やること");
    box.append(el("div", "lead", "今夜やること"));
    const todo = g.today.filter((d) => !d.tt_done && !d.tt_skip);
    const main = el("p", "main");
    if (!g.today.length) main.textContent = "今日（" + md(today) + "）の動画は、まだできていません。";
    else if (todo.length === 1) main.append(el("span", null, "「" + todo[0].title + "」"), "の TikTok（本編＋ストーリーズ）の完了記録を試す");
    else if (todo.length > 1) main.textContent = "TikTok の架空の完了記録を " + todo.length + " 件試す";
    else main.textContent = "今夜の架空の完了記録が揃いました。";
    box.append(main);
    if (!g.today.length) box.append(el("p", "sub", "上のリセットで架空の予定に戻せます。"));
    else if (moved(g.today[0])) box.append(el("p", "sub", "TikTok だけの日です。X・インスタ・YouTube は " + md(g.today[0].date) + " に公開済みです。"));
    else box.append(el("p", "sub", platSentence(g.today[0], now)));
    if (g.past.length) {
      const days = g.past.map((d) => md(eff(d))).join("・");
      box.append(el("p", "sub", days + " の分も、TikTok がまだです。もう出していたら、下で「TikTok に出した」を押してください。"));
    }
    return box;
  }

  function notesBox(notes) {
    const sec = section("ほかに、あなたの番");
    for (const n of notes) {
      const item = el("div", "todo");
      item.append(el("p", null, n.text));
      const b = el("button", "btn ghost", busy.has("note:" + n.id) ? "記録中…" : "済んだ");
      b.type = "button";
      b.disabled = busy.has("note:" + n.id) || !S.db;
      b.addEventListener("click", () => doneNote(n));
      item.append(b);
      const m = el("div", "msg");
      m.dataset.msg = "note:" + n.id;
      m.setAttribute("role", "status");
      item.append(m);
      sec.append(item);
    }
    return sec;
  }

  function panel(d, now) {
    const box = el("article", "koma");
    const head = el("div", "head");
    head.append(el("span", "date", md(eff(d))), el("span", "dow", "（" + dow(eff(d)) + "）"), el("span", "tag", moved(d) ? "今日・TikTok だけ" : "今日"));
    box.append(head);
    box.append(el("h3", "title", "「" + (d.title || "") + "」"));
    const meta = metaLine(d);
    if (meta) box.append(el("div", "meta", meta));
    if (moved(d)) box.append(el("div", "meta", movedNote(d)));
    box.append(chips(d, now), bodyGrid(d));
    if (!d.tt_skip) box.append(captionBlock(d));
    if (d.story_id) box.append(storyBlock(d));
    return box;
  }

  function row(d, now) {
    const det = el("details", "row");
    if (openRows.has(d.id)) det.open = true;
    const sum = el("summary");
    const s = el("div", "sum");
    const top = el("div", "sumtop");
    top.append(el("span", "sumdate", md(eff(d))), el("span", "dow", "（" + dow(eff(d)) + "）"), el("span", "sumtitle", "「" + (d.title || "") + "」"));
    s.append(top, platLine(d, now));
    if (moved(d)) s.append(el("div", "sumstate", movedNote(d)));
    s.append(el("span", "tog"));
    sum.append(s);
    det.append(sum);
    const inner = el("div", "inner");
    const meta = metaLine(d);
    if (meta) inner.append(el("div", "meta", meta));
    inner.append(chips(d, now), bodyGrid(d));
    if (!d.tt_skip) inner.append(captionBlock(d));
    if (d.story_id) inner.append(storyBlock(d));
    det.append(inner);
    det.addEventListener("toggle", () => {
      if (det.open) openRows.add(d.id); else openRows.delete(d.id);
      saveOpen();
    });
    return det;
  }

  function chips(d, now) {
    const wrap = el("div", "chips");
    for (const [k, name] of PLATS) wrap.append(chip(name, plat(d, k, now)));
    if (d.tt_skip) { wrap.append(chip("TikTok", { kind: "no", text: "出さない" })); wrap.append(chip("TikTok ストーリーズ", { kind: "no", text: "出さない" })); }
    else { wrap.append(chip("TikTok", d.tt_done ? { kind: "ok", text: "出した" } : { kind: "no", text: "まだ" })); wrap.append(chip("TikTok ストーリーズ", d.tt_story_done ? { kind: "ok", text: "出した" } : { kind: "no", text: "まだ" })); }
    return wrap;
  }
  function chip(name, p) {
    const link = p.kind === "ok" && p.url;
    const c = el(link ? "a" : "span", "chip " + p.kind);
    if (link) { c.href = p.url; c.target = "_blank"; c.rel = "noopener"; }
    c.append(el("b", null, name), el("span", null, (p.kind === "ok" ? "✓ " : "") + p.text + (link ? " ↗" : "")));
    return c;
  }

  function bodyGrid(d) {
    const g = el("div", "body");
    g.append(videoEl(d), steps(d));
    return g;
  }
  function videoEl(d) { const image = el("img", "vid"); image.src = blobUrl(d.poster_id); image.alt = "架空の表示用ポスター。動画ではありません。"; image.loading = "lazy"; return image; }

  function steps(d) {
    const ol = el("ol", "steps");

    const li1 = el("li");
    const c1 = el("div", "cell");
    if (S.dl && d.video_id) {
      const b = el("button", "btn", "動画は体験版に含みません");
      b.type = "button";
      b.dataset.btn = d.id + ":save";
      b.dataset.label = "動画は体験版に含みません";
      b.addEventListener("click", () => onSave(d));
      c1.append(b);
    } else {
      c1.append(el("div", "note", "動画は体験版に含みません（架空ポスターのみ）。"));
    }
    const m1 = el("div", "msg");
    m1.dataset.msg = d.id + ":save";
    m1.setAttribute("role", "status");
    c1.append(m1);
    li1.append(el("span", "num", "1"), c1);

    const li2 = el("li");
    const c2 = el("div", "cell");
    const b2 = el("button", "btn", "説明文をコピー");
    b2.type = "button";
    b2.dataset.btn = d.id + ":copy";
    b2.dataset.label = "説明文をコピー";
    b2.disabled = !d.tiktok_text;
    b2.addEventListener("click", () => onCopy(d));
    const m2 = el("div", "msg");
    m2.dataset.msg = d.id + ":copy";
    m2.setAttribute("role", "status");
    c2.append(b2, m2);
    li2.append(el("span", "num", "2"), c2);

    const li3 = el("li");
    li3.append(el("span", "num", "3"), el("div", "say", "体験版では投稿せず、下の完了記録を試す"));

    const li4 = el("li");
    const c4 = el("div", "cell");
    const isBusy = busy.has(d.id);
    if (d.tt_done) {
      const when = d.tt_at ? "（" + md(ymd(new Date(d.tt_at))) + " " + hm(d.tt_at) + "）" : "";
      c4.append(el("div", "done", "✓ TikTok に出した" + when));
      const u = el("button", "link", isBusy ? "記録中…" : "取り消す");
      u.type = "button";
      u.disabled = isBusy || !S.db;
      u.addEventListener("click", () => setTT(d, false));
      c4.append(u);
    } else {
      const b = el("button", "btn accent", isBusy ? "記録中…" : "TikTok に出した");
      b.type = "button";
      b.disabled = isBusy || !S.db;
      b.addEventListener("click", () => setTT(d, true));
      c4.append(b);
    }
    const m4 = el("div", "msg");
    m4.dataset.msg = d.id + ":tt";
    m4.setAttribute("role", "status");
    c4.append(m4);
    li4.append(el("span", "num", "4"), c4);

    const li5 = el("li");
    const c5 = el("div", "cell");
    c5.append(el("div", "say", d.story_id ? "下の架空ポスターを見て、ストーリーの完了記録を試す（送信なし）" : "体験版は架空のポスターだけを表示します"));
    const sBusy = busy.has(d.id + ":st");
    if (d.tt_story_done) {
      c5.append(el("div", "done", "✓ ストーリーズに出した"));
      const u = el("button", "link", sBusy ? "記録中…" : "取り消す");
      u.type = "button";
      u.disabled = sBusy || !S.db;
      u.addEventListener("click", () => setStory(d, false));
      c5.append(u);
    } else {
      const b = el("button", "btn accent", sBusy ? "記録中…" : "TikTok ストーリーズに出した");
      b.type = "button";
      b.disabled = sBusy || !S.db;
      b.addEventListener("click", () => setStory(d, true));
      c5.append(b);
    }
    const m5 = el("div", "msg");
    m5.dataset.msg = d.id + ":st";
    m5.setAttribute("role", "status");
    c5.append(m5);
    li5.append(el("span", "num", "5"), c5);

    if (d.tt_skip) {
      const liS = el("li");
      liS.append(el("span", "num", "2"), el("div", "say", "この本編は YouTube だけ。TikTok・インスタ・X には出しません（今日の TikTok は上の予告ショートの行を）。"));
      ol.append(li1, liS);
      return ol;
    }
    ol.append(li1, li2, li3, li4, li5);
    return ol;
  }

  // 2026-10-18 本人「ストーリーズとリールが同じじゃつまらない」→ ストーリーズは「今日の一枚＋ひとこと」。TikTok は本人がスマホから
  function storyBlock(d) {
    const sec = el("div", "story");
    sec.append(el("div", "storyhead", "ストーリーズ用の1枚（架空ポスター・投稿なし）"));
    const g = el("div", "body");
    const img = el("img", "storyimg");
    img.src = blobUrl(d.story_id);
    img.alt = "ストーリーズ用の画像「" + (d.title || "") + "」";
    img.loading = "lazy";
    const ol = el("ol", "steps");
    const li1 = el("li");
    const c1 = el("div", "cell");
    if (S.dl) {
      const b = el("button", "btn", "架空ポスターを保存");
      b.type = "button";
      b.dataset.btn = d.id + ":storysave";
      b.dataset.label = "架空ポスターを保存";
      b.addEventListener("click", () => onSaveStory(d));
      c1.append(b);
    } else {
      c1.append(el("div", "note", "画像を長押しして保存してください。"));
    }
    const m1 = el("div", "msg");
    m1.dataset.msg = d.id + ":storysave";
    m1.setAttribute("role", "status");
    c1.append(m1);
    li1.append(el("span", "num", "1"), c1);
    const li2 = el("li");
    const how = el("div", "how");
    const l1 = el("div"); l1.append(el("b", null, "TikTok"), "　体験版では投稿せず、上のストーリー完了記録を試します");
    const l2 = el("div"); l2.append(el("b", null, "インスタ"), "　元アプリの予定を示す欄です。体験版は投稿しません");
    how.append(l1, l2);
    li2.append(el("span", "num", "2"), how);
    ol.append(li1, li2);
    g.append(img, ol);
    sec.append(g);
    return sec;
  }
  async function onSaveStory(d) { window.KikiSample.downloadPoster(); setUi(d.id + ":storysave", "ok", "架空の表示用ポスターを保存しました", 8000); }

  function captionBlock(d) {
    const w = el("div", "capwrap");
    w.append(el("div", "caplabel", "TikTok の説明文"));
    const c = el("div", "cap", d.tiktok_text || "（まだ書いていません）");
    c.dataset.cap = d.id;
    w.append(c);
    if (d.cover_hint) w.append(el("div", "note", "表紙のおすすめ：" + d.cover_hint));
    return w;
  }

  function foot(docs, today) {
    const f = el("footer", "foot");
    const last = docs.map((d) => eff(d)).filter(Boolean).sort().pop();
    if (last && last >= today) {
      f.append(el("p", null, "架空の予定があるのは " + md(last) + "（" + dow(last) + "）の分まで。" + md(addDay(last, 1)) + " 以降はサンプルを置いていません。"));
    }
    f.append(el("p", null, "元アプリでは X・インスタ・YouTube・ストーリーズの予定と状態を管理します。体験版は架空の予定・状態の表示だけで、自動予約・投稿はしません。TikTok の2つの欄は、ボタン操作でこのブラウザ内の完了記録だけを変えます。"));
    return f;
  }

  // ---------- 一時的な表示（押した直後の文言） ----------
  function setUi(key, kind, text, ms) {
    clearTimeout(timers.get(key));
    ui.set(key, { kind, text });
    if (ms) timers.set(key, setTimeout(() => { ui.delete(key); paint(key); }, ms));
    paint(key);
  }
  function paint(key) {
    const st = ui.get(key);
    const inButton = st && (st.kind === "busy" || st.kind === "ok");
    view.querySelectorAll('[data-msg="' + key + '"]').forEach((m) => {
      m.textContent = st && !inButton ? st.text : "";
      m.className = "msg" + (st && !inButton ? " " + st.kind : "");
    });
    view.querySelectorAll('[data-btn="' + key + '"]').forEach((b) => {
      b.textContent = inButton ? st.text : b.dataset.label;
      b.disabled = !!(st && st.kind === "busy");
    });
  }

  // ---------- 操作 ----------
  async function onSave(d) { setUi(d.id + ":save", "warn", "体験版には動画を含みません。架空ポスターで画面を確認できます。", 8000); }

  function onCopy(d) {
    const key = d.id + ":copy";
    const text = d.tiktok_text || "";
    const fallback = () => {
      const cap = view.querySelector('[data-cap="' + d.id + '"]');
      try {
        const sel = window.getSelection();
        const r = document.createRange();
        r.selectNodeContents(cap);
        sel.removeAllRanges();
        sel.addRange(r);
        const ok = document.execCommand && document.execCommand("copy");
        if (ok) setUi(key, "ok", "✓ コピーしました", 6000);
        else setUi(key, "warn", "説明文を選びました。長押しして「コピー」を押してください。", 12000);
      } catch (_) {
        setUi(key, "warn", "説明文を長押しして、コピーしてください。", 12000);
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => setUi(key, "ok", "✓ コピーしました", 6000), fallback);
    } else {
      fallback();
    }
  }

  async function setTT(d, val) {
    if (!S.db || busy.has(d.id)) return;
    busy.add(d.id);
    render(true);
    try {
      const ts = new Date().toISOString();
      await S.db.doc("videos/" + d.id).update(val ? { tt_done: true, tt_at: ts, updated_at: ts } : { tt_done: false, tt_at: null, updated_at: ts });
      pushStatus({ id: d.id, patch: val ? { tt_done: true, tt_at: ts, updated_at: ts } : { tt_done: false, tt_at: null, updated_at: ts } });
    } catch (e) {
      setUi(d.id + ":tt", "err", e && e.code === "invalid_argument" ? "ここからは記録できません。" : "記録できませんでした。もう一度押してください。", 10000);
    } finally {
      busy.delete(d.id);
      render(true);
    }
  }

  async function setStory(d, val) {
    const key = d.id + ":st";
    if (!S.db || busy.has(key)) return;
    busy.add(key);
    render(true);
    try {
      const ts = new Date().toISOString();
      await S.db.doc("videos/" + d.id).update(val ? { tt_story_done: true, tt_story_at: ts, updated_at: ts } : { tt_story_done: false, tt_story_at: null, updated_at: ts });
      pushStatus({ id: d.id, patch: val ? { tt_story_done: true, tt_story_at: ts, updated_at: ts } : { tt_story_done: false, tt_story_at: null, updated_at: ts } });
    } catch (e) {
      setUi(key, "err", "記録できませんでした。もう一度押してください。", 10000);
    } finally {
      busy.delete(key);
      render(true);
    }
  }

  // ---------- ドライブへの記録（2026-10-18 本人「AIニュースと同じ方式で、ボタンを押した時に渡せる形に」） ----------
  // 「出した」を押した直後に、昨日・今日・明日の予定と状態を Google ドライブ「kikitoa 投稿状態」に CSV で1つ置く。
  // 判定の決まり: 投稿済み＝done の記録だけ。予約済みは時刻を過ぎても「予約時刻経過・未確認」。URL があるだけでは投稿済みにしない。
  const fJst = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  function jst(t) {
    const p = Object.fromEntries(fJst.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return p.year + "-" + p.month + "-" + p.day + " " + p.hour + ":" + p.minute + ":" + p.second + "+09:00";
  }
  function jstAt(s) { if (!s) return ""; s = String(s); const t = Date.parse(/[+Z]/.test(s.slice(10)) ? s : s + "+09:00"); return isNaN(t) ? s : jst(t); }
  function csvCell(v) { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function statusRows(d, day, now, kind, src) {
    const upd = d && d.updated_at ? jstAt(d.updated_at) : "";
    const got = jst(now);
    const out = [];
    const slots = [["yt", "YouTube"], ["x", "X"], ["ig", "インスタ（リール）"], ["ig_story", "インスタ（ストーリーズ）"]];
    for (const [k, name] of slots) {
      if (!d) { out.push([kind, got, day, name, "Claude", "", "予定の記録なし", "", "", "予定の記録なし・要確認", src]); continue; }
      const st = d[k + "_state"] || "none";
      const at = d[k + "_at"] || "";
      const plan = at ? jstAt(at) : day + " 21:00:00+09:00";
      const due = Date.parse(plan);
      let state, judge, doneAt = "";
      if (st === "done") { state = "投稿済み"; judge = "投稿済み"; doneAt = at ? jstAt(at) : ""; }
      else if (st === "scheduled") { state = "予約済み"; judge = now >= due ? "予約時刻経過・未確認" : "予約済み"; }
      else if (st === "skip") { state = "出さない"; judge = "対象外"; }
      else { state = "まだ"; judge = now >= due ? "投稿忘れの疑い" : "時刻前"; }
      out.push([kind, got, day, name, "Claude", plan, state, doneAt, upd, judge, src]);
    }
    for (const [k, name] of [["tt", "TikTok"], ["tt_story", "TikTok（ストーリー）"]]) {
      if (!d) { out.push([kind, got, day, name, "本人", "", "予定の記録なし", "", "", "予定の記録なし・要確認", src]); continue; }
      const plan = (d.tt_plan || day) + " 23:59:00+09:00";
      const due = Date.parse(plan);
      const done = !!d[k + "_done"];
      const at = d[k + "_at"] || "";
      out.push([kind, got, day, name, "本人", plan, done ? "投稿済み" : "まだ", done && at ? jstAt(at) : "", upd, done ? "投稿済み" : (now >= due ? "投稿忘れの疑い" : "時刻前"), src]);
    }
    return out;
  }
  function statusCsv(now, override) {
    const today = ymd(new Date(now));
    const days = [addDay(today, -1), today, addDay(today, 1)];
    const src = "架空ボード（体験版内の操作）" + (S.fromCache ? "・端末の控えから（古い可能性）" : "");
    const lines = [["種別", "取得時刻", "日付", "投稿先", "担当", "投稿予定日時", "状態", "完了記録の時刻", "元データ更新時刻", "判定", "取得元"]];
    for (const day of days) {
      let d = S.docs.filter((x) => x.date === day).sort((a, b) => (a.ver || 0) - (b.ver || 0)).pop() || null;
      if (d && override && override.id === d.id) d = Object.assign({}, d, override.patch);
      for (const r of statusRows(d, day, now, "通常", src)) lines.push(r);
    }
    return lines.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
  }


  async function pushStatus(override) {
    const now = Date.now(), title = "架空_kikitoa-status_" + ymd(new Date(now)) + ".csv";
    window.KikiSample.saveStatus({ title, text: statusCsv(now, override) });
    S.drive = { ok: true, title, at: jst(now) }; render(true);
  }
  function driveBox() {
    const sec = section("ドライブへの記録（体験版は送信なし）"), box = el("div", "todo");
    box.append(el("p", null, "元アプリでは完了操作からDriveへ記録する欄です。この体験版は昨日・今日・明日の架空の予定と状態をブラウザ内に記録します。Google Driveには接続しません。"));
    const button = el("button", "btn ghost", "架空の記録CSVを保存"); button.type = "button";
    button.addEventListener("click", async () => { await pushStatus(null); window.KikiSample.downloadStatus(); }); box.append(button);
    if (S.drive && S.drive.ok) box.append(el("div", "done", "✓ ブラウザ内に記録しました：" + S.drive.title + "（" + S.drive.at.slice(11,16) + "）"));
    sec.append(box); return sec;
  }

  async function doneNote(n) {
    const key = "note:" + n.id;
    if (!S.db || busy.has(key)) return;
    busy.add(key);
    render(true);
    try {
      await S.db.doc("notes/" + n.id).update({ done: true, done_at: new Date().toISOString() });
    } catch (e) {
      setUi(key, "err", "記録できませんでした。もう一度押してください。", 10000);
    } finally {
      busy.delete(key);
      render(true);
    }
  }

  // ---------- 起動 ----------
  function watch(name) {
    try {
      S.db.collection(name).onSnapshot((snap) => {
        const rows = snap.docs.filter((x) => x.exists).map((x) => Object.assign({ id: x.id }, x.data()));
        if (name === "videos") { S.docs = rows; S.loaded = true; S.fromCache = !!(snap.metadata && snap.metadata.fromCache); } else { S.notes = rows; }
        render(false);
      }, (err) => {
        const code = (err && err.code) || "unavailable";
        if (code === "unavailable" && retries[name] < 3) {
          retries[name]++;
          setTimeout(() => watch(name), 2000 + Math.random() * 3000);
          return;
        }
        if (name === "videos") { S.err = code; render(true); }
      });
    } catch (_) {
      if (name === "videos") { S.err = "unavailable"; render(true); }
    }
  }

  async function boot() {
    S.db = window.KikiSample.db; S.dl = true; S.mcp = null; S.mcpChecked = true; S.mode = "live";
    watch("videos"); watch("notes");
    document.getElementById("portfolio-reset").addEventListener("click", () => {
      ui.clear(); busy.clear(); openRows.clear(); saveOpen(); S.drive = null; window.KikiSample.reset(); render(true);
    });
    setInterval(() => render(false), 60000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) render(false); });
  }

  boot();
})();
