// 商品画像(スタジオ撮影風レンダリング)の書き出し。
//   node scripts/product-photo/shoot.mjs            … 全商品
//   node scripts/product-photo/shoot.mjs ID1 ID2 …  … 指定商品だけ
// 出力: mitaka-ec/assets/products/<ID>.jpg
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// playwright はグローバル導入なので NODE_PATH から解決する
const require_ = createRequire(import.meta.url);
const { chromium } = require_(process.env.PLAYWRIGHT_PATH || "/opt/node22/lib/node_modules/playwright");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const OUTDIR = path.join(ROOT, "assets/products");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end("nf"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" });
    res.end(data);
  });
});

await new Promise(r => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
fs.mkdirSync(OUTDIR, { recursive: true });

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
const errs = [];
page.on("pageerror", e => errs.push(String(e.message)));
page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
await page.goto(`http://127.0.0.1:${port}/scripts/product-photo/studio.html`, { waitUntil: "load" });
await page.waitForFunction("window.__ready === true", null, { timeout: 60000 });
if (errs.length) { console.error(errs.join("\n")); process.exit(1); }

const all = await page.evaluate("window.__ids");
const want = process.argv.slice(2);
const ids = want.length ? want : all;

let n = 0;
const t0 = Date.now();
for (const id of ids) {
  const info = await page.evaluate(i => window.__render(i), id);
  const url = await page.evaluate(() => window.__jpeg(0.86));
  const buf = Buffer.from(url.split(",")[1], "base64");
  fs.writeFileSync(path.join(OUTDIR, `${id}.jpg`), buf);
  n++;
  console.log(`${String(n).padStart(2)}/${ids.length} ${id.padEnd(15)} ${(buf.length / 1024).toFixed(0)}KB  span=${info.span.toFixed(2)}m`);
}
console.log(`done ${n} images in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (errs.length) console.error("ERRORS:\n" + errs.join("\n"));
await browser.close();
server.close();
