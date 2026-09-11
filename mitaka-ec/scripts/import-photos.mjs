// 実物の商品写真を取り込む。
//
//   node scripts/import-photos.mjs <画像フォルダ>
//
// フォルダの中のファイル名を「商品ID.拡張子」(例: SW-VT-KF50.jpg)にしておくと、
// 1200×900(4:3)・白背景の JPEG に整えて assets/products/ に入れ、
// assets/product-photos.js の REAL_PHOTOS に商品IDを追加します。
// 以後その商品は「イメージ図」表示ではなく、実物写真として扱われます。
//
//   node scripts/import-photos.mjs <画像フォルダ> --map map.csv
//
// ファイル名が品番と違うときは CSV(1列目=商品ID, 2列目=ファイル名)で対応づけできます。
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
const { chromium } = require_(process.env.PLAYWRIGHT_PATH || "/opt/node22/lib/node_modules/playwright");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUTDIR = path.join(ROOT, "assets/products");
const MANIFEST = path.join(ROOT, "assets/product-photos.js");
const OUT_W = 1200, OUT_H = 900;
const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif" };

const args = process.argv.slice(2);
const srcDir = args.find(a => !a.startsWith("--"));
if (!srcDir) { console.error("使い方: node scripts/import-photos.mjs <画像フォルダ> [--map map.csv]"); process.exit(1); }
const mapIdx = args.indexOf("--map");
const mapFile = mapIdx >= 0 ? args[mapIdx + 1] : null;

const { PRODUCTS } = await import(path.join(ROOT, "assets/catalog-data.js"));
const known = new Set(PRODUCTS.map(p => p.id));

// 取り込む対象を決める
let jobs = [];
if (mapFile) {
  for (const line of fs.readFileSync(mapFile, "utf8").split(/\r?\n/)) {
    const [id, file] = line.split(",").map(v => (v || "").trim());
    if (!id || !file || id.startsWith("#")) continue;
    jobs.push({ id, file: path.resolve(srcDir, file) });
  }
} else {
  for (const f of fs.readdirSync(srcDir)) {
    const ext = path.extname(f).toLowerCase();
    if (!MIME[ext]) continue;
    jobs.push({ id: path.basename(f, ext), file: path.join(srcDir, f) });
  }
}

const unknown = jobs.filter(j => !known.has(j.id));
if (unknown.length) console.warn(`商品マスタに無いID(飛ばします): ${unknown.map(u => u.id).join(", ")}`);
jobs = jobs.filter(j => known.has(j.id));
if (!jobs.length) { console.error("取り込める画像がありません。ファイル名を「商品ID.jpg」にするか --map を使ってください。"); process.exit(1); }

fs.mkdirSync(OUTDIR, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<!doctype html><meta charset=utf-8><body>");

const done = [];
for (const job of jobs) {
  const ext = path.extname(job.file).toLowerCase();
  const dataUrl = `data:${MIME[ext] || "image/jpeg"};base64,${fs.readFileSync(job.file).toString("base64")}`;
  const out = await page.evaluate(async ({ dataUrl, W, H }) => {
    const img = new Image();
    await new Promise((ok, ng) => { img.onload = ok; img.onerror = () => ng(new Error("読めない画像")); img.src = dataUrl; });
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d");
    x.fillStyle = "#ffffff"; x.fillRect(0, 0, W, H);
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
    const s = Math.min(W / img.naturalWidth, H / img.naturalHeight) * 0.96;   // はみ出させず少し余白
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    x.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    return { url: c.toDataURL("image/jpeg", 0.88), src: `${img.naturalWidth}×${img.naturalHeight}` };
  }, { dataUrl, W: OUT_W, H: OUT_H }).catch(e => ({ err: String(e.message || e) }));
  if (out.err) { console.error(`NG ${job.id}: ${out.err}`); continue; }
  const buf = Buffer.from(out.url.split(",")[1], "base64");
  fs.writeFileSync(path.join(OUTDIR, `${job.id}.jpg`), buf);
  done.push(job.id);
  console.log(`OK ${job.id.padEnd(15)} ${out.src} → ${OUT_W}×${OUT_H}  ${(buf.length / 1024).toFixed(0)}KB`);
}
await browser.close();

// 実物写真リストを更新
const prev = (fs.readFileSync(MANIFEST, "utf8").match(/new Set\(\[([\s\S]*?)\]\)/) || [, ""])[1];
const ids = new Set([...prev.split(",").map(v => v.trim().replace(/^"|"$/g, "")).filter(Boolean), ...done]);
const sorted = [...ids].filter(id => known.has(id)).sort();
fs.writeFileSync(MANIFEST,
`// 実物の商品写真に差し替え済みの商品ID。
// scripts/import-photos.mjs が自動で書き換えます。手で編集しないでください。
// ここに無い商品の画像は「イメージ図」(実寸から起こした3Dレンダリング)として表示されます。
export const REAL_PHOTOS = new Set([
${sorted.map(id => `  "${id}"`).join(",\n")}${sorted.length ? "\n" : ""}]);
`);
console.log(`\n取り込み ${done.length}点 / 実物写真 合計 ${sorted.length}点 (全${known.size}商品)`);
