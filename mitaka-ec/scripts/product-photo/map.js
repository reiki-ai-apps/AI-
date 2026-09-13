// 商品ID → 立体の作り方。撮影用。
// count: 何個並べて撮るか(袋入り・箱入りの商品は複数並べる)
// view : "std"(3/4) | "long"(長物を手前から奥へ) | "flat"(やや上から)
export const SHOTS = {
  // ---- 佐藤産業 接合金具 ----
  "ST-JT-N2":     { b: "joint",  p: { dia: 25.4 }, count: 2 },
  "ST-JT-N10":    { b: "joint",  p: { dia: 25.4 }, count: 3 },
  "ST-JT-IN22":   { b: "sleeve", p: { dia: 22.2 } },
  "ST-JT-IN25":   { b: "sleeve", p: { dia: 25.4 } },
  "ST-JT-SUEJI":  { b: "angle",  p: { dia: 25.4 } },
  "ST-JT-VB":     { b: "spring", p: {} },
  "ST-CR-PC":     { b: "cross",  p: { dia: 25.4 }, count: 3 },
  "ST-CR-PB22":   { b: "cross",  p: { dia: 22.2 }, count: 3 },
  "ST-CR-PB25":   { b: "cross",  p: { dia: 25.4 }, count: 3 },
  "ST-CR-PB31":   { b: "cross",  p: { dia: 31.8 }, count: 3 },
  "ST-CR-TB":     { b: "tee",    p: { dia: 25.4 }, count: 3 },
  "ST-CR-JZ":     { b: "angle",  p: { dia: 25.4, swivel: true }, count: 2 },
  // ---- 強靭化・補強 ----
  "ST-RF-TB32":   { b: "tiebar", p: { dia: 31.8 } },
  "ST-RF-TB25":   { b: "tiebar", p: { dia: 25.4 } },
  "ST-RF-BRACE":  { b: "brace",  p: { dia: 25.4 } },
  "GN-HW-ANCHOR": { b: "anchor", p: {}, count: 3 },
  // ---- フィルム固定 ----
  "GN-PK-22":     { b: "packer", p: { dia: 22.2 }, count: 3 },
  "GN-PK-25":     { b: "packer", p: { dia: 25.4 }, count: 3 },
  "GN-PK-31":     { b: "packer", p: { dia: 31.8 }, count: 3 },
  "ST-PK-NC":     { b: "dripCatch", p: {} },
  "ST-FS-CLIP":   { b: "packer", p: { dia: 25.4, steel: true }, count: 3 },
  "TT-FS-VP4":    { b: "rail",   p: { len: 4 }, view: "long" },
  "TT-FS-VP6":    { b: "rail",   p: { len: 6 }, view: "long" },
  "TT-FS-SP":     { b: "spring", p: {}, view: "long" },
  // ---- ドア・妻面 ----
  "ST-DR-STD":    { b: "door",     p: {} },
  "ST-DR-RAIL":   { b: "doorRail", p: {}, view: "long" },
  "GN-DR-STD":    { b: "door",     p: {} },
  // ---- 換気 ----
  "ST-VT-TSUMA":  { b: "roofVent", p: {} },
  "ST-VT-ROLL":   { b: "crank",    p: {} },
  "SW-VT-KF50":   { b: "crank",    p: {} },
  "SW-VT-KF100":  { b: "crank",    p: { big: true } },
  "SW-VT-KK":     { b: "crank",    p: { small: true } },
  "SW-VT-KK100":  { b: "crank",    p: { small: true, big: true } },
  "SW-VT-ACE":    { b: "panel",    p: { kind: "dial" } },
  "GN-VT-FAN40":  { b: "fan",      p: {} },
  "GN-VT-ROOF":   { b: "roofVent", p: {} },
  // ---- 谷部 ----
  "ST-GT-AMANO":  { b: "gutter",    p: {}, view: "long" },
  "ST-GT-SHEET":  { b: "sheetRoll", p: { color: 0x3a4b42 } },
  // ---- カーテン ----
  "SW-CT-DRIVE":  { b: "curtainDrive",  p: {} },
  "SW-CT-SCREEN": { b: "curtainFabric", p: { color: 0xd8d8d2, metal: 0.45, stripe: true } },
  "SW-CT-SHADE":  { b: "curtainFabric", p: { color: 0x4c5158, metal: 0.1 } },
  "GN-CT-HEAT":   { b: "curtainFabric", p: { color: 0xcfd3d6, metal: 0.55, stripe: true } },
  "GN-CT-SHADE50":{ b: "netRoll",       p: { color: 0x23262a, mm: 4, thread: 2.2 } },
  // ---- 環境制御 ----
  "SW-EC-PF4":    { b: "sensor", p: {} },
  "SW-EC-NEXT80": { b: "panel",  p: { kind: "big" } },
  "SW-EC-CLOUD":  { b: "panel",  p: { kind: "cloud" } },
  "SW-EC-CO2":    { b: "co2",    p: {} },
  "SW-EC-HEATER": { b: "heater", p: {} },
  "SW-LED":       { b: "led",    p: {}, view: "long" },
  "SW-IR-SYS":    { b: "panel",  p: { kind: "irrigation" } },
  // ---- 潅水 ----
  "GN-IR-DRIP":   { b: "dripTube", p: {} },
  "GN-IR-MIST":   { b: "mist",     p: {} },
  "GN-IR-TIMER":  { b: "timer",    p: {} },
  "GN-IR-FILTER": { b: "filter",   p: {} },
  // ---- パイプ ----
  "GN-PP-1910":   { b: "pipe", p: { dia: 19.1, len: 5.5 }, view: "bundle" },
  "GN-PP-2210":   { b: "pipe", p: { dia: 22.2, len: 5.5 }, view: "bundle" },
  "GN-PP-2510":   { b: "pipe", p: { dia: 25.4, len: 5.5 }, view: "bundle" },
  "GN-PP-2560":   { b: "pipe", p: { dia: 25.4, len: 6.0 }, view: "bundle" },
  "GN-PP-3110":   { b: "pipe", p: { dia: 31.8, len: 5.5 }, view: "bundle" },
  "GN-PP-ARCH54": { b: "arch", p: { dia: 25.4, span: 5.4, eave: 1.6, ridge: 3.0 } },
  "GN-PP-ARCH72": { b: "arch", p: { dia: 31.8, span: 7.2, eave: 1.8, ridge: 3.6 } },
  // ---- フィルム ----
  "GN-FL-NOVI010":{ b: "filmRoll", p: { width: 2.3, tint: 0xc9dcea, label: 0xE8622A } },
  "GN-FL-NOVI013":{ b: "filmRoll", p: { width: 2.3, tint: 0xbfd6e8, label: 0x2f6b45 } },
  "GN-FL-PO015":  { b: "filmRoll", p: { width: 5.4, tint: 0xcfe3e6, label: 0x1f6f9c } },
  "GN-FL-PO015S": { b: "filmRoll", p: { width: 5.4, tint: 0xeceee6, diffuse: true, label: 0xF2C14E } },
  "GN-FL-PO5Y":   { b: "filmRoll", p: { width: 6.0, tint: 0xc6dce4, label: 0x8C4A2F } },
  "GN-FL-ETFE":   { b: "filmRoll", p: { width: 6.0, tint: 0xd8ecf4, label: 0x26292c } },
  // ---- マルチ・ネット ----
  "GN-ML-BLACK":  { b: "sheetRoll", p: { color: 0x141618 } },
  "GN-ML-INSECT": { b: "netRoll",   p: { color: 0xb9c0bc, mm: 1, thread: 0.34 } },
  "GN-ML-WEED":   { b: "sheetRoll", p: { color: 0x2c322e } },
  // ---- 鳥獣害 ----
  "GN-AN-EFENCE": { b: "fence",   p: {} },
  "GN-AN-NET":    { b: "netRoll", p: { color: 0x1f2529, mm: 16, thread: 1.6 } },
  "GN-AN-BIRD":   { b: "netRoll", p: { color: 0x171a1d, mm: 20, thread: 0.9 } }
};
