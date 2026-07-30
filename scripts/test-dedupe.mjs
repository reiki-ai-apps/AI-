import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL("../update.js", import.meta.url), "utf8");
const mainStart = source.indexOf("(async () => {");
if (mainStart < 0) throw new Error("update.js main entry was not found");

const context = {
  require,
  console,
  process,
  setTimeout,
  clearTimeout,
  URL,
  AbortController,
  fetch
};
vm.createContext(context);
vm.runInContext(source.slice(0, mainStart), context);

const items = [
  {
    title: "中国AI企業Moonshot AI、香港上場前に評価額5兆円規模を目指す",
    raw_excerpt: "Moonshot AIのKimiを展開する企業が新たな資金調達を検討",
    published_at: "2026-07-30T10:00:00Z",
    source_url: "https://a.example/1"
  },
  {
    title: "Kimi運営企業が大型資金調達、企業価値500億ドルへ",
    raw_excerpt: "中国のMoonshot AIが香港上場を視野に評価額を引き上げる",
    published_at: "2026-07-30T12:00:00Z",
    source_url: "https://b.example/2"
  }
];

const deduped = context.dedupeStories(items);
if (deduped.length !== 1) {
  throw new Error(`semantic dedupe failed: expected 1, received ${deduped.length}`);
}

console.log("Semantic dedupe test passed");
