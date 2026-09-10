#!/usr/bin/env node
// 販売管理の商品マスタ(CSV)から assets/catalog-data.js の PRODUCTS を生成します。
// 使い方: node mitaka-ec/scripts/import-catalog.mjs 商品マスタ.csv
// CSVの列(1行目は見出し): 品番,メーカー,カテゴリ,商品名,規格,単位,価格,タグ,備考
//   メーカー: 佐藤産業 / 誠和 / 東都興業 / それ以外は「汎用・自社」扱い
//   カテゴリ: catalog-data.js の CATEGORIES の label(例: ジョイント・クロス金具)。不明なら「金具・部材」
//   価格: 空欄なら「要見積」
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, "..", "assets", "catalog-data.js");
const csvPath = process.argv[2];
if (!csvPath) { console.error("使い方: node import-catalog.mjs 商品マスタ.csv"); process.exit(1); }

const mod = await import(target);
const makerId = label => (mod.MAKERS.find(m => m.label === label) || {}).id || "generic";
const catId = label => (mod.CATEGORIES.find(c => c.label === label) || mod.CATEGORIES.find(c => c.id === "joint")).id;

function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

const text = fs.readFileSync(csvPath, "utf8").replace(/^﻿/, "");
const [head, ...rows] = parseCsv(text);
const idx = name => head.findIndex(h => h.trim() === name);
const col = (r, name) => (r[idx(name)] || "").trim();
const products = rows.map(r => ({
  id: col(r, "品番"), maker: makerId(col(r, "メーカー")), cat: catId(col(r, "カテゴリ")), name: col(r, "商品名"), spec: col(r, "規格"), unit: col(r, "単位") || "個",
  price: col(r, "価格") ? Number(col(r, "価格").replace(/[^\d.]/g, "")) : null, tags: col(r, "タグ") ? col(r, "タグ").split(/[;、,\s]+/).filter(Boolean) : [], note: col(r, "備考")
})).filter(p => p.id && p.name);

let src = fs.readFileSync(target, "utf8");
const begin = src.indexOf("// BEGIN PRODUCTS"), end = src.indexOf("// END PRODUCTS");
if (begin < 0 || end < 0) { console.error("catalog-data.js にマーカーが見つかりません"); process.exit(1); }
const body = "// BEGIN PRODUCTS (scripts/import-catalog.mjs が CSV から書き換える範囲)\nexport const PRODUCTS = [\n" + products.map(p => "  " + JSON.stringify(p)).join(",\n") + "\n];\n";
src = src.slice(0, begin) + body + src.slice(end);
fs.writeFileSync(target, src);
console.log(`${products.length}件の商品を書き込みました → ${path.relative(process.cwd(), target)}`);
