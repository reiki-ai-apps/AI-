import fs from "node:fs";
import vm from "node:vm";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require=createRequire(import.meta.url);
const source=fs.readFileSync(new URL("../update.js",import.meta.url),"utf8");
const mainStart=source.indexOf("(async () => {");
if(mainStart<0)throw new Error("update.js main entry was not found");

const context={require,console,process,setTimeout,clearTimeout,URL,AbortController,fetch};
vm.createContext(context);
vm.runInContext(source.slice(0,mainStart),context);

const iso="2026-07-31T00:00:00Z";
const candidates=[
  {tool:"AI政策・政府動向",title:"Japan publishes a new AI regulation policy",raw_excerpt:"Government policy",published_at:iso,source_url:"https://example.com/policy"},
  {tool:"AIセキュリティ",title:"Critical AI security vulnerability disclosed",raw_excerpt:"Security notice",published_at:iso,source_url:"https://example.com/security"},
  {tool:"中国AI・基盤モデル",title:"Moonshot Kimi releases a new model",raw_excerpt:"New model",published_at:iso,source_url:"https://example.com/frontier"},
  {tool:"NVIDIA・AI半導体",title:"NVIDIA announces a new AI semiconductor",raw_excerpt:"GPU infrastructure",published_at:iso,source_url:"https://example.com/chip"},
  {tool:"General",title:"Routine AI product update",raw_excerpt:"Update",published_at:iso,source_url:"https://example.com/general"}
];

const selected=context.selectProtectedCandidates(candidates,4);
const buckets=new Set(selected.map(context.criticalBucket));
for(const bucket of ["policy","security","frontier","semiconductor"]){
  if(!buckets.has(bucket))throw new Error(`protected slot missing: ${bucket}`);
}

const cache={version:1,items:{}};
const sourceItem=candidates[0];
const enriched={...sourceItem,detail:"詳細",change_summary:"変更",impact_summary:"影響",action_suggestion:"対応",importance:"A",related_categories:["政策・行政"]};
context.rememberCacheResult(cache,sourceItem,"enriched",enriched,"regular");
if(!context.cacheEntryFor(sourceItem,cache))throw new Error("cache hit was not found");
if(context.cacheEntryFor({...sourceItem,raw_excerpt:"changed content"},cache))throw new Error("changed content reused stale cache");

const previous=[{
  ...enriched,
  title:"Moonshot Kimi raises 500 million dollars",
  raw_excerpt:"Moonshot AI funding round",
  published_at:"2026-07-20T00:00:00Z",
  source_url:"https://old.example/story"
}];
const laterStory={
  title:"Moonshot Kimi raises 700 million dollars",
  raw_excerpt:"Moonshot AI starts another funding round",
  published_at:"2026-07-30T00:00:00Z",
  source_url:"https://new.example/story"
};
if(context.findReusablePrevious(previous,laterStory))throw new Error("old same-company story was incorrectly reused");
if(context.findReusablePrevious(previous,{...laterStory,source_url:"https://old.example/story"})){
  throw new Error("changed exact URL content should not bypass strict reuse");
}
const sameUrlSameTitleChangedBody={
  ...previous[0],
  raw_excerpt:"Moonshot AI replaced the article body with a different announcement"
};
if(context.findReusablePrevious(previous,sameUrlSameTitleChangedBody)){
  throw new Error("same URL and title with changed body reused a stale summary");
}

const nearStory={...laterStory,published_at:"2026-07-21T12:00:00Z",title:previous[0].title};
if(context.findReusablePrevious(previous,nearStory)!==previous[0])throw new Error("recent matching event should be reusable");
const nearbyDifferentEvent={...laterStory,published_at:"2026-07-21T12:00:00Z"};
if(context.findReusablePrevious(previous,nearbyDifferentEvent))throw new Error("nearby event with a different amount was incorrectly reused");
const modelPriceOld=[{
  ...previous[0],title:"Model 2 API price changes to 10 dollars",raw_excerpt:"Model 2 costs 10 dollars",published_at:"2026-07-30T00:00:00Z"
}];
const modelPriceNew={
  ...modelPriceOld[0],source_url:"https://new.example/model-2",title:"Model 2 API price changes to 20 dollars",raw_excerpt:"Model 2 costs 20 dollars",published_at:"2026-07-30T12:00:00Z"
};
if(context.findReusablePrevious(modelPriceOld,modelPriceNew))throw new Error("shared model number hid a changed price");

const firstRelease={
  tool:"世界の新モデル・速報",title:"OpenAIがModel Alpha新モデルを10地域で発表",raw_excerpt:"Model Alpha新モデルのAPIを10地域で提供開始しました。",
  source_published_at:"2026-07-01T09:00:00Z",published_at:"2026-07-01T09:00:00Z",source_url:"https://news.example/alpha-launch",
  story_entities:["OpenAI","Model Alpha"],change_summary:"Model AlphaのAPIが公開されました。",event_at:"2026-07-01",event_status:"開始済み"
};
const laterRelease={
  tool:"世界の新モデル・速報",title:"OpenAIのModel Alpha新モデルを20地域へ拡大",raw_excerpt:"Model Alpha新モデルのAPI提供地域が10地域から20地域へ増えました。",
  source_published_at:"2026-07-10T09:00:00Z",published_at:"2026-07-10T09:00:00Z",source_url:"https://news.example/alpha-expansion",
  story_entities:["OpenAI","Model Alpha"],change_summary:"Model AlphaのAPI提供地域が追加されました。",event_at:"",event_status:"不明"
};
const firstTimeline=context.connectStoryTimeline([firstRelease],[])[0];
const timeline=context.connectStoryTimeline([laterRelease],[firstTimeline]);
if(timeline[0].relation_type!=="follow_up"||timeline[0].previous_article_id===""||timeline[0].story_sequence!==2){
  throw new Error("a genuine continuation was not linked to its previous report");
}
if(timeline[0].relation_confidence<0.85||!timeline[0].continuation_lead.includes("前回は")){
  throw new Error("continuation context or confidence is missing");
}

const unrelatedRelease={
  ...laterRelease,title:"OpenAIが音声端末Voice Betaを発表、一般販売を開始",raw_excerpt:"新しい音声端末を発売しました。",
  story_entities:["OpenAI","Voice Beta"],source_url:"https://news.example/voice-beta"
};
if(context.connectStoryTimeline([unrelatedRelease],[firstTimeline])[0].relation_type!=="new"){
  throw new Error("an unrelated announcement from the same company became a false follow-up");
}

const sameAnnouncement={...firstRelease,source_url:"https://another.example/alpha-launch",source_published_at:"2026-07-01T10:00:00Z",published_at:"2026-07-01T10:00:00Z"};
if(context.dedupeStories([firstRelease,sameAnnouncement]).length!==1){
  throw new Error("the same announcement from another outlet was not deduplicated");
}

const unknownDates=context.normalizeTimelineItem({
  title:"Googleが新しいAI機能を公開",raw_excerpt:"新しいAI機能の概要です。",source_url:"https://example.com/no-date",
  source_published_at:"",source_updated_at:"2026-07-31T03:00:00Z",source_date_status:"updated_only",
  event_at:"推定2026年7月",event_status:"発表済み",story_entities:["Google"]
});
if(unknownDates.source_published_at!==""||unknownDates.event_at!==""||unknownDates.event_date_precision!=="unknown"){
  throw new Error("unknown publication or event dates were fabricated");
}
if(context.stableArticleId(firstRelease)!==context.stableArticleId({...firstRelease})){
  throw new Error("article ids are not stable");
}

vm.runInContext('callClaude=async()=>({text:"[]",stopReason:"end_turn",usage:{input_tokens:100,output_tokens:2}})',context);
const emptyResult=await context.aiEnrichBatch([sourceItem]);
if(!emptyResult.ok||!emptyResult.charged||emptyResult.items.length!==0||emptyResult.rejected.length!==1){
  throw new Error("valid empty AI selection was not recorded as a full rejection");
}

const ledger={version:1,days:{}};
context.addUsage(ledger,emptyResult.usage,{lane:"regular",attempts:1,processed:1,enriched:0,rejected:1});
const day=context.usageDay(ledger);
if(day.regular_processed!==1||day.input_tokens!==100||day.rejected!==1){
  throw new Error("charged classification was not counted in the daily limit");
}

const checkpointPath=path.join(os.tmpdir(),`ai-radar-checkpoint-${process.pid}.json`);
try{
  context.writeJsonFile(checkpointPath,{version:1});
  context.writeJsonFile(checkpointPath,{version:2});
  if(JSON.parse(fs.readFileSync(checkpointPath,"utf8")).version!==2)throw new Error("atomic checkpoint replacement failed");
  if(fs.existsSync(checkpointPath+`.`+process.pid+`.tmp`))throw new Error("checkpoint temp file was left behind");
}finally{
  if(fs.existsSync(checkpointPath))fs.unlinkSync(checkpointPath);
}

console.log("AI operations tests passed");
