// 使い方: node shoot-cdp.mjs <studioURL> <outDir> <jobs.json>
// jobs.json: [{ "id": "GN-VT-FAN40", "out": "air.jpg", "opts": { "target": 0.7, "biasY": 0.05, "shot": {...} } }, ...]
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const [url, outDir, jobsFile] = process.argv.slice(2);
const jobs = JSON.parse(readFileSync(jobsFile, "utf8"));
mkdirSync(outDir, { recursive: true });
const list = await (await fetch(`http://127.0.0.1:9222/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(list.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const errs = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method === "Runtime.exceptionThrown") errs.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split("\n")[0]);
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errs.push(m.params.args.map(a => a.value ?? a.description).join(" ").slice(0, 200));
});
await new Promise((r) => ws.addEventListener("open", r));
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval error"); return r.result?.result?.value; };
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url });
for (let i = 0; i < 60; i++) { await sleep(500); if (await ev("window.__ready === true")) break; }
if (!(await ev("window.__ready === true"))) { console.error("studio not ready", errs); process.exit(1); }
let n = 0;
for (const j of jobs) {
  try {
    const info = await ev(`JSON.stringify(window.__render(${JSON.stringify(j.id)}, ${JSON.stringify(j.opts || {})}))`);
    const data = await ev(`window.__jpeg(${j.q || 0.86})`);
    const buf = Buffer.from(data.split(",")[1], "base64");
    writeFileSync(join(outDir, j.out || `${j.id}.jpg`), buf);
    n++; console.log(`${String(n).padStart(2)}/${jobs.length} ${j.out || j.id}  ${(buf.length / 1024).toFixed(0)}KB  ${info}`);
  } catch (e) { console.error("NG", j.id, e.message); }
}
if (errs.length) console.error("page errors:\n" + errs.join("\n"));
await send("Page.close").catch(() => {});
ws.close(); process.exit(0);
