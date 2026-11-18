/* demo-data.js — デモ用の見本データ
 * 登場するお客様・会社・住所・電話番号・金額はすべて架空です。
 * 日付は「開いた日」から逆算して作るので、いつ開いても
 * 新規／中期／長期／取引まだ がそろって見えます。
 */
(function () {
  "use strict";

  /* ---------- 日付の小道具 ---------- */
  function pad(n) { return ("0" + n).slice(-2); }
  function base() { var d = new Date(); d.setHours(12, 0, 0, 0); return d; }
  function fmt(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function ago(days) { var d = base(); d.setDate(d.getDate() - days); return fmt(d); }
  function after(days) { return ago(-days); }
  function yearsAgo(y, extraDays) {
    var d = base(); d.setFullYear(d.getFullYear() - y); d.setDate(d.getDate() - (extraDays || 0)); return fmt(d);
  }
  function monthShift(m) { var d = base(); d.setDate(1); d.setMonth(d.getMonth() + m); return d; }
  function ym(monthsBack) { var d = monthShift(-monthsBack); return d.getFullYear() + "/" + (d.getMonth() + 1); }
  function month(monthsAhead) { var d = monthShift(monthsAhead); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function periodFrom(dateStr) {
    if (!dateStr) return "";
    var y = (Date.now() - new Date(dateStr).getTime()) / (365.25 * 24 * 3600 * 1000);
    return y < 1 ? "新規" : y < 5 ? "中期" : "長期";
  }

  /* ---------- 見本写真（インラインSVG。実際の写真ではありません） ---------- */
  /* 文字は下の中央に（一覧の正方形サムネで左右が切れても読めるように） */
  function label(text) {
    var w = 24 + text.length * 14;
    return '<rect x="' + (200 - w / 2) + '" y="262" rx="11" width="' + w + '" height="26" fill="#000" fill-opacity=".5"/>' +
      '<text x="200" y="280" text-anchor="middle" font-size="14" font-weight="700" fill="#fff" font-family="sans-serif">' + text + '</text>';
  }
  function wrap(body, text) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="800" height="600">' + body + label(text) + '</svg>';
  }
  var DRAW = {
    /* ハウス外観 */
    house: function () {
      var ribs = "";
      for (var x = 56; x <= 300; x += 27) ribs += '<line x1="' + x + '" y1="126" x2="' + x + '" y2="236"/>';
      return '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9d6e6"/><stop offset="1" stop-color="#eaf2ea"/></linearGradient>' +
        '<linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".95"/><stop offset="1" stop-color="#d9e5e8" stop-opacity=".92"/></linearGradient></defs>' +
        '<rect width="400" height="300" fill="url(#s)"/>' +
        '<path d="M0 188 Q110 166 230 180 T400 172 V300 H0 Z" fill="#a8c389"/>' +
        '<path d="M214 198 V152 Q214 130 238 128 H370 Q394 130 394 152 V198 Z" fill="url(#f)" stroke="#b6c4c8" stroke-width="1.5"/>' +
        '<path d="M18 236 V160 Q18 128 56 125 H300 Q338 128 338 160 V236 Z" fill="url(#f)" stroke="#a6b6bb" stroke-width="2"/>' +
        '<g stroke="#c4d1d5" stroke-width="2">' + ribs + '</g>' +
        '<rect x="20" y="204" width="316" height="32" fill="#cfdde1" fill-opacity=".55"/>' +
        '<rect y="236" width="400" height="64" fill="#86a565"/>' +
        '<path d="M0 262 H400" stroke="#769556" stroke-width="3"/>';
    },
    /* ハウスの中 */
    inside: function () {
      var g = "";
      for (var k = 0; k < 6; k++) {
        var s = 1 - k * 0.16, W = 205 * s, top = 160 - 150 * s, mid = 160 - 60 * s, bot = 160 + 150 * s;
        g += '<path d="M' + (200 - W) + ' ' + bot + ' L' + (200 - W) + ' ' + mid + ' Q' + (200 - W) + ' ' + top + ' 200 ' + top +
          ' Q' + (200 + W) + ' ' + top + ' ' + (200 + W) + ' ' + mid + ' L' + (200 + W) + ' ' + bot + '" fill="none" stroke="#b9c8c3" stroke-width="' + (3.4 * s).toFixed(1) + '"/>';
      }
      return '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f9f3"/><stop offset="1" stop-color="#dde8db"/></linearGradient></defs>' +
        '<rect width="400" height="300" fill="url(#s)"/>' + g +
        '<path d="M140 300 L196 166 H204 L260 300 Z" fill="#c9b48e"/>' +
        '<path d="M0 300 L188 166 H195 L132 300 Z" fill="#6f9a52"/>' +
        '<path d="M268 300 L205 166 H212 L400 300 Z" fill="#6f9a52"/>' +
        '<g fill="#5b8642"><circle cx="70" cy="262" r="14"/><circle cx="112" cy="232" r="11"/><circle cx="146" cy="206" r="8"/>' +
        '<circle cx="330" cy="262" r="14"/><circle cx="288" cy="232" r="11"/><circle cx="254" cy="206" r="8"/></g>';
    },
    /* 作物（トマト） */
    plant: function () {
      return '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d4e5c6"/><stop offset="1" stop-color="#9dbd88"/></linearGradient></defs>' +
        '<rect width="400" height="300" fill="url(#s)"/>' +
        '<line x1="232" y1="0" x2="232" y2="300" stroke="#efe9d6" stroke-width="2"/>' +
        '<path d="M214 300 C206 230 226 170 212 110 S222 40 216 0" fill="none" stroke="#557a3a" stroke-width="7"/>' +
        '<g fill="#6a974c"><ellipse cx="160" cy="92" rx="52" ry="20" transform="rotate(-18 160 92)"/>' +
        '<ellipse cx="282" cy="150" rx="56" ry="20" transform="rotate(16 282 150)"/>' +
        '<ellipse cx="150" cy="210" rx="50" ry="18" transform="rotate(14 150 210)"/></g>' +
        '<g fill="#5a8540"><ellipse cx="276" cy="58" rx="44" ry="16" transform="rotate(-10 276 58)"/>' +
        '<ellipse cx="290" cy="250" rx="46" ry="17" transform="rotate(-14 290 250)"/></g>' +
        '<g><circle cx="190" cy="150" r="27" fill="#d9472f"/><circle cx="238" cy="190" r="24" fill="#cf3f2a"/>' +
        '<circle cx="196" cy="208" r="22" fill="#e0603f"/><circle cx="244" cy="128" r="20" fill="#9cc463"/></g>' +
        '<g fill="#fff" fill-opacity=".35"><circle cx="181" cy="140" r="7"/><circle cx="230" cy="181" r="6"/><circle cx="189" cy="200" r="5"/></g>';
    },
    /* 畑・圃場 */
    field: function () {
      var rows = "";
      for (var i = -5; i <= 5; i++) {
        var bx = 200 + i * 78, tx = 200 + i * 9;
        rows += '<path d="M' + (bx - 26) + ' 300 L' + (tx - 2.5) + ' 150 L' + (tx + 2.5) + ' 150 L' + (bx + 26) + ' 300 Z"/>';
      }
      return '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b3d3e6"/><stop offset="1" stop-color="#e8f1ee"/></linearGradient></defs>' +
        '<rect width="400" height="300" fill="url(#s)"/>' +
        '<path d="M0 150 Q90 118 180 136 T400 128 V160 H0 Z" fill="#9fb98a"/>' +
        '<rect y="150" width="400" height="150" fill="#b49a74"/>' +
        '<g fill="#6f9a52">' + rows + '</g>' +
        '<g fill="#f4f8f9" stroke="#b7c5c9"><path d="M40 150 V140 Q40 132 50 132 H96 Q106 132 106 140 V150 Z"/>' +
        '<path d="M300 150 V142 Q300 136 308 136 H350 Q358 136 358 142 V150 Z"/></g>';
    }
  };
  var CAPTION = { house: "見本写真｜ハウス外観", inside: "見本写真｜ハウスの中", plant: "見本写真｜作物", field: "見本写真｜畑" };
  function svgDataUrl(kind) {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(wrap(DRAW[kind](), CAPTION[kind]));
  }
  /* 見本写真の fileId は "sample_<種類>_<連番>" */
  function samplePhotoUrl(fileId) {
    var m = /^sample_([a-z]+)_/.exec(String(fileId || ""));
    return m && DRAW[m[1]] ? svgDataUrl(m[1]) : null;
  }

  /* ---------- 顧客の雛形 ---------- */
  var EMPTY = {
    name: "", kana: "", type: "個人", rank: "", area: "", rep: "", phone: "", email: "",
    crops: [], filmMaker: "", filmType: "", filmSpec: "", filmReplace: "", houses: [], nextFollow: "",
    lastQuote: "", history: [], memo: "", dealPeriod: "", dealType: "", purchases: [], quoteFiles: [],
    fields: [], homeAddress: "", photos: [], links: [], requests: [], consent: {},
    firstName: "", repName: "", homePhone: "", fax: "", houseWidth: "", houseDepth: "", houseModel: "",
    houseCount: "", houseKind: "", firstDeal: "", lastVisit: "", homeGeo: ""
  };
  function cust(o) {
    var r = JSON.parse(JSON.stringify(EMPTY));
    Object.keys(o).forEach(function (k) { r[k] = o[k]; });
    if (r.firstDeal) r.dealPeriod = periodFrom(r.firstDeal);
    var t = Date.now();
    r.createdAt = t; r.updatedAt = t;
    return r;
  }
  function photo(kind, n, name, date) {
    return { fileId: "sample_" + kind + "_" + n, name: name, mime: "image/jpeg", kind: "image", url: "", date: date };
  }
  function req(id, date, text, status) { return { id: id, date: date, text: text, status: status }; }
  function visit(date, note) { return { date: date, type: "訪問", note: note }; }
  function tel(date, note) { return { date: date, type: "電話", note: note }; }
  function other(date, note) { return { date: date, type: "その他", note: note }; }
  function buy(monthsBack, item, amount) { return { date: ym(monthsBack), item: item, amount: amount }; }

  function build() {
    var customers = [
      cust({
        id: "c01", name: "見本", firstName: "太郎", kana: "ミホン タロウ", type: "個人", rank: "A",
        dealType: "JA有", firstDeal: yearsAgo(8, 40), area: "見本市 北地区", rep: "佐藤",
        phone: "090-0000-0101", homePhone: "0000-11-0101", fax: "0000-11-0102",
        crops: ["トマト", "きゅうり"],
        houseWidth: "6m", houseDepth: "45m", houseModel: "丸屋根 S-60（見本）", houseCount: "4", houseKind: "パイプハウス",
        filmMaker: "見本化成", filmType: "農PO 梨地", filmSpec: "0.15mm × 8.5m", filmReplace: month(5),
        nextFollow: after(10), lastVisit: ago(6),
        homeAddress: "見本市北町1-2-3", homeGeo: "33.6012,133.6655",
        fields: ["33.6031,133.6681", "33.5987,133.6702", "見本市北町 字下田 512付近"],
        purchases: [buy(14, "農PO 梨地 0.15mm 4本", "112000"), buy(7, "防虫ネット 0.4mm目合い 2巻", "38000"), buy(2, "マイカ線・スプリング一式", "9600")],
        history: [
          visit(ago(400), "初回訪問。トマト4棟。来年の張替えを相談したいとのこと"),
          visit(ago(210), "張替えの見積を提出（農PO 4本）"),
          tel(ago(95), "防虫ネットの在庫確認。翌週に納品"),
          visit(ago(40), "きゅうりの定植が終わった。来春のビニールの見積が欲しいとのこと"),
          visit(ago(6), "台風後の点検。北側のハウスでサイドのビニールが一部裂けていた")
        ],
        requests: [
          req("r0101", ago(6), "台風でサイドのビニールが一部裂けた。補修テープを次回持ってきてほしい", "未対応"),
          req("r0102", ago(40), "冬の暖房費が高い。保温カーテンの見積が欲しい", "提案済"),
          req("r0103", ago(95), "パイプのジョイント部品を20個", "解決")
        ],
        links: [{ label: "直売所のHP（見本）", url: "https://example.com/", date: ago(40) }],
        photos: [photo("house", 1, "ハウス外観.jpg", ago(40)), photo("plant", 2, "トマト.jpg", ago(6))],
        consent: { photo: true, share: true, date: ago(40) },
        memo: "朝7時〜8時は畑にいる。値引きより納期を重視。息子さんが後を継ぐ予定。"
      }),
      cust({
        id: "c02", name: "見本", firstName: "花子", kana: "ミホン ハナコ", type: "個人", rank: "B",
        dealType: "JA無", firstDeal: yearsAgo(2, 95), area: "見本市 東地区", rep: "鈴木",
        phone: "090-0000-0202", crops: ["いちご"],
        houseWidth: "5.4m", houseDepth: "40m", houseCount: "3", houseKind: "パイプハウス（高設栽培）",
        filmMaker: "サンプル樹脂", filmType: "農ビ 一般", filmSpec: "0.1mm", filmReplace: month(10),
        nextFollow: after(14), lastVisit: ago(28),
        homeAddress: "見本市東町4-5-6", homeGeo: "33.5893,133.7121", fields: ["33.5901,133.7148"],
        purchases: [buy(11, "農ビ 一般 0.1mm 3本", "69000")],
        history: [
          visit(ago(300), "いちご高設3棟。育苗用の遮光ネットを検討中"),
          visit(ago(28), "遮光ネットのサンプルを2種類お渡しした")
        ],
        requests: [req("r0201", ago(28), "育苗用の遮光ネット、遮光率40%と50%で迷っている", "提案済")],
        consent: { photo: true, share: false, date: ago(28) }
      }),
      cust({
        id: "c03", name: "サンプル農園 株式会社", repName: "見本 一郎", kana: "サンプルノウエン", type: "法人", rank: "A",
        dealType: "両方", firstDeal: yearsAgo(3, 150), area: "サンプル町", rep: "佐藤",
        phone: "090-0000-0303", fax: "0000-22-0304", email: "info@example.com",
        crops: ["トマト", "ミニトマト", "ベビーリーフ"],
        houseWidth: "9m（3連棟）", houseDepth: "54m", houseModel: "連棟 R-90（見本）", houseCount: "12", houseKind: "連棟ハウス（鉄骨）",
        filmMaker: "架空ポリマー", filmType: "フッ素フィルム 透明", filmSpec: "0.06mm", filmReplace: month(28),
        nextFollow: after(4), lastVisit: ago(12),
        homeAddress: "サンプル町中原100（事務所）", homeGeo: "33.5781,133.6512",
        fields: ["33.5795,133.6538", "33.5769,133.6489"],
        purchases: [buy(20, "保温カーテン 一式（4棟分）", "460000"), buy(9, "灌水チューブ 10巻", "65000"), buy(3, "誘引クリップ 5000個", "27500")],
        history: [
          visit(ago(380), "事務所で社長と面談。12棟のうち4棟の保温カーテンを更新したい"),
          other(ago(200), "展示会で新しい灌水資材を紹介"),
          visit(ago(90), "パートさん向けの張替え作業の段取りを説明"),
          visit(ago(12), "灌水チューブの目詰まりの相談を受けた")
        ],
        requests: [
          req("r0301", ago(12), "灌水チューブの目詰まりが多い。フィルターを相談したい", "未対応"),
          req("r0302", ago(90), "パートさん向けに、張替え作業の段取り表が欲しい", "解決")
        ],
        links: [
          { label: "会社のHP（見本）", url: "https://example.com/", date: ago(200) },
          { label: "Instagram（見本）", url: "https://example.org/", date: ago(90) }
        ],
        photos: [photo("house", 3, "連棟ハウス.jpg", ago(380)), photo("inside", 4, "ハウス内.jpg", ago(90)), photo("field", 5, "露地の畑.jpg", ago(12))],
        consent: { photo: true, share: true, date: ago(380) },
        memo: "発注は事務の方（午前中）へFAX。社長は月末が忙しい。"
      }),
      cust({
        id: "c04", name: "例田", firstName: "次郎", kana: "レイダ ジロウ", type: "個人", rank: "C",
        dealType: "JA有", area: "例村", rep: "高橋", phone: "090-0000-0404", crops: ["なす"],
        houseWidth: "5.4m", houseCount: "2", houseKind: "パイプハウス",
        nextFollow: after(12), lastVisit: ago(18),
        homeAddress: "例村上原7-8",
        history: [visit(ago(18), "飛び込みで初訪問。今はJA経由で資材を購入している。話は聞いてくれた")],
        requests: [req("r0401", ago(18), "マルチ（黒）を来月まとめて欲しい。価格次第で検討", "未対応")]
      }),
      cust({
        id: "c05", name: "仮野", firstName: "三郎", kana: "カリノ サブロウ", type: "個人", rank: "B",
        dealType: "JA無", firstDeal: ago(125), area: "見本市 南地区", rep: "鈴木",
        phone: "090-0000-0505", homePhone: "0000-33-0505", crops: ["ほうれん草", "小松菜"],
        houseWidth: "5.4m", houseDepth: "36m", houseModel: "丸屋根 S-54（見本）", houseCount: "6", houseKind: "パイプハウス（雨よけ）",
        filmMaker: "見本化成", filmType: "農PO 透明", filmSpec: "0.1mm", filmReplace: month(2),
        nextFollow: after(7), lastVisit: ago(21),
        homeAddress: "見本市南町2-14", homeGeo: "33.5712,133.6915",
        fields: ["33.5728,133.6940", "33.5699,133.6962"],
        purchases: [buy(4, "農PO 透明 0.1mm 6本", "126000")],
        history: [
          visit(ago(125), "張替えのご注文。初めての取引"),
          tel(ago(70), "施工の日程を調整"),
          visit(ago(21), "張替え後の確認。次は防虫ネットも見たいとのこと")
        ],
        requests: [req("r0501", ago(21), "防虫ネットを張り替えたい。目合い0.4mmで安い所を探している", "未対応")]
      }),
      cust({
        id: "c06", name: "試作", firstName: "さくら", kana: "シサク サクラ", type: "個人", rank: "",
        dealType: "両方", firstDeal: yearsAgo(12, 10), area: "サンプル町", rep: "高橋",
        phone: "090-0000-0606", homePhone: "0000-22-0606", crops: ["メロン"],
        houseWidth: "7.2m", houseDepth: "50m", houseModel: "丸屋根 S-72（見本）", houseCount: "5", houseKind: "パイプハウス",
        filmMaker: "サンプル樹脂", filmType: "農PO 梨地", filmSpec: "0.15mm", filmReplace: month(14),
        nextFollow: after(21), lastVisit: ago(33),
        homeAddress: "サンプル町東原8-2", homeGeo: "33.6105,133.7230", fields: ["33.6090,133.7255"],
        purchases: [buy(16, "農PO 梨地 0.15mm 5本", "150000")],
        history: [
          visit(ago(500), "メロン5棟。夏の高温対策を相談された"),
          visit(ago(160), "遮熱資材のカタログをお渡し"),
          visit(ago(33), "張替えの人手が足りないとのこと。施工を頼めるか検討")
        ],
        requests: [req("r0601", ago(33), "張替えの人手が足りない。施工まで頼めるか知りたい", "提案済")],
        links: [{ label: "ネットショップ（見本）", url: "https://example.com/", date: ago(160) }],
        photos: [photo("house", 6, "メロンのハウス.jpg", ago(160))],
        consent: { photo: true, share: true, date: ago(160) }
      }),
      cust({
        id: "c07", name: "架空ファーム 合同会社", repName: "架空 健", kana: "カクウファーム", type: "法人", rank: "B",
        dealType: "JA無", firstDeal: ago(62), area: "例村", rep: "佐藤",
        phone: "090-0000-0707", email: "contact@example.com", crops: ["いちご（観光農園）"],
        houseWidth: "6m", houseDepth: "60m", houseCount: "8", houseKind: "パイプハウス（高設栽培）",
        filmMaker: "架空ポリマー", filmType: "農PO 梨地", filmSpec: "0.15mm", filmReplace: month(20),
        nextFollow: after(3), lastVisit: ago(30),
        homeAddress: "例村下原3-1", homeGeo: "33.6180,133.6590", fields: ["33.6168,133.6612"],
        purchases: [buy(1, "高設ベンチ用 防草シート 4巻", "48000")],
        history: [
          visit(ago(62), "新規開拓。観光いちご園を来年拡張する予定"),
          visit(ago(30), "ハウス2棟分の見積を提出")
        ],
        requests: [req("r0701", ago(30), "観光のお客さん向けに、ハウス内の通路マットを探している", "未対応")],
        links: [{ label: "観光農園のHP（見本）", url: "https://example.com/", date: ago(62) }],
        consent: { photo: false, share: true, date: ago(62) }
      }),
      cust({
        id: "c08", name: "模擬", firstName: "五郎", kana: "モギ ゴロウ", type: "個人", rank: "A",
        dealType: "JA有", firstDeal: yearsAgo(6, 20), area: "見本市 北地区", rep: "佐藤",
        phone: "090-0000-0808", homePhone: "0000-11-0808", crops: ["きゅうり"],
        houseWidth: "6m", houseDepth: "48m", houseModel: "丸屋根 S-60（見本）", houseCount: "7", houseKind: "パイプハウス",
        filmMaker: "見本化成", filmType: "農PO 梨地", filmSpec: "0.15mm", filmReplace: month(1),
        nextFollow: after(2), lastVisit: ago(9),
        homeAddress: "見本市北町6-1", homeGeo: "33.6068,133.6798",
        fields: ["33.6052,133.6821", "33.6081,133.6840"],
        purchases: [buy(26, "農PO 梨地 0.15mm 7本", "196000"), buy(5, "暖房機用 ダクト 3本", "21000")],
        history: [
          visit(ago(330), "7棟の張替えを来年にまとめて行う予定"),
          visit(ago(50), "暖房機の点検業者を紹介"),
          visit(ago(9), "サイドの巻き上げが重いとの相談")
        ],
        requests: [
          req("r0801", ago(9), "ハウスのサイドの巻き上げが重い。電動にできるか知りたい", "未対応"),
          req("r0802", ago(50), "暖房機の点検業者を紹介してほしい", "解決")
        ],
        photos: [photo("inside", 7, "きゅうりのハウス内.jpg", ago(50))],
        consent: { photo: true, share: false, date: ago(50) }
      }),
      cust({
        id: "c09", name: "雛形", firstName: "和子", kana: "ヒナガタ カズコ", type: "個人", rank: "",
        dealType: "JA有", area: "見本市 東地区", rep: "鈴木", homePhone: "0000-44-0909",
        crops: ["カーネーション"], nextFollow: after(5),
        memo: "見本 花子さんからの紹介。午後のほうが話しやすい。"
      }),
      cust({
        id: "c10", name: "手本", firstName: "健太", kana: "テホン ケンタ", type: "個人", rank: "B",
        dealType: "両方", firstDeal: yearsAgo(1, 240), area: "見本市 南地区", rep: "高橋",
        phone: "090-0000-1010", crops: ["ピーマン", "ししとう"],
        houseWidth: "6m", houseDepth: "40m", houseCount: "4", houseKind: "パイプハウス",
        filmMaker: "サンプル樹脂", filmType: "農ビ 一般", filmSpec: "0.1mm", filmReplace: month(-1),
        nextFollow: ago(3), lastVisit: ago(45),
        homeAddress: "見本市南町9-9", homeGeo: "33.5745,133.7044", fields: ["33.5760,133.7071"],
        purchases: [buy(18, "農ビ 一般 0.1mm 4本", "88000")],
        history: [
          visit(ago(600), "ピーマン4棟。張替えのご注文"),
          visit(ago(45), "張替え目安を過ぎているので見積を相談")
        ]
      }),
      cust({
        id: "c11", name: "仮山", firstName: "学", kana: "カリヤマ マナブ", type: "個人", rank: "C",
        dealType: "JA無", dealPeriod: "中期", area: "サンプル町", rep: "鈴木",
        phone: "090-0000-1111", crops: ["ねぎ"],
        houseCount: "2", houseKind: "パイプハウス（育苗用）",
        homeAddress: "サンプル町西原4-20",
        history: [tel(ago(150), "育苗用の培土の問い合わせ")],
        memo: "最初の取引日は不明（前任者から引き継ぎ）。"
      }),
      cust({
        id: "c12", name: "試験", firstName: "みどり", kana: "シケン ミドリ", type: "個人", rank: "B",
        dealType: "JA有", firstDeal: ago(270), area: "見本市 東地区", rep: "高橋",
        phone: "090-0000-1212", crops: ["トマト"],
        houseWidth: "7.2m", houseDepth: "45m", houseCount: "3", houseKind: "パイプハウス",
        filmMaker: "見本化成", filmType: "農PO 梨地", filmSpec: "0.15mm", filmReplace: month(6),
        nextFollow: after(9), lastVisit: ago(3),
        homeAddress: "見本市東町12-3", homeGeo: "33.5948,133.7187", fields: ["33.5962,133.7209"],
        history: [
          tel(ago(270), "就農の相談。ハウス資材一式のご注文"),
          visit(ago(3), "就農2年目。土壌のことで困っているとのこと")
        ],
        requests: [req("r1201", ago(3), "就農2年目。土壌診断をどこに頼めばいいか知りたい", "未対応")],
        consent: { photo: false, share: true, date: ago(3) }
      }),
      cust({
        id: "c13", name: "デモ青果 株式会社", repName: "例田 誠", kana: "デモセイカ", type: "法人", rank: "C",
        dealType: "JA無", area: "例村", rep: "佐藤",
        homePhone: "0000-55-1313", fax: "0000-55-1314", crops: ["キャベツ", "ブロッコリー"],
        nextFollow: after(3), lastVisit: ago(45),
        homeAddress: "例村中央5-5（集荷場）",
        history: [visit(ago(45), "集荷場にあいさつ。契約農家さん向けの資材をまとめて買う可能性あり")],
        requests: [req("r1301", ago(45), "契約農家20軒分のマルチ・トンネル資材をまとめて見積したい", "未対応")]
      }),
      cust({
        id: "c14", name: "見本", firstName: "正", kana: "ミホン タダシ", type: "個人", rank: "A",
        dealType: "両方", firstDeal: yearsAgo(15, 60), area: "例村", rep: "高橋",
        phone: "090-0000-1414", homePhone: "0000-55-1414", crops: ["アスパラガス"],
        houseWidth: "5.4m", houseDepth: "50m", houseModel: "丸屋根 S-54（見本）", houseCount: "10", houseKind: "パイプハウス（雨よけ）",
        filmMaker: "架空ポリマー", filmType: "農PO 透明", filmSpec: "0.1mm", filmReplace: month(3),
        nextFollow: after(30), lastVisit: ago(15),
        homeAddress: "例村上原1-1", homeGeo: "33.6142,133.6702",
        fields: ["33.6129,133.6725", "33.6155,133.6748", "33.6118,133.6760"],
        purchases: [buy(30, "農PO 透明 0.1mm 10本", "180000"), buy(8, "灌水タイマー 1台", "32000")],
        history: [
          visit(ago(720), "アスパラ10棟。雨よけハウスの張替えをご注文"),
          visit(ago(400), "灌水の自動化を相談"),
          tel(ago(240), "灌水タイマーの納期確認"),
          visit(ago(70), "灌水タイマーの後継機を紹介"),
          visit(ago(15), "来季の張替え本数を確認。3月に10棟分")
        ],
        requests: [req("r1401", ago(70), "灌水タイマーが古い。後継機を教えてほしい", "解決")],
        links: [{ label: "地域の直売所 掲載ページ（見本）", url: "https://example.org/", date: ago(70) }],
        photos: [photo("field", 8, "アスパラの畑.jpg", ago(70))],
        consent: { photo: true, share: true, date: ago(400) }
      })
    ];

    /* 写真サムネ（「写真サムネ」シートの代わり）: [fileId, customerId, thumb, date] */
    var thumbs = [];
    customers.forEach(function (c) {
      c.photos.forEach(function (p) { thumbs.push([p.fileId, c.id, samplePhotoUrl(p.fileId), p.date]); });
    });
    return { customers: customers, thumbs: thumbs };
  }

  window.DEMO_CRM_SEED = build;
  window.DEMO_CRM_SAMPLE_PHOTO = samplePhotoUrl;
})();
