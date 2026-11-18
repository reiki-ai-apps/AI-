/* 請求書づくり デモ版：ローカルのPythonサーバーの代わりに、ブラウザの中で答える。
 * 画面（index.html）が呼ぶ fetch('api/…') をここで受け取り、架空のデータで返す。
 * 間違い探しのルールは本番のサーバー側の処理をそのままJSに移したもの。
 * 表示している会社名・金額・口座はすべて架空。 */
(function () {
  'use strict';

  // ------------------------------------------------------------ 架空の設定
  const DEMO_TODAY = '2026-07-03';            // デモの中の「今日」
  const BASE = 'C:\\見本サロン';
  const S = {
    title: '請 求 書',
    to: 'サンプル商事株式会社 御中',
    greeting: '下記のとおりご請求申し上げます。',
    bank: '見本銀行 中央支店 普通 0000000',
    bank_holder: 'ミホンサロン',
    issuer: ['見本サロン', '〒000-0000', '見本県見本市1-2-3', 'TEL 000-0000-0000', '担当 見本 花子'],
    subject: '企画・リサーチ業務委託',
    note: '作業時間の内訳は、別紙の作業時間表をご覧ください。',
    work_name: '企画・リサーチ業務　{month}月分',
    hourly: 2000,
    due_months_after: 2,
    workbook_name: '請求書　見本サロン　{year}.xlsx',
    pdf_dir_name: 'サンプル商事　請求書　{year}年',
    pdf_name: 'サンプル商事　請求書　{year}_{month}月分.pdf',
    other_pdf_name: 'サンプル商事　請求書　{subject}.pdf',
    old_pdf_dir_name: '差し替え前',
    // 誤字辞書（打ち間違い → 正しい書き方）
    typos: [['ご御', '御'], ['ツール台', 'ツール代'], ['保存台', '保存代'], ['交通日', '交通費'], ['リサーチー', 'リサーチ']],
  };

  // ------------------------------------------------------------ 小道具
  const isNum = v => typeof v === 'number' && isFinite(v);
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const fmt = (t, o) => t.replace(/\{(\w+)\}/g, (_, k) => o[k]);
  const basename = p => String(p || '').split('\\').pop();
  const dirname = p => { const s = String(p || ''); return s.substring(0, s.lastIndexOf('\\')); };
  const clone = o => JSON.parse(JSON.stringify(o));

  function pyRound(x) {                      // Python の round()（偶数への丸め）と同じ
    const f = Math.floor(x), diff = x - f;
    if (diff > 0.5) return f + 1;
    if (diff < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  }
  function num(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const s = String(v).normalize('NFKC').replace(/,/g, '').replace(/円/g, '').replace(/\$/g, '').trim();
    if (!s || !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
    return Number(s);
  }
  const yen = n => (n === null || n === undefined || !isFinite(n)) ? '（空）' : Math.trunc(n).toLocaleString('ja-JP');
  const qtyText = q => isNum(q) ? String(q) : String(q ?? '');
  function roundTax(subtotal) {              // エクセルの ROUND(小計*10/110, 0) と同じ
    const s = Math.trunc(subtotal);
    return s >= 0 ? Math.floor((s * 10 + 55) / 110) : -Math.floor((-s * 10 + 55) / 110);
  }

  // 日付は 'YYYY-MM-DD' の文字列で持つ（文字列のまま大小を比べられる）
  const iso = (y, m, d) => `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;
  function toDate(v) {
    if (v === null || v === undefined || v === '') return null;
    const m = /(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/.exec(String(v).normalize('NFKC').trim());
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
    return iso(y, mo, d);
  }
  const ymd = s => s.split('-').map(Number);
  const dayNo = s => { const [y, m, d] = ymd(s); return Date.UTC(y, m - 1, d) / 864e5; };
  function addDays(s, k) { const t = new Date((dayNo(s) + k) * 864e5); return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
  function addMonths(y, m, k) { const i = y * 12 + (m - 1) + k; return [Math.floor(i / 12), i % 12 + 1]; }
  function monthEnd(y, m) { return iso(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate()); }
  const fmtDate = s => s ? s.replaceAll('-', '/') : '（空）';
  const tkey = t => t[0] * 100 + t[1];
  const sameT = (a, b) => (a == null && b == null) || (a != null && b != null && a[0] === b[0] && a[1] === b[1]);

  // ------------------------------------------------------------ 名前の扱い
  const USD_RE = /[（(]?\s*[＄$]\s*([\d,]+(?:\.\d+)?)\s*[）)]?|[（(]\s*([\d,]+(?:\.\d+)?)\s*[＄$]\s*[）)]/;
  function splitUsd(name) {                  // '画像編集ツール代（＄20）' → ['画像編集ツール代', '20']
    name = name || '';
    const m = USD_RE.exec(name);
    if (!m) return [name.trim(), ''];
    const usd = (m[1] || m[2]).replace(/,/g, '');
    return [(name.slice(0, m.index) + name.slice(m.index + m[0].length)).trim(), usd];
  }
  function fixName(base) {
    for (const [bad, good] of S.typos) base = base.split(bad).join(good);
    return base.replace(/\(/g, '（').replace(/\)/g, '）').trim();
  }
  const itemName = (base, usd) => fixName(base) + (usd ? `（＄${usd}）` : '');
  function itemKey(name) {
    let base = splitUsd(name)[0];
    if (base.includes('ツール代')) base = base.split('ツール代')[0];
    base = base.replace(/[（(].*?[）)]/g, '').replace(/\d{1,2}月分/g, '');
    return base.replace(/[\s　]/g, '').toLowerCase();
  }
  function monthIn(name) {                   // 「○月分」の数字（なければ null）
    const m = /(?:^|[^\d月])(\d{1,2})月分/.exec(String(name || '').normalize('NFKC'));
    return m ? parseInt(m[1], 10) : null;
  }
  const isWorkRow = r => (r.unit || '') === '時間';
  function textWidth(s) {                    // 半角=1・全角=2
    let w = 0;
    for (const ch of String(s || '')) { const c = ch.codePointAt(0); w += (c < 0x80 || (c >= 0xFF61 && c <= 0xFFDC)) ? 1 : 2; }
    return w;
  }
  const safeName = s => String(s || '').replace(/[\\/:*?"<>|[\]]/g, '').trim();

  // ------------------------------------------------------------ 今までの請求書（架空）
  const DB = {sheets: [], pdfs: []};

  function planPaths(inv) {
    let y, pdf, sheet;
    if (inv.kind === 'monthly') {
      const [ty, tm] = inv.target;
      y = ty;
      pdf = `${BASE}\\${fmt(S.pdf_dir_name, {year: y})}\\${fmt(S.pdf_name, {year: y, month: tm})}`;
      sheet = `${y}年${tm}月分`;
    } else {
      y = ymd(inv.date)[0];
      pdf = `${BASE}\\${fmt(S.pdf_dir_name, {year: y})}\\${fmt(S.other_pdf_name, {subject: safeName(inv.subject)})}`;
      sheet = safeName(inv.subject).slice(0, 28) || '別件';
    }
    return {book: `${BASE}\\${fmt(S.workbook_name, {year: y})}`, pdf, sheet};
  }

  function makeRecords(inv, where) {
    const rows = inv.rows.map(r => {
      const q = isNum(r.qty) ? r.qty : 1;
      return {name: r.name, qty: q, unit: r.unit, price: r.price, amount: isNum(r.price) ? pyRound(q * r.price) : null};
    });
    const sub = rows.reduce((s, r) => s + (r.amount || 0), 0);
    const base = {kind: inv.kind, target: inv.target, no: inv.no, date: inv.date, due: inv.due, subject: inv.subject,
      note: inv.note, subtotal: sub, tax: roundTax(sub), total: sub, header_total: sub,
      title: S.title, to: S.to, greeting: S.greeting, issuer: S.issuer.slice(), bank: S.bank, holder: S.bank_holder};
    const yr = /(\d{4})\.xlsx$/.exec(where.book);
    const sheet = Object.assign(clone(base), {source: 'sheet', rows: clone(rows), book: where.book, sheet: where.sheet, book_year: yr ? +yr[1] : null});
    const pdf = Object.assign(clone(base), {source: 'pdf', rows: clone(rows), file: where.file});
    return [sheet, pdf];
  }

  function dueOf(date) { const [y, m] = ymd(date); const [dy, dm] = addMonths(y, m, S.due_months_after); return monthEnd(dy, dm); }

  function seed() {
    DB.sheets = []; DB.pdfs = [];
    const months = [
      {no: 13, m: 1, date: '2026-02-03', hours: 58.5, img: 3080, move: 1080},
      {no: 14, m: 2, date: '2026-03-03', hours: 61, img: 3010, move: 1240, typo: true},     // 誤字「ツール台」
      {no: 16, m: 3, date: '2026-04-02', hours: 64.5, img: 2990, move: 980, tax10: true},   // 内税を10%で計算
      {no: 17, m: 4, date: '2026-05-07', hours: 59, img: 3050, move: 1120, workMonth: 3},   // 4月分なのに摘要が「3月分」
      {no: 18, m: 5, date: '2026-06-02', hours: 63.5, img: 3120, move: 1240},
    ];
    for (const h of months) {
      const inv = formToInv({kind: 'monthly', year: 2026, month: h.m, no: h.no, date: h.date, due: dueOf(h.date),
        subject: S.subject, note: S.note, rows: [
          {role: 'work', qty: h.hours, unit: '時間', price: S.hourly},
          {role: 'item', name: '画像編集ツール代', usd: '20', qty: 1, unit: '月', price: h.img},
          {role: 'item', name: '音楽生成ツール代', usd: '10', qty: 1, unit: '月', price: 1500},
          {role: 'item', name: 'クラウド保存代', usd: '', qty: 1, unit: '月', price: 1300},
          {role: 'item', name: `打ち合わせ交通費　${h.m}月分`, usd: '', qty: 1, unit: '式', price: h.move},
        ]});
      const p = planPaths(inv);
      const recs = makeRecords(inv, {book: p.book, sheet: p.sheet, file: p.pdf});
      for (const x of recs) {
        if (h.typo) x.rows[1].name = '画像編集ツール台（＄20）';
        if (h.workMonth) x.rows[0].name = fmt(S.work_name, {month: h.workMonth});
        if (h.tax10) x.tax = Math.floor(x.subtotal * 0.1);
      }
      DB.sheets.push(recs[0]); DB.pdfs.push(recs[1]);
    }
    // 月ごとではない請求（展示会の手伝い）
    const o = formToInv({kind: 'other', no: 15, date: '2026-03-25', due: dueOf('2026-03-25'),
      subject: '見本フェア2026春　出店支援業務', note: '', rows: [                               // 件名「出店」・明細「出展」
        {role: 'item', name: '出展支援業務費（見本）', qty: 16, unit: '時間', price: 2000},
        {role: 'item', name: '会場までの交通費', qty: 1, unit: '式', price: 2460},
      ]});
    const p = planPaths(o);
    const recs = makeRecords(o, {book: p.book, sheet: p.sheet, file: p.pdf});
    for (const x of recs) x.greeting = '下記のとおりご御請求申し上げます。';                 // 「御」が二重
    DB.sheets.push(recs[0]); DB.pdfs.push(recs[1]);
  }

  // ------------------------------------------------------------ 集計（本番の context() と同じ）
  function context() {
    const sheets = DB.sheets, pdfs = DB.pdfs, all = sheets.concat(pdfs);
    const nos = all.map(x => x.no).filter(isNum);
    const ctx = {sheets, pdfs, max_no: nos.length ? Math.trunc(Math.max(...nos)) : 0};
    ctx.used_nos = new Map();
    for (const x of all) {
      if (x.no === null || x.no === undefined) continue;
      const k = Math.trunc(x.no);
      if (!ctx.used_nos.has(k)) ctx.used_nos.set(k, new Set());
      ctx.used_nos.get(k).add(x.date);
    }
    ctx.months = new Map();
    for (const x of pdfs.concat(sheets)) if (x.kind === 'monthly' && x.target && !ctx.months.has(tkey(x.target))) ctx.months.set(tkey(x.target), x);
    // ドル払いのうち「カード明細の円をそのまま書く」もの（毎月変わる）と「決めた換算」のものを見分ける
    const rates = {}, seen = new Set();
    for (const x of all) {
      const sk = `${x.no}|${x.target}`;
      if (x.kind !== 'monthly' || seen.has(sk)) continue;
      seen.add(sk);
      for (const r of x.rows) {
        const usd = splitUsd(r.name)[1];
        if (!isWorkRow(r) && usd && r.amount) (rates[itemKey(r.name)] ||= []).push(Math.round(r.amount / parseFloat(usd) * 10) / 10);
      }
    }
    ctx.fixed_rate = {}; ctx.variable = {};
    for (const [k, v] of Object.entries(rates)) {
      const cnt = new Map(); v.forEach(x => cnt.set(x, (cnt.get(x) || 0) + 1));
      let top = null, best = -1;
      for (const [x, c] of cnt) if (c > best) { top = x; best = c; }
      if (v.length >= 3 && best / v.length >= 0.7) ctx.fixed_rate[k] = top;
      else if (cnt.size > 1) ctx.variable[k] = true;
    }
    return ctx;
  }

  function monthlyRecords(ctx) {
    const best = new Map();
    for (const x of ctx.pdfs.concat(ctx.sheets)) {
      if (x.kind !== 'monthly' || !x.target) continue;
      const k = tkey(x.target), cur = best.get(k);
      if (!cur || (x.no || 0) > (cur.no || 0) || ((x.no || 0) === (cur.no || 0) && x.source === 'sheet')) best.set(k, x);
    }
    return [...best.keys()].sort((a, b) => a - b).map(k => best.get(k));
  }
  function previousMonthly(ctx, target, excludeNo = null) {
    let best = null;
    for (const x of monthlyRecords(ctx)) if (tkey(x.target) < tkey(target) && x.no !== excludeNo) best = x;
    return best;
  }

  // ------------------------------------------------------------ 間違い探し（本番の find_issues と同じ物差し）
  // mode: new（新しく作る）/ fix（作った請求書を直す）/ audit（送ったPDFの検査）/ readback（作ったPDFの読み戻し）
  function findIssues(inv, ctx, mode) {
    const out = [];
    const add = (level, msg) => out.push({level, msg});
    const kind = inv.kind, tgt = inv.target, d = inv.date, due = inv.due, no = inv.no;
    const rows = inv.rows || [];
    const td = DEMO_TODAY;

    // --- 番号
    if (!no) add('error', 'No（請求書の番号）が空です。');
    else if (mode === 'new') {
      const n = Math.trunc(no);
      if (ctx.used_nos.has(n)) add('error', `No.${n} はもう使っている番号です。次は No.${ctx.max_no + 1} です。`);
      else if (n !== ctx.max_no + 1) add('warn', `前回の番号は No.${ctx.max_no} です。No.${ctx.max_no + 1} ではありませんか。`);
      else add('ok', `No.${n} は前回の続きの番号`);
    } else if (mode === 'fix') {
      const orig = inv.orig_no;
      if (orig && Math.trunc(no) !== Math.trunc(orig) && ctx.used_nos.has(Math.trunc(no)))
        add('error', `No.${Math.trunc(no)} はほかの請求書で使っている番号です（直す前は No.${Math.trunc(orig)}）。`);
    } else if (mode === 'audit') {
      const same = ctx.pdfs.filter(p => p.no === no && p.file !== inv.file);
      if (same.length) add('error', `No.${Math.trunc(no)} が「${basename(same[0].file)}」でも使われています。`);
    }

    // --- 月の二重請求・とばし
    if (mode === 'new' && kind === 'monthly' && tgt) {
      const hit = ctx.months.get(tkey(tgt));
      if (hit) add('error', `${tgt[0]}年${tgt[1]}月分はもう作ってあります（No.${hit.no}）。直す時は上の「作った請求書を直す」から開いてください。`);
      else add('ok', `${tgt[1]}月分の二重請求なし`);
      const pv = previousMonthly(ctx, tgt);
      if (pv) {
        const [ny, nm] = addMonths(pv.target[0], pv.target[1], 1);
        if (ny !== tgt[0] || nm !== tgt[1]) add('warn', `前回は ${pv.target[0]}年${pv.target[1]}月分です。${ny}年${nm}月分をとばしていませんか。`);
      }
      if (td <= monthEnd(tgt[0], tgt[1])) add('warn', `${tgt[1]}月はまだ終わっていません。${tgt[1]}月分は月が明けてから作るのがふつうです。`);
    }

    // --- 日付
    let dateOk = true;
    if (!d) { add('error', '請求日が空です。'); dateOk = false; }
    else {
      if (kind === 'monthly' && tgt) {
        if (d < iso(tgt[0], tgt[1], 1)) {
          add('error', `請求日 ${fmtDate(d)} が「${tgt[0]}年${tgt[1]}月分」より前の日付です。年か月の打ち間違いでは？`); dateOk = false;
        } else if (d > monthEnd(...addMonths(tgt[0], tgt[1], 3))) {
          add('warn', `請求日 ${fmtDate(d)} は ${tgt[1]}月分にしては遅すぎます。年の打ち間違いでは？`); dateOk = false;
        }
      }
      if ((mode === 'new' || mode === 'fix') && d > addDays(td, 3)) { add('warn', `請求日 ${fmtDate(d)} が先の日付です。`); dateOk = false; }
    }
    if (!due) { add('error', '支払期限が空です。'); dateOk = false; }
    else if (d && due <= d) { add('error', `支払期限 ${fmtDate(due)} が請求日 ${fmtDate(d)} より前です。`); dateOk = false; }
    else if (d && dateOk && dayNo(due) - dayNo(d) > 125) { add('warn', `支払期限 ${fmtDate(due)} が請求日から4か月以上先です。`); dateOk = false; }
    if (dateOk && d && due) add('ok', `請求日 ${fmtDate(d)} → 支払期限 ${fmtDate(due)}`);

    // --- 明細
    if (!rows.length) add('error', '明細が1行もありません。');
    if (rows.length > 14) add('error', `明細が ${rows.length} 行あります。1枚に入るのは14行までです。`);
    let mathOk = true, monthOk = true;
    const workMonths = rows.filter(r => isWorkRow(r) && monthIn(r.name) !== null);
    for (const r of rows) {
      const name = r.name || '', qty = r.qty, price = r.price, amt = r.amount;
      const label = name || '（名前のない行）';
      if (!name) add('error', `名前のない行があります（${yen(amt)}円）。`);
      if (isWorkRow(r)) {
        if (!isNum(qty) || qty <= 0) { add('error', '作業時間が空です。作業時間の表の、その月の合計を入れてください。'); mathOk = false; }
        else if ((qty * 2) % 1) add('warn', `作業時間 ${qtyText(qty)} 時間が 0.5 時間きざみではありません。`);
        else if (qty > 250) add('warn', `作業時間 ${qtyText(qty)} 時間は多すぎませんか（1日8時間でも月に約240時間）。`);
      }
      if (price === null || price === undefined || (isNum(price) && price <= 0)) {
        if (!isWorkRow(r)) add('error', `「${label}」の金額が空です。`);
        mathOk = false;
      }
      const q = isNum(qty) ? qty : 1;
      if (isNum(price) && amt !== null && amt !== undefined && pyRound(q * price) !== amt) {
        add('error', `「${label}」: ${qtyText(q)} × ${yen(price)} = ${yen(pyRound(q * price))}円 のはずが ${yen(amt)}円 です。`); mathOk = false;
      }
      const mo = monthIn(name);
      if (kind === 'monthly' && tgt && mo !== null && mo !== tgt[1]) {
        if (!isWorkRow(r)) add('warn', `「${name}」と書いてあります。この請求書は ${tgt[1]}月分です。`);
        else if (workMonths.length === 1) { add('error', `「${name}」と書いてあります。この請求書は ${tgt[1]}月分です。`); monthOk = false; }
      }
      const typo = S.typos.filter(([bad]) => name.includes(bad));
      const mixed = (name.includes('(') && name.includes('）')) || (name.includes('（') && name.includes(')'));
      if (typo.length || mixed) { const [b, u] = splitUsd(name); add('warn', `表記の間違い: 「${name}」→「${itemName(b, u)}」`); }
      if (textWidth(name) > 44) add('warn', `「${label}」は長くて、欄の右がはみ出して切れるかもしれません。`);
      const [base, usd] = splitUsd(name);
      if (usd && isNum(price) && price > 0) {
        const rate = price / parseFloat(usd);
        const fr = ctx.fixed_rate[itemKey(name)];
        if (fr && Math.abs(rate - fr) / fr > 0.01)
          add('warn', `${fixName(base)}: ＄${usd} なのに ${yen(price)}円 です。いつもの換算（1ドル ${fr}円）なら ${yen(pyRound(parseFloat(usd) * fr))}円 です。ドルの額か円の額のどちらかが違いませんか。`);
        else if (!(rate >= 120 && rate <= 200))
          add('warn', `${fixName(base)}: ＄${usd} で ${yen(price)}円（1ドル ${rate.toFixed(0)}円）。額を確かめてください。`);
      }
    }
    if (kind === 'monthly' && tgt && monthOk && rows.length) add('ok', `明細の「${tgt[1]}月分」と請求の月が一致`);

    // --- 計算（小計・消費税・合計）
    const sub = rows.reduce((s, r) => s + (r.amount || 0), 0);
    for (const [key, label, want] of [['subtotal', '小計', sub], ['tax', '内税（消費税）', roundTax(sub)], ['total', '合計', sub], ['header_total', '上の大きな合計', sub]]) {
      const got = inv[key];
      if (got !== null && got !== undefined && Math.trunc(pyRound(got)) !== Math.trunc(want)) {
        add('error', `${label}が ${yen(got)}円 になっています（正しくは ${yen(want)}円）。`); mathOk = false;
      }
    }
    if (mathOk && rows.length) add('ok', '数量×単価・小計・消費税・合計の計算');

    // --- 決まった文字（宛名・発行者・振込先）
    if (mode === 'audit' || mode === 'readback') {
      let fixedOk = true;
      const checks = [['宛名', inv.to, S.to], ['あいさつ文', inv.greeting, S.greeting], ['振込先', inv.bank, S.bank], ['口座名義', inv.holder, S.bank_holder]];
      const iss = inv.issuer || [];
      S.issuer.forEach((want, i) => checks.push(['発行者欄', i < iss.length ? iss[i] : '', want]));
      for (const [label, got0, want] of checks) {
        const got = String(got0 || '').trim();
        if (got !== want) {
          fixedOk = false;
          if (got.includes('ご御')) add('error', `${label}が「${got}」です（「御」が二重）。`);
          else add('error', `${label}が「${got || '（空）'}」です（正しくは「${want}」）。`);
        }
      }
      if (fixedOk) add('ok', '宛名・発行者・振込先の文字');
    } else add('ok', '宛名・発行者・振込先はいつもの文字を自動で入れます');

    // --- 件名・備考
    const subj = inv.subject || '';
    if (!subj) add('error', '件名が空です。');
    if (subj.includes('出店') && rows.some(r => (r.name || '').includes('出展'))) add('warn', '件名は「出店」、明細は「出展」です。展示会なら「出展」にそろえてください。');
    if (kind === 'monthly' && !String(inv.note || '').trim()) add('info', '備考が空です（いつもは作業時間の表の案内を入れています）。');

    // --- 先月との比べ（ドル払いの写し忘れ・額の大きな変化）
    if (kind === 'monthly' && tgt) {
      const prev = previousMonthly(ctx, tgt, mode !== 'new' ? no : null);
      if (prev) {
        const pi = new Map(), ci = new Map();
        for (const r of prev.rows) if (!isWorkRow(r)) pi.set(itemKey(r.name), r);
        for (const r of rows) if (!isWorkRow(r)) ci.set(itemKey(r.name), r);
        for (const [k, r] of ci) {
          const [base, usd] = splitUsd(r.name);
          const p = pi.get(k);
          if (!p) { add('info', `「${fixName(base)}」は先月の請求になかった項目です。`); continue; }
          const pa = p.amount, ca = r.amount;
          if (pa === null || pa === undefined || ca === null || ca === undefined) continue;
          const dollar = !!(usd || splitUsd(p.name)[1]);
          if (ca === pa && dollar && ctx.variable[k])
            add('warn', `${fixName(base)}: 先月と1円も違わない ${yen(ca)}円 です。ドル払いは毎月円の額が変わります。カード明細の額か確かめてください。`);
          else if (pa && Math.abs(ca - pa) / pa > 0.3)
            add('warn', `${fixName(base)}: 先月 ${yen(pa)}円 → 今月 ${yen(ca)}円。合っていますか。`);
        }
        for (const [k, p] of pi) if (!ci.has(k)) add('info', `先月あった「${fixName(splitUsd(p.name)[0])}」が今月はありません（やめたならこのままでOK）。`);
      }
    }

    // --- ファイル名とエクセルとの食い違い（送ったPDFの検査だけ）
    if (mode === 'audit') {
      if (/\(\d+\)|コピー/.test(basename(inv.file))) add('warn', 'ファイル名に「(1)」などが付いています（同じ名前で2回保存した印）。');
      const cands = ctx.sheets.filter(s => s.no === no && s.kind === inv.kind);
      const twin = cands.find(s => s.date === d && sameT(s.target, inv.target)) || cands.find(s => sameT(s.target, inv.target))
        || cands.find(s => s.date === d) || cands[0] || null;
      if (twin) {
        if (twin.total != null && inv.total != null && Math.trunc(twin.total) !== Math.trunc(inv.total))
          add('warn', `エクセルの同じ番号のシート「${twin.sheet}」と合計が違います（エクセル ${yen(twin.total)}円 / PDF ${yen(inv.total)}円）。`);
        if (twin.date && d && twin.date !== d)
          add('warn', `エクセルの同じ番号のシート「${twin.sheet}」と請求日が違います（エクセル ${fmtDate(twin.date)} / PDF ${fmtDate(d)}）。`);
      }
    }
    return sortIssues(out);
  }
  const ORDER = {error: 0, warn: 1, info: 2, ok: 3};
  const sortIssues = xs => xs.sort((a, b) => ORDER[a.level] - ORDER[b.level]);

  // ------------------------------------------------------------ 入力画面 ⇔ 請求書
  function formToInv(f) {
    const kind = f.kind || 'monthly';
    const y = num(f.year), m = num(f.month);
    const rows = [];
    for (const r of f.rows || []) {
      if (r.on === false) continue;
      const role = r.role || 'item';
      let name;
      if (role === 'work' && kind === 'monthly') name = fmt(S.work_name, {month: m});
      else {
        const usd = String(r.usd || '').normalize('NFKC').replace(/\$/g, '').replace(/,/g, '').trim();
        name = itemName(String(r.name || '').trim(), usd);
      }
      const qty = num(r.qty), price = num(r.price);
      if (!name && qty === null && price === null) continue;
      const amount = isNum(qty) && isNum(price) ? pyRound(qty * price) : null;
      rows.push({name, qty, unit: String(r.unit || '').trim(), price, amount, role});
    }
    const sub = rows.reduce((s, r) => s + (r.amount || 0), 0);
    return {kind, target: kind === 'monthly' && y && m ? [Math.trunc(y), Math.trunc(m)] : null,
      no: num(f.no), orig_no: num(f.orig_no), date: toDate(f.date), due: toDate(f.due),
      subject: String(f.subject || '').trim(), note: String(f.note || '').trim(), rows,
      subtotal: sub, tax: roundTax(sub), total: sub, header_total: sub, book: f.book, sheet: f.sheet};
  }

  function invToForm(inv, ctx) {             // エクセルのシートを、画面で直せる形にする
    const rows = [];
    for (const r of inv.rows) {
      if (inv.kind === 'monthly' && isWorkRow(r) && monthIn(r.name) !== null && !rows.some(x => x.role === 'work')) {
        rows.push({role: 'work', on: true, name: r.name, usd: '', qty: r.qty, unit: '時間', price: r.price});
      } else {
        const [base, usd] = splitUsd(r.name), k = itemKey(r.name);
        rows.push({role: 'item', on: true, name: fixName(base), usd, qty: r.qty, unit: r.unit, price: r.price,
          prev: r.amount, variable: !!(ctx.variable[k] && usd), rate: ctx.fixed_rate[k] ?? null});
      }
    }
    const tgt = inv.target || [null, null];
    return {mode: 'fix', kind: inv.kind, year: tgt[0], month: tgt[1], no: inv.no, orig_no: inv.no,
      date: inv.date || '', due: inv.due || '', subject: inv.subject, note: inv.note, rows, book: inv.book, sheet: inv.sheet};
  }

  function defaults(ctx) {                   // 次に作る月の請求書を、先月の請求書から組み立てる
    const recs = monthlyRecords(ctx), last = recs.length ? recs[recs.length - 1] : null;
    const [ty, tm] = ymd(DEMO_TODAY);
    const [y, m] = last ? addMonths(last.target[0], last.target[1], 1) : addMonths(ty, tm, -1);
    const [dy, dm] = addMonths(ty, tm, S.due_months_after);
    const rows = [{role: 'work', on: true, name: '', usd: '', qty: '', unit: '時間', price: S.hourly}];
    if (last) {
      const work = last.rows.find(isWorkRow);
      if (work && work.price) { rows[0].price = work.price; rows[0].prev_qty = work.qty; }
      for (const r of last.rows) {
        if (isWorkRow(r)) continue;
        const [base, usd] = splitUsd(r.name), k = itemKey(r.name);
        const variable = !!ctx.variable[k] && !!usd;
        rows.push({role: 'item', on: true, name: fixName(base), usd, qty: isNum(r.qty) ? r.qty : 1, unit: r.unit || '月',
          // ドル払いで毎月額が変わるものは、先月の額を残さない（写し忘れの元）
          price: variable ? '' : r.price, prev: r.amount, variable, rate: ctx.fixed_rate[k] ?? null});
      }
    }
    return {mode: 'new', kind: 'monthly', year: y, month: m, no: ctx.max_no + 1, orig_no: null,
      date: DEMO_TODAY, due: monthEnd(dy, dm), subject: S.subject, note: S.note, rows,
      last: last ? {no: last.no, target: last.target} : null};
  }

  // デモの最初の画面：6月分の見本に、わざと間違いを3つ入れる
  function sampleForm(ctx, fixed) {
    const f = defaults(ctx);
    f.sample = true;
    f.date = fixed ? DEMO_TODAY : '2025-07-03';                                 // ✕ 請求日の年の打ち間違い
    const w = f.rows.find(r => r.role === 'work');
    if (w) w.qty = 62.5;
    for (const r of f.rows) {
      if (r.role !== 'item') continue;
      if (r.variable) r.price = fixed ? r.prev - 35 : r.prev;                    // ！ ドル払いなのに先月と1円も同じ
      if (monthIn(r.name) !== null) {                                            // ！ 先月の行を写して「5月分」のまま
        r.price = 1060;
        if (fixed) r.name = r.name.replace(/\d{1,2}月分/, `${f.month}月分`);
      }
    }
    return f;
  }

  function invoiceList(ctx) {
    const xs = ctx.sheets.slice().sort((a, b) => ((b.no || 0) - (a.no || 0)) || (b.book_year - a.book_year));
    const out = [];
    for (const s of xs) {
      const y = s.target ? s.target[0] : (s.date ? ymd(s.date)[0] : s.book_year);
      if (y !== s.book_year) continue;
      out.push({book: s.book, sheet: s.sheet, no: s.no, date: s.date, total: s.total,
        label: s.target ? `${s.target[0]}年${s.target[1]}月分` : (s.subject || s.sheet), kind: s.kind, book_name: basename(s.book)});
    }
    return out;
  }

  function audit() {
    const ctx = context();
    return ctx.pdfs.slice().sort((a, b) => (b.no || 0) - (a.no || 0)).map(p => ({
      file: basename(p.file), folder: basename(dirname(p.file)), path: p.file, no: p.no, date: p.date, total: p.total,
      issues: findIssues(p, ctx, 'audit').filter(i => i.level !== 'ok')}));
  }

  function plan(inv, data) {
    try {
      if (inv.kind === 'monthly' && !inv.target) return null;
      if (inv.kind !== 'monthly' && !(inv.date && inv.subject)) return null;
      const p = planPaths(inv);
      if ((data.mode || 'new') === 'fix') return {book: basename(data.book || p.book), sheet: data.sheet, pdf: basename(p.pdf), pdf_dir: basename(dirname(p.pdf))};
      return {book: basename(p.book), sheet: p.sheet, pdf: basename(p.pdf), pdf_dir: basename(dirname(p.pdf)), new_book: !DB.sheets.some(s => s.book === p.book)};
    } catch (e) { return null; }
  }

  function compareReadback(inv, got) {       // 作ったPDFを読み戻して、入れたとおりかを1項目ずつ照合
    const res = [];
    const chk = (label, want, have) => res.push({ok: want === have, label, want: String(want), have: String(have)});
    const line = r => `${r.name} / ${qtyText(r.qty)}${r.unit} / ${yen(r.price)} / ${yen(r.amount)}`;
    chk('No', Math.trunc(inv.no), got.no != null ? Math.trunc(got.no) : null);
    chk('請求日', fmtDate(inv.date), fmtDate(got.date));
    chk('支払期限', fmtDate(inv.due), fmtDate(got.due));
    chk('明細の行数', inv.rows.length, got.rows.length);
    inv.rows.forEach((a, i) => { if (got.rows[i]) chk(`明細「${a.name}」`, line(a), line(got.rows[i])); });
    chk('合計', yen(inv.total), yen(got.total));
    chk('消費税', yen(inv.tax), yen(got.tax));
    return res;
  }

  function stamp() {
    const t = new Date();
    return `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}_${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`;
  }

  // 本番はここでエクセルを動かしてPDFを作る。デモでは見本の請求書を画面の中だけで作る
  function create(form) {
    const ctx = context(), inv = formToInv(form), mode = form.mode || 'new';
    const issues = findIssues(inv, ctx, mode);
    if (issues.some(i => i.level === 'error')) return {ok: false, error: '赤い項目を直してから、もう一度押してください。', issues};
    const p = planPaths(inv);
    let workbook = p.book, sheet = p.sheet;
    if (mode === 'fix') { workbook = inv.book; sheet = inv.sheet; }
    else {
      const existing = new Set(DB.sheets.filter(s => s.book === workbook).map(s => s.sheet));
      const base = sheet; let n = 2;
      while (existing.has(sheet)) sheet = `${base}(${n++})`;
      if (DB.pdfs.some(x => x.file === p.pdf)) return {ok: false, error: `「${basename(p.pdf)}」がもうあります。直す時は「作った請求書を直す」から開いてください。`};
    }
    const moved = [];
    if (mode === 'fix') {                    // 前のPDF（同じ番号のもの）は「差し替え前」へ
      const oldDir = dirname(p.pdf) + '\\' + S.old_pdf_dir_name;
      const olds = DB.pdfs.filter(x => x.no === inv.no && dirname(x.file) === dirname(p.pdf));
      const same = DB.pdfs.find(x => x.file === p.pdf);
      if (same && !olds.includes(same)) olds.push(same);
      for (const x of olds) {
        DB.pdfs.splice(DB.pdfs.indexOf(x), 1);
        moved.push(`${oldDir}\\${basename(x.file).replace(/\.pdf$/, '')}_${stamp()}.pdf`);
      }
    }
    const [sh, pdf] = makeRecords(inv, {book: workbook, sheet, file: p.pdf});
    const at = DB.sheets.findIndex(s => s.book === workbook && s.sheet === sheet);
    if (mode === 'fix' && at >= 0) DB.sheets[at] = sh; else DB.sheets.push(sh);
    DB.pdfs.push(pdf);
    const got = clone(pdf);                  // 「作ったPDFを読み戻した」ことにする
    got.target = inv.target; got.kind = inv.kind;
    return {ok: true, demo: true, sheet, workbook, pdf: p.pdf, moved, excel_total: pdf.total,
      verify: compareReadback(inv, got), issues: findIssues(got, context(), 'readback'), record: got};
  }

  // ------------------------------------------------------------ 画面からの問い合わせに答える
  function route(name, method, body) {
    const ctx = context();
    switch (name) {
      case 'ping': return {ok: true, app: 'invoice-demo'};
      case 'state': {
        const sampleDone = ctx.months.has(202606);
        return {today: DEMO_TODAY, form: sampleDone ? defaults(ctx) : sampleForm(ctx, false),
          fixed: sampleForm(ctx, true), sample_done: sampleDone, invoices: invoiceList(ctx), max_no: ctx.max_no,
          work_name: S.work_name};
      }
      case 'check': {
        const inv = formToInv(body), mode = body.mode || 'new';
        const issues = findIssues(inv, ctx, mode);
        // 名前の誤字は、載せる時に誤字辞書で自動で直す（本番も同じ）。デモではそれを灰色で知らせる
        for (const r of body.rows || []) {
          if (r.on === false || (r.role === 'work' && inv.kind === 'monthly')) continue;
          const raw = String(r.name || '').trim(), fixed = fixName(raw);
          if (raw && raw !== fixed) issues.push({level: 'info', msg: `「${raw}」は誤字辞書で「${fixed}」に直して載せます。`});
        }
        return {issues: sortIssues(issues), subtotal: inv.subtotal, tax: inv.tax, plan: plan(inv, body)};
      }
      case 'load': {
        const s = ctx.sheets.find(x => x.book === body.book && x.sheet === body.sheet);
        return s ? {form: invToForm(s, ctx)} : {error: 'シートが見つかりません'};
      }
      case 'create': return create(body);
      case 'audit': return audit();
      case 'open': return {ok: false, error: 'デモ版ではファイルを開きません。'};
      default: return {error: 'not found'};
    }
  }

  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const m = /(?:^|\/)api\/(\w+)/.exec(url);
    if (!m) return realFetch(input, init);
    const method = (init && init.method) || 'GET';
    const body = init && init.body ? JSON.parse(init.body) : {};
    if (m[1] === 'create') await new Promise(r => setTimeout(r, 900));   // 作っている感じを少しだけ
    const obj = clone(route(m[1], method, body));
    return new Response(JSON.stringify(obj), {status: 200, headers: {'Content-Type': 'application/json; charset=utf-8'}});
  };

  // ------------------------------------------------------------ 請求書の見本（PDFの代わりにHTMLで見せる）
  function paper(rec) {
    const rows = rec.rows || [];
    const n = Math.max(10, rows.length);
    let body = '';
    for (let i = 0; i < n; i++) {
      const r = rows[i];
      body += r
        ? `<tr><td>${esc(r.name)}</td><td class="r">${esc(qtyText(isNum(r.qty) ? r.qty : 1))}</td><td class="c">${esc(r.unit)}</td><td class="r">${r.price == null ? '' : yen(r.price)}</td><td class="r">${r.amount == null ? '' : yen(r.amount)}</td></tr>`
        : '<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>';
    }
    const iss = (rec.issuer || []).map((s, i) => i === 0 ? `<b>${esc(s)}</b>` : esc(s)).join('<br>');
    return `<div class="paper">
      <div class="p-stamp">見本</div>
      <div class="p-title">${esc(rec.title)}</div>
      <div class="p-head">
        <div class="p-to">${esc(rec.to)}</div>
        <table class="p-meta"><tr><th>No</th><td>${esc(rec.no ?? '')}</td></tr><tr><th>請求日</th><td>${esc(fmtDate(rec.date))}</td></tr></table>
      </div>
      <div class="p-body">
        <div class="p-left">
          <p class="p-greet">${esc(rec.greeting)}</p>
          <table class="p-kv">
            <tr><th>件名</th><td>${esc(rec.subject)}</td></tr>
            <tr><th>支払期限</th><td>${esc(fmtDate(rec.due))}</td></tr>
            <tr><th>振込先</th><td>${esc(rec.bank)}<br>${esc(rec.holder)}</td></tr>
          </table>
        </div>
        <div class="p-issuer">${iss}</div>
      </div>
      <div class="p-total"><span>合計</span><b>${yen(rec.header_total)}円</b><small>（税込）</small></div>
      <table class="p-rows">
        <colgroup><col style="width:49%"><col style="width:9%"><col style="width:8%"><col style="width:15%"><col style="width:19%"></colgroup>
        <thead><tr><th>摘要</th><th>数量</th><th>単位</th><th>単価</th><th>金額</th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot>
          <tr><td colspan="3" class="nb"></td><th>小計</th><td class="r">${yen(rec.subtotal)}</td></tr>
          <tr><td colspan="3" class="nb"></td><th>内税</th><td class="r">${yen(rec.tax)}</td></tr>
          <tr><td colspan="3" class="nb"></td><th>合計</th><td class="r">${yen(rec.total)}</td></tr>
        </tfoot>
      </table>
      <div class="p-note"><div class="p-note-h">備考</div><div>${rec.note ? esc(rec.note) : '&nbsp;'}</div></div>
    </div>`;
  }

  seed();
  window.DEMO = {
    paper,
    pdf: path => { const x = DB.pdfs.find(p => p.file === path); return x ? clone(x) : null; },
  };
})();
