/* gas-shim.js — google.script.run の代役（デモ用）
 *
 * 本物はGoogle Apps Script（サーバー）＋Googleスプレッドシートで動いています。
 * このファイルは同じ呼び出し方
 *   google.script.run.withSuccessHandler(fn).withFailureHandler(fn).apiLoad(pass)
 * をブラウザの中だけで再現します。
 *  - 少し待ってから返事をする（本物と同じ非同期）
 *  - 引数と戻り値はJSONで受け渡し（本物と同じく、画面側のデータとは別物になる）
 *  - データは「顧客」シートと同じ“行”の形で localStorage（demo-crm-〜）に保存
 *  - 写真の大きい画像・動画はメモリだけ（再読み込みで消えます）。サムネは保存
 */
(function () {
  "use strict";

  var P = "demo-crm-";
  var K_VER = P + "seed-version", K_ROWS = P + "rows", K_THUMBS = P + "thumbs";
  var SEED_VERSION = "1";

  /* ---- 本物のサーバー（コード.gs）と同じ列の並び ---- */
  var COLS = ["id", "name", "kana", "type", "rank", "area", "rep", "phone", "email",
    "crops", "filmMaker", "filmType", "filmSpec", "filmReplace", "houses", "nextFollow",
    "lastQuote", "history", "memo", "createdAt", "updatedAt",
    "dealPeriod", "dealType", "purchases", "quoteFiles", "fields", "homeAddress",
    "photos", "links", "requests", "consent",
    "firstName", "repName", "homePhone", "fax", "houseWidth", "houseDepth", "houseModel", "houseCount", "houseKind",
    "firstDeal", "lastVisit", "homeGeo"];
  var JSON_COLS = ["history", "purchases", "quoteFiles", "fields", "photos", "links", "requests"];

  function serHouses_(hs) {
    return (hs || []).map(function (h) { return (h.place || "") + ":" + (h.count || ""); }).join(";");
  }
  function parseHouses_(s) {
    return String(s || "").split(";").map(function (x) { return x.trim(); }).filter(String).map(function (x) {
      var i = x.lastIndexOf(":");
      return i < 0 ? { place: x, count: "" } : { place: x.slice(0, i), count: x.slice(i + 1) };
    });
  }
  function objToRow_(o) {
    return COLS.map(function (c) {
      if (c === "crops") return (o.crops || []).join(";");
      if (c === "houses") return serHouses_(o.houses);
      if (c === "consent") return JSON.stringify(o.consent || {});
      if (JSON_COLS.indexOf(c) >= 0) return JSON.stringify(o[c] || []);
      return o[c] == null ? "" : String(o[c]);
    });
  }
  function rowToObj_(row) {
    var o = {};
    COLS.forEach(function (c, i) { o[c] = row[i] == null ? "" : row[i]; });
    o.crops = String(o.crops || "").split(/[;；]/).map(function (s) { return s.trim(); }).filter(String);
    o.houses = parseHouses_(o.houses);
    JSON_COLS.forEach(function (c) {
      try { o[c] = JSON.parse(o[c] || "[]") || []; } catch (e) { o[c] = []; }
      if (!Array.isArray(o[c])) o[c] = [];
    });
    try { o.consent = JSON.parse(o.consent || "{}") || {}; } catch (e) { o.consent = {}; }
    o.dealPeriod = o.dealPeriod || "";
    o.dealType = o.dealType || "";
    o.homeAddress = o.homeAddress || "";
    o.createdAt = Number(o.createdAt) || 0;
    o.updatedAt = Number(o.updatedAt) || 0;
    return o;
  }

  /* ---- 保存場所（localStorage。使えない環境ではメモリだけで動く） ---- */
  var db = null;                         // { rows: [[...]], thumbs: [[fileId, customerId, thumb, date]] }
  var mem = { files: {}, videos: {} };   // 大きい画像（dataURL）・動画（blob URL）

  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsClear() {
    try {
      var ks = [];
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(P) === 0) ks.push(k); }
      ks.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
  }
  var warned = false;
  function persist() {
    var ok = lsSet(K_ROWS, JSON.stringify(db.rows));
    ok = lsSet(K_THUMBS, JSON.stringify(db.thumbs)) && ok;
    ok = lsSet(K_VER, SEED_VERSION) && ok;
    if (!ok && !warned) {
      warned = true;
      setTimeout(function () {
        if (typeof window.toast === "function")
          window.toast("デモ版：ブラウザに保存できませんでした。変更は再読み込みで消えます", true);
      }, 2000);
    }
  }
  function seed() {
    var s = window.DEMO_CRM_SEED();
    db = { rows: s.customers.map(objToRow_), thumbs: s.thumbs };
    persist();
  }
  function ensure() {
    if (db) return;
    if (lsGet(K_VER) === SEED_VERSION) {
      try {
        var rows = JSON.parse(lsGet(K_ROWS) || "null");
        var th = JSON.parse(lsGet(K_THUMBS) || "[]");
        if (Array.isArray(rows)) { db = { rows: rows, thumbs: Array.isArray(th) ? th : [] }; return; }
      } catch (e) {}
    }
    seed();
  }
  function rowIndex(id) {
    for (var i = 0; i < db.rows.length; i++) if (String(db.rows[i][0]) === String(id)) return i;
    return -1;
  }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function b64ToBlob(b64, mime) {
    var bin = atob(b64), n = bin.length, u = new Uint8Array(n);
    for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: mime });
  }

  /* デモには合言葉はありません（何か入っていれば通す） */
  function need_(pass) { if (!String(pass == null ? "" : pass)) throw new Error("合言葉が違います"); }

  /* ---- サーバー関数（コード.gs と同じ名前・同じ引数・同じ戻り値） ---- */
  var server = {
    verifyPass: function (pass) { return { ok: !!String(pass == null ? "" : pass) }; },

    apiLoad: function (pass) {
      need_(pass); ensure();
      var data = db.rows
        .filter(function (r) { return String(r[0]).trim() || String(r[1]).trim(); })
        .map(rowToObj_);
      return { ok: true, data: data };
    },

    apiSave: function (pass, recJson) {
      need_(pass); ensure();
      var rec = JSON.parse(recJson);
      var row = objToRow_(rec), i = rowIndex(rec.id);
      if (i >= 0) db.rows[i] = row; else db.rows.push(row);
      persist();
      return { ok: true };
    },

    apiDelete: function (pass, id) {
      need_(pass); ensure();
      var i = rowIndex(id);
      if (i >= 0) db.rows.splice(i, 1);
      persist();
      return { ok: true };
    },

    apiImport: function (pass, recsJson) {
      need_(pass); ensure();
      var recs = JSON.parse(recsJson);
      if (!recs.length) return { ok: true, n: 0 };
      recs.forEach(function (r) { db.rows.push(objToRow_(r)); });
      persist();
      return { ok: true, n: recs.length };
    },

    /* 写真・動画：本物はGoogleドライブに保存。デモはブラウザの中だけ */
    apiUploadFile: function (pass, customerId, name, mime, base64, thumb) {
      need_(pass); ensure();
      var id = "demo_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      var isVideo = String(mime).indexOf("video/") === 0;
      if (isVideo) {
        try { mem.videos[id] = URL.createObjectURL(b64ToBlob(base64, mime)); } catch (e) {}
      } else {
        mem.files[id] = "data:" + mime + ";base64," + base64;
      }
      var rec = { fileId: id, name: name, mime: mime, kind: isVideo ? "video" : "image",
        url: "", date: todayStr() };
      if (thumb) { db.thumbs.push([id, String(customerId), String(thumb), rec.date]); persist(); }
      return { ok: true, file: rec };
    },

    apiLoadThumbs: function (pass, customerId) {
      need_(pass); ensure();
      var out = {};
      db.thumbs.forEach(function (r) { if (String(r[1]) === String(customerId)) out[String(r[0])] = String(r[2]); });
      return { ok: true, thumbs: out };
    },

    apiGetFile: function (pass, fileId) {
      need_(pass); ensure();
      if (mem.files[fileId]) return { ok: true, dataUrl: mem.files[fileId] };
      var sample = window.DEMO_CRM_SAMPLE_PHOTO && window.DEMO_CRM_SAMPLE_PHOTO(fileId);
      if (sample) return { ok: true, dataUrl: sample };
      for (var i = 0; i < db.thumbs.length; i++) {
        if (String(db.thumbs[i][0]) === String(fileId)) return { ok: true, dataUrl: String(db.thumbs[i][2]) };
      }
      throw new Error("ファイルが見つかりません");
    },

    apiDeleteFile: function (pass, fileId) {
      need_(pass); ensure();
      delete mem.files[fileId];
      if (mem.videos[fileId]) { try { URL.revokeObjectURL(mem.videos[fileId]); } catch (e) {} delete mem.videos[fileId]; }
      db.thumbs = db.thumbs.filter(function (r) { return String(r[0]) !== String(fileId); });
      persist();
      return { ok: true };
    }
  };

  /* 本物っぽい待ち時間（ミリ秒） */
  function wait(name) {
    var base = name === "apiLoad" ? 450 : name === "apiUploadFile" ? 700 : name === "apiGetFile" ? 400 : 200;
    return base + Math.floor(Math.random() * 250);
  }
  function copy(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  /* ---- google.script.run（withSuccessHandler / withFailureHandler / withUserObject を連結できる） ---- */
  function runner(onOk, onNg, userObj) {
    var r = {
      withSuccessHandler: function (f) { return runner(f, onNg, userObj); },
      withFailureHandler: function (f) { return runner(onOk, f, userObj); },
      withUserObject: function (o) { return runner(onOk, onNg, o); }
    };
    Object.keys(server).forEach(function (name) {
      r[name] = function () {
        var args;
        try { args = copy([].slice.call(arguments)); } catch (e) { args = [].slice.call(arguments); }
        setTimeout(function () {
          var res, err = null;
          try { res = copy(server[name].apply(null, args)); }
          catch (e) { err = e instanceof Error ? e : new Error(String(e)); }
          if (err) { if (onNg) onNg(err, userObj); else if (window.console) console.error(err); }
          else if (onOk) onOk(res, userObj);
        }, wait(name));
      };
    });
    return r;
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = runner(null, null, undefined);
  window.google.script.host = window.google.script.host || {
    close: function () {}, setHeight: function () {}, setWidth: function () {}, editor: { focus: function () {} }
  };

  /* デモ専用の操作（画面の「見本データに戻す」ボタンから使う） */
  window.DEMO_CRM = {
    reset: function () {
      Object.keys(mem.videos).forEach(function (k) { try { URL.revokeObjectURL(mem.videos[k]); } catch (e) {} });
      mem = { files: {}, videos: {} };
      lsClear();
      warned = false;
      seed();
    },
    /* このページを開いている間だけ再生できる動画のURL（なければ null） */
    videoUrl: function (fileId) { return mem.videos[fileId] || null; }
  };
})();
