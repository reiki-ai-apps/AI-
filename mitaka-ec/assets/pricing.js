// 三高産業 ハウスEC プロトタイプ: パイプハウスの数量計算と概算見積り
// ※ ここにある単価はすべて「仮単価」です。実際の販売価格ではありません。
//    正式運用時は UNIT / OPTIONS の値を自社の単価表に差し替えてください。

export const PRICING_VERSION = "仮単価 2026-09 版";
export const TAX_RATE = 0.10;

export const OPTIONS = {
  spans: [3.6, 4.5, 5.4, 6.0, 7.2],
  pitches: [0.45, 0.5, 0.6],
  pipes: [
    { d: 19.1, label: "φ19.1mm(小型・簡易)" },
    { d: 22.2, label: "φ22.2mm(標準)" },
    { d: 25.4, label: "φ25.4mm(標準・強化)" },
    { d: 31.8, label: "φ31.8mm(大型・耐雪)" }
  ],
  films: [
    { id: "novi010", label: "農ビ 0.1mm(単年張り)", years: "1〜2年", perSqm: 260, tint: 0xbfe3ff, opacity: 0.32 },
    { id: "po015", label: "農PO 0.15mm(3年張り)", years: "3年程度", perSqm: 380, tint: 0xe4f1ff, opacity: 0.38 },
    { id: "po_multi", label: "多年張りPO(5年以上)", years: "5年以上", perSqm: 620, tint: 0xf1f6ff, opacity: 0.42 },
    { id: "po_diffuse", label: "散乱光PO(梨地)", years: "3〜5年", perSqm: 450, tint: 0xf4f4ee, opacity: 0.55 }
  ],
  sideVents: [
    { id: "none", label: "なし" },
    { id: "one", label: "片側(巻き上げ)" },
    { id: "both", label: "両側(巻き上げ)" }
  ],
  drives: [
    { id: "manual", label: "手動" },
    { id: "motor", label: "電動" }
  ],
  curtains: [
    { id: "none", label: "なし" },
    { id: "manual", label: "手動開閉" },
    { id: "motor", label: "電動開閉" }
  ],
  irrigations: [
    { id: "none", label: "なし" },
    { id: "drip", label: "点滴チューブ" },
    { id: "mist", label: "ミスト・スプリンクラー" }
  ],
  installs: [
    { id: "full", label: "施工込み(当社施工)" },
    { id: "materials", label: "資材のみ(お客様施工)" }
  ],
  regions: [
    { id: "gunma", label: "群馬県内" },
    { id: "neighbor", label: "隣接県(栃木・埼玉・長野・新潟など)" },
    { id: "other", label: "その他の地域(別途お見積り)" }
  ]
};

// 仮単価(税抜・円)
export const UNIT = {
  pipePerM: { 19.1: 260, 22.2: 330, 25.4: 420, 31.8: 640 },
  fittingPerArch: 300,          // アーチ1本あたりの金具(クロスバンド・ジョイント)
  fittingPerPurlinCross: 120,   // アーチ×母屋の交点1か所あたり
  anchorEach: 900,              // らせん杭 1本
  railPerM: 380,                // ビニペット+スプリング 1m
  doorEach: 42000,              // 片引きドアセット(W1.8×H1.9) 1か所
  sideVentBase: { manual: 18000, motor: 95000 },  // 巻上機 1側あたり
  sideVentPerM: 1300,           // 巻き上げパイプ・ガイド 1m
  roofVentBase: 65000,          // 天窓開閉装置
  roofVentPerM: 4800,           // 天窓 1m
  curtainPerSqm: 320,           // 内張カーテン資材 1m²
  curtainDrive: { manual: 45000, motor: 160000 },
  insectNetPerSqm: 180,         // 防虫ネット 1m²
  dripPerM: 90,                 // 点滴チューブ 1m
  dripHeader: 28000,            // 点滴ヘッダー・フィルター一式
  mistPerSqm: 420,              // ミスト配管 1m²
  mistHeader: 35000,
  snowFittingRate: 0.15,        // 耐雪補強の金具割合
  installPerSqm: 2600,          // 施工費 1m²
  installBase: 35000,           // 施工基本料(出張・機材)
  delivery: { gunma: 18000, neighbor: 35000, other: 0 }
};

export function defaultParams() {
  return {
    span: 5.4, length: 30, eave: 1.6, ridge: 3.0, pitch: 0.5, pipe: 25.4,
    film: "po015", doors: 2, sideVent: "both", ventDrive: "manual",
    roofVent: false, curtain: "none", insectNet: true, irrigation: "none",
    snow: false, install: "full", region: "gunma"
  };
}

// 棟高の許容範囲(肩高と間口から決める)
export function ridgeRange(span, eave) {
  const half = span / 2;
  return { min: round1(eave + half * 0.3), max: round1(eave + half * 0.75), suggested: round1(eave + half * 0.52) };
}

export function normalizeParams(raw) {
  const d = defaultParams();
  const p = { ...d, ...(raw || {}) };
  p.span = pick(OPTIONS.spans, Number(p.span), d.span);
  p.length = clamp(Number(p.length) || d.length, 5, 100);
  p.eave = clamp(round1(Number(p.eave) || d.eave), 1.0, 2.4);
  const rr = ridgeRange(p.span, p.eave);
  p.ridge = clamp(round1(Number(p.ridge) || rr.suggested), rr.min, rr.max);
  p.pitch = pick(OPTIONS.pitches, Number(p.pitch), d.pitch);
  p.pipe = pick(OPTIONS.pipes.map(x => x.d), Number(p.pipe), d.pipe);
  p.film = pickId(OPTIONS.films, p.film, d.film);
  p.doors = [0, 1, 2].includes(Number(p.doors)) ? Number(p.doors) : d.doors;
  p.sideVent = pickId(OPTIONS.sideVents, p.sideVent, d.sideVent);
  p.ventDrive = pickId(OPTIONS.drives, p.ventDrive, d.ventDrive);
  p.roofVent = toBool(p.roofVent);
  p.curtain = pickId(OPTIONS.curtains, p.curtain, d.curtain);
  p.insectNet = toBool(p.insectNet);
  p.irrigation = pickId(OPTIONS.irrigations, p.irrigation, d.irrigation);
  p.snow = toBool(p.snow);
  p.install = pickId(OPTIONS.installs, p.install, d.install);
  p.region = pickId(OPTIONS.regions, p.region, d.region);
  return p;
}

// 形状と数量
export function computeGeometry(p) {
  const W = p.span, L = p.length, He = p.eave, Hr = p.ridge;
  const a = W / 2, b = Math.max(Hr - He, 0.2);
  // 半楕円の弧長(ラマヌジャンの近似)
  const perimeter = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  const arcLen = perimeter / 2;
  const buried = 0.4; // 地中埋め込み(片側)
  const archLen = arcLen + 2 * He + 2 * buried;
  const archCount = Math.floor(L / p.pitch + 1e-6) + 1;
  const purlinRuns = W <= 4.5 ? 3 : W <= 6.0 ? 5 : 7;
  const purlinLen = purlinRuns * L;
  const endFrameLen = 2 * (2 * Hr + 3 * He + W); // 妻面骨組(両端)
  const endWallArea = W * He + Math.PI * a * b / 2;
  const roofSideArea = (arcLen + 2 * He + 0.3) * (L + 1.0);
  const coverArea = (roofSideArea + 2 * endWallArea) * 1.1; // ロス10%
  const floorArea = W * L;
  const volume = endWallArea * L;
  const railLen = 2 * L + 2 * (arcLen + 2 * He) + (p.sideVent === "none" ? 0 : (p.sideVent === "both" ? 2 : 1) * L);
  const ventSides = p.sideVent === "both" ? 2 : p.sideVent === "one" ? 1 : 0;
  const ventOpenHeight = Math.min(He * 0.75, 1.2);
  const insectNetArea = ventSides * L * (ventOpenHeight + 0.3);
  const dripRows = Math.max(2, Math.floor(W / 1.2));
  const snowPosts = p.snow ? Math.ceil(L / 2) + 1 : 0;
  const snowTies = p.snow ? Math.ceil(archCount / 2) : 0;
  return {
    W, L, He, Hr, a, b, arcLen, archLen, archCount, purlinRuns, purlinLen, endFrameLen,
    endWallArea, roofSideArea, coverArea, floorArea, volume, railLen, ventSides, ventOpenHeight,
    insectNetArea, dripRows, snowPosts, snowTies, tsubo: floorArea / 3.3058
  };
}

// 概算見積り
export function estimate(rawParams) {
  const p = normalizeParams(rawParams);
  const g = computeGeometry(p);
  const film = OPTIONS.films.find(f => f.id === p.film);
  const pipePrice = UNIT.pipePerM[p.pipe];
  const lines = [];
  const add = (key, label, detail, qty, unit, unitPrice, opts = {}) => {
    const amount = opts.amount != null ? opts.amount : Math.round(qty * unitPrice);
    lines.push({ key, label, detail, qty: roundQty(qty), unit, unitPrice: Math.round(unitPrice), amount, note: opts.note || "" });
  };

  // 骨組
  const archPipeLen = g.archCount * g.archLen;
  add("arch", "アーチパイプ", `φ${p.pipe}mm ×${g.archCount}本(1本 約${g.archLen.toFixed(1)}m、間隔${(p.pitch * 100).toFixed(0)}cm)`, archPipeLen, "m", pipePrice);
  add("purlin", "母屋・直管パイプ", `${g.purlinRuns}通り × ${g.L}m`, g.purlinLen, "m", pipePrice * 0.95);
  add("endframe", "妻面骨組パイプ", "両妻面のドア枠・支柱", g.endFrameLen, "m", pipePrice);
  add("fitting", "接合金具一式", "クロスバンド・ジョイント・妻面金具", 1, "式", 0, {
    amount: Math.round(g.archCount * UNIT.fittingPerArch + g.archCount * g.purlinRuns * UNIT.fittingPerPurlinCross + 8000)
  });
  add("anchor", "らせん杭(基礎アンカー)", "アーチ脚部 各1本", g.archCount * 2, "本", UNIT.anchorEach);
  if (p.snow) {
    const postLen = g.snowPosts * g.Hr;
    const tieLen = g.snowTies * g.W;
    const base = postLen * UNIT.pipePerM[31.8] + tieLen * pipePrice;
    add("snow", "耐雪補強(中柱・タイバー)", `中柱${g.snowPosts}本、タイバー${g.snowTies}本`, 1, "式", 0, { amount: Math.round(base * (1 + UNIT.snowFittingRate)) });
  }

  // 被覆
  add("film", `被覆材 ${film.label}`, `屋根・側面・妻面(ロス10%込)`, g.coverArea, "m²", film.perSqm);
  add("rail", "被覆材固定金具(ビニペット等)", "地際・妻面・換気部", g.railLen, "m", UNIT.railPerM);
  if (p.doors > 0) add("door", "妻面ドア", `片引きドア W1.8×H1.9 ×${p.doors}か所`, p.doors, "か所", UNIT.doorEach);

  // 換気・環境
  if (g.ventSides > 0) {
    const drive = OPTIONS.drives.find(x => x.id === p.ventDrive).label;
    add("sidevent", `側面巻き上げ換気(${drive})`, `${g.ventSides}側 × ${g.L}m`, 1, "式", 0, {
      amount: Math.round(g.ventSides * (UNIT.sideVentBase[p.ventDrive] + g.L * UNIT.sideVentPerM))
    });
  }
  if (p.roofVent) add("roofvent", "天窓換気", `棟部 ${g.L}m + 開閉装置`, 1, "式", 0, { amount: Math.round(UNIT.roofVentBase + g.L * UNIT.roofVentPerM) });
  if (p.curtain !== "none") {
    const drive = OPTIONS.curtains.find(x => x.id === p.curtain).label;
    const area = g.roofSideArea * 0.75;
    add("curtain", `内張保温カーテン(${drive})`, `約${area.toFixed(0)}m² + 開閉装置`, 1, "式", 0, {
      amount: Math.round(area * UNIT.curtainPerSqm + UNIT.curtainDrive[p.curtain])
    });
  }
  if (p.insectNet && g.insectNetArea > 0) add("net", "防虫ネット(換気部)", `開口部 ${g.insectNetArea.toFixed(0)}m²`, g.insectNetArea, "m²", UNIT.insectNetPerSqm);
  if (p.irrigation === "drip") add("drip", "点滴潅水設備", `${g.dripRows}列 × ${g.L}m + ヘッダー`, 1, "式", 0, { amount: Math.round(g.dripRows * g.L * UNIT.dripPerM + UNIT.dripHeader) });
  if (p.irrigation === "mist") add("mist", "ミスト・スプリンクラー設備", `床面積 ${g.floorArea.toFixed(0)}m²`, 1, "式", 0, { amount: Math.round(g.floorArea * UNIT.mistPerSqm + UNIT.mistHeader) });

  const materialsSubtotal = lines.reduce((s, l) => s + l.amount, 0);

  // 施工・運搬
  if (p.install === "full") add("install", "施工費(当社施工)", `床面積 ${g.floorArea.toFixed(1)}m² + 基本料`, 1, "式", 0, { amount: Math.round(g.floorArea * UNIT.installPerSqm + UNIT.installBase) });
  const dl = UNIT.delivery[p.region];
  add("delivery", "運搬費", OPTIONS.regions.find(r => r.id === p.region).label, 1, "式", 0, { amount: dl, note: p.region === "other" ? "別途お見積り" : "" });

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const tax = Math.round(subtotal * TAX_RATE);
  const total = subtotal + tax;
  return {
    params: p, geometry: g, film, lines, materialsSubtotal, subtotal, tax, total,
    perSqm: Math.round(subtotal / g.floorArea), perTsubo: Math.round(subtotal / g.tsubo),
    notes: [
      "この金額は仮の単価による概算です。正式なお見積りは現地確認後に提出します。",
      "地盤・積雪・風速条件により、パイプ径や補強内容が変わる場合があります。",
      p.region === "other" ? "群馬県外(隣接県以外)の運搬費・施工費は別途ご相談ください。" : null,
      p.install === "materials" ? "資材のみの場合、組立説明書をお渡しします。施工サポートもご相談ください。" : null
    ].filter(Boolean)
  };
}

// URLクエリ <-> パラメータ
const KEYS = ["span", "length", "eave", "ridge", "pitch", "pipe", "film", "doors", "sideVent", "ventDrive", "roofVent", "curtain", "insectNet", "irrigation", "snow", "install", "region"];
export function encodeParams(p) {
  const sp = new URLSearchParams();
  for (const k of KEYS) sp.set(k, typeof p[k] === "boolean" ? (p[k] ? "1" : "0") : String(p[k]));
  return sp.toString();
}
export function decodeParams(query) {
  const sp = new URLSearchParams(query || "");
  if (![...sp.keys()].some(k => KEYS.includes(k))) return null;
  const raw = {};
  for (const k of KEYS) if (sp.has(k)) raw[k] = sp.get(k);
  return normalizeParams(raw);
}

// 見積依頼用のテキスト
export function summarize(est) {
  const p = est.params, g = est.geometry;
  const label = (list, id) => (list.find(x => x.id === id) || {}).label || id;
  const out = [
    "【3Dシミュレーター内容】",
    `間口 ${p.span}m × 奥行 ${p.length}m(床面積 ${g.floorArea.toFixed(1)}m² / 約${g.tsubo.toFixed(0)}坪)`,
    `肩高 ${p.eave}m / 棟高 ${p.ridge}m / アーチ間隔 ${(p.pitch * 100).toFixed(0)}cm / パイプ φ${p.pipe}mm`,
    `被覆材: ${est.film.label}`,
    `妻面ドア: ${p.doors}か所 / 側面換気: ${label(OPTIONS.sideVents, p.sideVent)}${p.sideVent !== "none" ? "(" + label(OPTIONS.drives, p.ventDrive) + ")" : ""} / 天窓: ${p.roofVent ? "あり" : "なし"}`,
    `内張カーテン: ${label(OPTIONS.curtains, p.curtain)} / 防虫ネット: ${p.insectNet ? "あり" : "なし"} / 潅水: ${label(OPTIONS.irrigations, p.irrigation)}`,
    `耐雪補強: ${p.snow ? "あり" : "なし"} / ${label(OPTIONS.installs, p.install)} / ${label(OPTIONS.regions, p.region)}`,
    `概算合計(税抜): ${yen(est.subtotal)}  税込: ${yen(est.total)}  ※${PRICING_VERSION}`
  ];
  return out.join("\n");
}

export function yen(n) { return "¥" + Math.round(n).toLocaleString("ja-JP"); }

function pick(list, v, d) { return list.includes(v) ? v : d; }
function pickId(list, v, d) { return list.some(x => x.id === v) ? v : d; }
function toBool(v) { return v === true || v === "1" || v === "true" || v === "on"; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function round1(v) { return Math.round(v * 10) / 10; }
function roundQty(q) { return Math.round(q * 10) / 10; }
