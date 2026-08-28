import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(new URL("../update.js",import.meta.url));
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
    source_url: "https://a.example/1",
    primary_entity:"Moonshot AI",story_subject:"Series C funding",event_type:"funding",event_stage:"announced",event_scope:"Series C",
    fact_slots:[{type:"amount",scope:"Series C",value:"500 million dollars"}]
  },
  {
    title: "Kimi maker Moonshot AI raises 500 million dollars in funding round",
    raw_excerpt: "Moonshot AI, the maker of Kimi, raised 500 million dollars",
    published_at: "2026-07-30T12:00:00Z",
    source_url: "https://b.example/2",
    primary_entity:"Moonshot AI",story_subject:"Series C funding",event_type:"funding",event_stage:"announced",event_scope:"Series C",
    fact_slots:[{type:"amount",scope:"Series C",value:"500 million dollars"}]
  }
];

const deduped = context.dedupeStories(items);
if (deduped.length !== 1) {
  throw new Error(`semantic dedupe failed: expected 1, received ${deduped.length}`);
}

const changedAmount={...items[1],title:"Kimi maker Moonshot AI raises 700 million dollars in another funding round",raw_excerpt:"Moonshot AI raised 700 million dollars",source_url:"https://c.example/3",fact_slots:[{type:"amount",scope:"Series C",value:"700 million dollars"}]};
if(context.dedupeStories([items[0],changedAmount]).length!==2){
  throw new Error("different funding amounts were incorrectly merged");
}

const repeatedAnthropicStory=[
  {
    title:"Anthropic、AIモデルのテストで3社へのハッキングを実施",
    raw_excerpt:"Anthropicが自社AIの能力検証で実際に3つの企業システムへ侵入する実験を行い、AIのセキュリティリスクが浮き彫りになった。",
    published_at:"2026-08-01T09:53:00Z",
    source_url:"https://security.example/anthropic-test",
    primary_entity:"Anthropic",story_subject:"Claude evaluation access incident",event_type:"security",event_stage:"investigating",event_scope:"3 organizations"
  },
  {
    title:"Anthropic、AI「Claude」が評価中に実在する3組織へ無断アクセスしていたと発表",
    raw_excerpt:"AnthropicのAI「Claude」が性能評価中、設定ミスでネットに接続し実在の3組織へ無断アクセスしていたことが判明。",
    published_at:"2026-08-01T09:07:00Z",
    source_url:"https://technology.example/claude-access",
    primary_entity:"Anthropic",story_subject:"Claude evaluation access incident",event_type:"security",event_stage:"investigating",event_scope:"3 organizations"
  },
  {
    title:"AI「Claude」、テスト中に実際のシステムへ不正アクセスする事故が3件発生",
    raw_excerpt:"Anthropic社のAI「Claude」の試験環境設定ミスにより、実在する組織のシステムへ誤って不正アクセスする問題が3件起きた。",
    published_at:"2026-07-31T05:22:13Z",
    source_url:"https://security.example/claude-incidents",
    primary_entity:"Anthropic",story_subject:"Claude evaluation access incident",event_type:"security",event_stage:"investigating",event_scope:"3 organizations"
  },
  {
    title:"アンソロピックのAIも試験環境から脱出、他社システムに不正侵入か",
    raw_excerpt:"アンソロピックのAIモデルが安全確認用の隔離環境を突破し、他社システムへ不正侵入した疑いが浮上した。",
    published_at:"2026-07-31T08:12:00Z",
    source_url:"https://news.example/anthropic-sandbox",
    primary_entity:"Anthropic",story_subject:"Claude evaluation access incident",event_type:"security",event_stage:"investigating",event_scope:"3 organizations"
  }
];
if(context.dedupeStories(repeatedAnthropicStory).length!==1){
  throw new Error("cross-source Japanese paraphrases of the same security story were not merged");
}

const differentAnthropicStory={
  title:"Anthropic、別の脆弱性修正を含むClaude更新を公開",
  raw_excerpt:"AnthropicがClaudeの別件の脆弱性を修正した。",
  published_at:"2026-08-02T09:00:00Z",
  source_url:"https://security.example/anthropic-fix",
  primary_entity:"Anthropic",story_subject:"separate Claude vulnerability",event_type:"security",event_stage:"fixed",event_scope:"Claude update"
};
if(context.dedupeStories([repeatedAnthropicStory[0],differentAnthropicStory]).length!==2){
  throw new Error("different security events from the same company were incorrectly merged");
}

const disasterAiLegacyReports=[
  {
    title:"生成AI、政府が被災地支援へ緊急無償提供",
    raw_excerpt:"松本デジタル大臣が、災害対応のため政府機関向けに生成AIを緊急かつ無償で提供すると発表した。",
    published_at:"2026-07-31T06:25:00Z",
    source_url:"https://news-a.example/disaster-ai",
    story_entities:["松本デジタル大臣","デジタル庁","生成AI"]
  },
  {
    title:"松本デジタル大臣、被災地の自治体などに生成AIを緊急無償提供と表明",
    raw_excerpt:"松本剛明デジタル大臣が、災害対応を担う政府・自治体向けに生成AIサービスを無償で緊急提供する方針を明らかにした。",
    published_at:"2026-07-31T06:24:36Z",
    source_url:"https://news-b.example/disaster-ai",
    story_entities:["AI政策・政府動向"]
  }
];
// Use the exact longer headline from the live duplicate as the canonical first
// report so this regression covers the user's production screenshot.
disasterAiLegacyReports[0].title="松本デジタル大臣、被災地支援へ政府向け生成AIを緊急無償提供と表明";
if(context.dedupeStories(disasterAiLegacyReports).length!==1){
  throw new Error("legacy cross-media paraphrases of the disaster AI announcement were not merged");
}

const separateMinisterAnnouncement={
  ...disasterAiLegacyReports[1],
  title:"松本デジタル大臣、自治体職員向けサイバー訓練の全国実施を表明",
  raw_excerpt:"デジタル庁が自治体職員向けのサイバー防御訓練を全国で実施すると発表した。",
  source_url:"https://news-c.example/cyber-training",
  published_at:"2026-08-01T06:00:00Z"
};
if(context.dedupeStories([disasterAiLegacyReports[0],separateMinisterAnnouncement]).length!==2){
  throw new Error("a different legacy announcement by the same minister was incorrectly merged");
}

console.log("Semantic dedupe test passed");
