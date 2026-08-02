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
const staleRepost={
  ...firstRelease,
  title:"Model Alphaを10地域で提供、OpenAIの新モデル発表を改めて紹介",
  raw_excerpt:"OpenAIのModel Alphaは10地域でAPI提供を開始しました。",
  source_published_at:"2026-07-03T09:00:00Z",published_at:"2026-07-03T09:00:00Z",
  source_url:"https://another.example/alpha-repost",
  change_summary:"Model AlphaのAPIが10地域で公開されました。"
};
if(context.filterStaleRawCandidates([staleRepost],[firstTimeline]).length!==0){
  throw new Error("a recent repost with no new facts passed the pre-enrichment filter");
}
if(context.connectStoryTimeline([staleRepost],[firstTimeline]).length!==0){
  throw new Error("a recent repost with no progress was published again");
}
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

const securityFirst={
  title:"Anthropic、Claudeの外部アクセス問題を確認し調査を開始",
  raw_excerpt:"Claudeが3社のシステムへアクセスした問題をAnthropicが調査しています。",
  source_published_at:"2026-07-20T09:00:00Z",published_at:"2026-07-20T09:00:00Z",
  source_url:"https://security.example/claude-investigation",story_entities:["Anthropic","Claude"],
  change_summary:"Anthropicが問題の調査を開始しました。",event_status:"確認済み"
};
const securityPatch={
  ...securityFirst,
  title:"Anthropic、Claudeの外部アクセス問題を修正しパッチを公開",
  raw_excerpt:"Anthropicは3社へのアクセス問題を修正し、再発防止パッチを公開しました。",
  source_published_at:"2026-07-22T09:00:00Z",published_at:"2026-07-22T09:00:00Z",
  source_url:"https://security.example/claude-patch",
  change_summary:"Anthropicが修正パッチを公開しました。",event_status:"修正済み",
  new_facts:["外部アクセスを防ぐ修正パッチが新たに公開されました。"]
};
const securityStart=context.connectStoryTimeline([securityFirst],[])[0];
const securityFollowUp=context.connectStoryTimeline([securityPatch],[securityStart]);
if(securityFollowUp.length!==1||securityFollowUp[0].relation_type!=="follow_up"){
  throw new Error("a real security remediation was not published as progress");
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
if(context.normalizeEventDate("2026-02-31")!==""){
  throw new Error("an impossible event date was accepted");
}
const explicitDates=context.explicitEventDateCandidates(
  "同社は2026年8月15日に新モデルの提供を開始すると発表しました。掲載日: 2026年8月1日"
);
if(explicitDates.length!==1||explicitDates[0].date!=="2026-08-15"){
  throw new Error("an explicit event date was not separated from the publication date");
}
const relativeDate=context.explicitEventDateCandidates(
  "同社は本日、新モデルの提供を開始したと発表しました。",
  "2026-08-01T09:30:00Z"
);
if(relativeDate.length!==1||relativeDate[0].date!=="2026-08-01"||relativeDate[0].kind!=="relative_to_publication"){
  throw new Error("a relative event date was not resolved from the verified publication date");
}
const yearlessDate=context.explicitEventDateCandidates(
  "新サービスは8月15日に提供を開始する予定です。",
  "2026-08-01"
);
if(yearlessDate.length!==1||yearlessDate[0].date!=="2026-08-15"){
  throw new Error("a yearless event date was not resolved from the publication year");
}
const publicationOnly=context.explicitEventDateCandidates(
  "掲載日: 2026年8月1日。新サービスの概要を紹介します。",
  "2026-08-01"
);
if(publicationOnly.length!==0)throw new Error("a publication date was mislabeled as an event date");
if(context.rawDateStatus("2026-08-01")!=="date_only"||context.rawDateStatus("2026-08-01T09:00:00Z")!=="published"){
  throw new Error("date-only source precision was not preserved");
}
const invalidSequence=context.normalizeTimelineItem({...firstRelease,story_sequence:"not-a-number"});
if(invalidSequence.story_sequence!==1)throw new Error("invalid story sequence was not guarded");
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
