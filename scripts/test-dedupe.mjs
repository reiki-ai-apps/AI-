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
    title: "Moonshot AI raises 500 million dollars in a new funding round",
    raw_excerpt: "Moonshot AI, the maker of Kimi, raised 500 million dollars",
    published_at: "2026-07-30T10:00:00Z",
    source_url: "https://a.example/1"
  },
  {
    title: "Kimi maker Moonshot AI raises 500 million dollars in funding round",
    raw_excerpt: "Moonshot AI, the maker of Kimi, raised 500 million dollars",
    published_at: "2026-07-30T12:00:00Z",
    source_url: "https://b.example/2"
  }
];

const deduped = context.dedupeStories(items);
if (deduped.length !== 1) {
  throw new Error(`semantic dedupe failed: expected 1, received ${deduped.length}`);
}

const changedAmount={...items[1],title:"Kimi maker Moonshot AI raises 700 million dollars in another funding round",raw_excerpt:"Moonshot AI raised 700 million dollars",source_url:"https://c.example/3"};
if(context.dedupeStories([items[0],changedAmount]).length!==2){
  throw new Error("different funding amounts were incorrectly merged");
}

console.log("Semantic dedupe test passed");
