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

const nearStory={...previous[0],published_at:"2026-07-21T12:00:00Z"};
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
  story_entities:["OpenAI","Model Alpha"],primary_entity:"OpenAI",story_subject:"Model Alpha",event_type:"release",event_stage:"launched",event_scope:"API 10 regions",
  fact_slots:[{type:"region",scope:"API availability",value:"10 regions"}],
  change_summary:"Model AlphaのAPIが公開されました。",event_at:"2026-07-01",event_status:"開始済み"
};
const laterRelease={
  tool:"世界の新モデル・速報",title:"OpenAIのModel Alpha新モデルを20地域へ拡大",raw_excerpt:"Model Alpha新モデルのAPI提供地域が10地域から20地域へ増えました。",
  source_published_at:"2026-07-10T09:00:00Z",published_at:"2026-07-10T09:00:00Z",source_url:"https://news.example/alpha-expansion",
  story_entities:["OpenAI","Model Alpha"],primary_entity:"OpenAI",story_subject:"Model Alpha",event_type:"release",event_stage:"expanded",event_scope:"API 20 regions",
  fact_slots:[{type:"region",scope:"API availability",value:"20 regions"}],
  change_summary:"Model AlphaのAPI提供地域が追加されました。",event_at:"",event_status:"不明"
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
if(context.filterStaleRawCandidates([staleRepost],[firstTimeline]).length!==1){
  throw new Error("a paraphrased article was unsafely deleted before AI structure was available");
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
  story_entities:["OpenAI","Voice Beta"],primary_entity:"OpenAI",story_subject:"Voice Beta",event_type:"release",event_stage:"launched",event_scope:"desktop",
  source_url:"https://news.example/voice-beta"
};
if(context.connectStoryTimeline([unrelatedRelease],[firstTimeline])[0].relation_type!=="new"){
  throw new Error("an unrelated announcement from the same company became a false follow-up");
}

const securityFirst={
  title:"Anthropic、Claudeの外部アクセス問題を確認し調査を開始",
  raw_excerpt:"Claudeが3社のシステムへアクセスした問題をAnthropicが調査しています。",
  source_published_at:"2026-07-20T09:00:00Z",published_at:"2026-07-20T09:00:00Z",
  source_url:"https://security.example/claude-investigation",story_entities:["Anthropic","Claude"],
  primary_entity:"Anthropic",story_subject:"Claude unauthorized access incident",event_type:"security",event_stage:"investigating",event_scope:"3 company systems",
  change_summary:"Anthropicが問題の調査を開始しました。",event_status:"確認済み"
};
const securityPatch={
  ...securityFirst,
  title:"Anthropic、Claudeの外部アクセス問題を修正しパッチを公開",
  raw_excerpt:"Anthropicは3社へのアクセス問題を修正し、再発防止パッチを公開しました。",
  source_published_at:"2026-07-22T09:00:00Z",published_at:"2026-07-22T09:00:00Z",
  source_url:"https://security.example/claude-patch",
  primary_entity:"Anthropic",story_subject:"Claude unauthorized access incident",event_type:"security",event_stage:"fixed",event_scope:"3 company systems",
  fact_slots:[{type:"status",scope:"incident",value:"fixed"}],
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

const structuredBase={
  title:"OpenAI launches GPT-5 API",raw_excerpt:"OpenAI released GPT-5 through its API.",
  source_url:"https://wire-a.example/gpt5",source_published_at:"2026-06-01T00:00:00Z",published_at:"2026-06-01T00:00:00Z",
  story_entities:["OpenAI","GPT-5"],primary_entity:"OpenAI",story_subject:"GPT-5",event_type:"release",event_stage:"launched",event_scope:"API",
  fact_slots:[{type:"availability",scope:"API",value:"available"}],new_facts:["GPT-5 became available through the API."]
};
const decision=(previous,current)=>context.classifyStoryRelation(
  context.normalizeTimelineItem(previous),context.normalizeTimelineItem(current)
).decision;
const republished={...structuredBase,title:"GPT-5 API released by OpenAI",raw_excerpt:"The GPT-5 API is now available.",source_url:"https://wire-b.example/openai-gpt5",published_at:"2026-06-02T00:00:00Z",source_published_at:"2026-06-02T00:00:00Z"};
if(decision(structuredBase,republished)!=="duplicate")throw new Error("cross-media paraphrase was not classified as duplicate");

const fundingUsd={...structuredBase,title:"Example AI raises 10億ドル",primary_entity:"Example AI",story_subject:"Series C funding",event_type:"funding",event_stage:"announced",event_scope:"Series C",fact_slots:[{type:"amount",scope:"Series C",value:"10億 USD"}]};
const fundingBillion={...fundingUsd,title:"Example AI secures 1 billion dollars",source_url:"https://wire-b.example/funding",fact_slots:[{type:"amount",scope:"Series C",value:"1 billion dollars"}]};
if(decision(fundingUsd,fundingBillion)!=="duplicate")throw new Error("equivalent Japanese and English amounts became false progress");

const gptDecimal={...republished,story_subject:"GPT-5.0",story_entities:["OpenAI","GPT-5.0"]};
if(decision(structuredBase,gptDecimal)!=="duplicate")throw new Error("GPT-5 and GPT-5.0 were treated as different events");

const regionalExpansion={...structuredBase,title:"OpenAI expands GPT-5 API to Japan",event_stage:"expanded",event_scope:"API Japan",fact_slots:[{type:"region",scope:"API availability",value:"Japan"}]};
if(decision(structuredBase,regionalExpansion)!=="follow_up")throw new Error("a real regional expansion was not a follow-up");

const geminiFlash={...structuredBase,primary_entity:"Google",story_subject:"Gemini 3 Flash",story_entities:["Google","Gemini 3 Flash"],title:"Google launches Gemini 3 Flash"};
const geminiPro={...geminiFlash,story_subject:"Gemini 3 Pro",story_entities:["Google","Gemini 3 Pro"],title:"Google launches Gemini 3 Pro",source_url:"https://wire-b.example/gemini-pro"};
if(decision(geminiFlash,geminiPro)!=="new")throw new Error("different model variants were merged");

const incidentStart={...structuredBase,primary_entity:"Anthropic",story_subject:"Claude access incident",event_type:"security",event_stage:"investigating",event_scope:"3 systems",fact_slots:[{type:"status",scope:"incident",value:"investigating"}]};
const causeKnown={...incidentStart,event_stage:"cause_identified",fact_slots:[{type:"status",scope:"incident",value:"misconfigured test"}]};
if(decision(incidentStart,causeKnown)!=="follow_up")throw new Error("security cause identification was suppressed");

const fundingComplete={...fundingUsd,event_stage:"completed"};
if(decision(fundingUsd,fundingComplete)!=="follow_up")throw new Error("funding completion was suppressed");

const fundingJpy={...fundingUsd,source_url:"https://wire-c.example/funding",fact_slots:[{type:"amount",scope:"Series C",value:"1500億円"}]};
if(decision(fundingUsd,fundingJpy)!=="duplicate")throw new Error("a rounded currency conversion became false progress");

const commentaryOnly={...structuredBase,title:"Experts discuss what the GPT-5 API launch means",raw_excerpt:"Analysts commented on the already announced launch.",source_url:"https://opinion.example/gpt5"};
if(decision(structuredBase,commentaryOnly)!=="duplicate")throw new Error("commentary without a new fact was republished as news");

const corrected={...structuredBase,event_stage:"corrected",title:"Correction: GPT-5 API availability was misstated"};
if(decision(structuredBase,corrected)!=="correction")throw new Error("a correction was not linked as a correction");

// A publisher commonly edits an article at the same URL after a correction.
// The production timeline path must compare the two versions even though their
// URL-derived stable article IDs are identical.
const sameUrlCorrection={
  ...corrected,
  source_url:structuredBase.source_url,
  published_at:"2026-06-02T00:00:00Z",
  source_published_at:"2026-06-02T00:00:00Z",
  change_summary:"Correction: the previously stated API availability was inaccurate."
};
const originalSameUrlTimeline=context.connectStoryTimeline([structuredBase],[])[0];
const retainedSameArticle=context.connectStoryTimeline([structuredBase],[originalSameUrlTimeline]);
if(retainedSameArticle.length!==1||retainedSameArticle[0].article_id!==originalSameUrlTimeline.article_id){
  throw new Error("an unchanged indexed article was removed as its own duplicate");
}
const sameUrlCorrectionTimeline=context.connectStoryTimeline([sameUrlCorrection],[originalSameUrlTimeline]);
if(sameUrlCorrectionTimeline.length!==1||sameUrlCorrectionTimeline[0].relation_type!=="correction"||
  sameUrlCorrectionTimeline[0].previous_article_id!==originalSameUrlTimeline.article_id||
  sameUrlCorrectionTimeline[0].article_id===originalSameUrlTimeline.article_id){
  throw new Error("a same-URL correction was not linked through the production timeline path");
}
const retainedCorrection=context.connectStoryTimeline(
  [sameUrlCorrectionTimeline[0]],
  [originalSameUrlTimeline,sameUrlCorrectionTimeline[0]]
);
if(retainedCorrection.length!==1||retainedCorrection[0].article_id!==sameUrlCorrectionTimeline[0].article_id||
  retainedCorrection[0].previous_article_id===retainedCorrection[0].article_id){
  throw new Error("a revision-aware correction was not retained safely on the next run");
}
const secondSameUrlCorrection={
  ...sameUrlCorrection,
  title:"Second correction: GPT-5 API availability date updated again",
  raw_excerpt:"The publisher issued a second correction with the final availability date.",
  change_summary:"Second correction: the final API availability date is now confirmed.",
  published_at:"2026-06-03T00:00:00Z",
  source_published_at:"2026-06-03T00:00:00Z",
  fact_slots:[{type:"date",scope:"API availability",value:"2026-06-15"}]
};
const secondCorrectionTimeline=context.connectStoryTimeline(
  [secondSameUrlCorrection],
  [originalSameUrlTimeline,sameUrlCorrectionTimeline[0]]
);
if(secondCorrectionTimeline.length!==1||secondCorrectionTimeline[0].relation_type!=="correction"||
  secondCorrectionTimeline[0].previous_article_id!==sameUrlCorrectionTimeline[0].article_id||
  new Set([originalSameUrlTimeline.article_id,sameUrlCorrectionTimeline[0].article_id,secondCorrectionTimeline[0].article_id]).size!==3){
  throw new Error("multiple corrections at the same URL did not preserve the complete revision chain");
}
const reusedUrlDifferentStory={
  ...structuredBase,
  title:"OpenAI publishes a separate robotics research report",
  raw_excerpt:"A new robotics benchmark and dataset were released.",
  primary_entity:"OpenAI Robotics",
  story_subject:"robotics benchmark release",
  event_type:"research",
  event_stage:"released",
  event_scope:"robotics",
  story_entities:["OpenAI Robotics","robotics benchmark"],
  fact_slots:[{type:"status",scope:"robotics benchmark",value:"released"}],
  new_facts:["A separate robotics benchmark and dataset were released."],
  published_at:"2026-07-01T00:00:00Z",
  source_published_at:"2026-07-01T00:00:00Z"
};
const reusedUrlTimeline=context.connectStoryTimeline([reusedUrlDifferentStory],[originalSameUrlTimeline]);
if(reusedUrlTimeline.length!==1||reusedUrlTimeline[0].relation_type!=="new"||
  reusedUrlTimeline[0].article_id===originalSameUrlTimeline.article_id){
  throw new Error("a reused URL for a different story collided with the original article version");
}

const oldTimeline=context.connectStoryTimeline([structuredBase],[])[0];
const day40={...republished,published_at:"2026-07-11T00:00:00Z",source_published_at:"2026-07-11T00:00:00Z"};
if(context.connectStoryTimeline([day40],[oldTimeline]).length!==0)throw new Error("the same event reappeared after the 31-day display window");

const unrelatedFeature={...structuredBase,story_subject:"ChatGPT voice mode",story_entities:["OpenAI","ChatGPT voice mode"],title:"OpenAI launches a ChatGPT voice feature",event_scope:"mobile"};
if(decision(structuredBase,unrelatedFeature)!=="new")throw new Error("an unrelated feature from the same company was merged");

const paused={...structuredBase,event_stage:"paused",fact_slots:[{type:"status",scope:"API",value:"paused"}]};
if(decision(structuredBase,paused)!=="follow_up")throw new Error("a pause was not treated as progress");

const planned={...structuredBase,event_stage:"planned",event_at:"2026-06-20",fact_slots:[{type:"date",scope:"launch",value:"2026-06-20"}]};
const delayed={...planned,event_stage:"delayed",event_at:"2026-07-15",fact_slots:[{type:"date",scope:"launch",value:"2026-07-15"}]};
if(decision(planned,delayed)!=="follow_up")throw new Error("a delayed release date was not a follow-up");

const newerWeak={...unrelatedFeature,story_subject:"",story_entities:["OpenAI"],published_at:"2026-06-10T00:00:00Z",source_published_at:"2026-06-10T00:00:00Z"};
const best=context.findBestStoryMatch([structuredBase,newerWeak],republished);
if(!best||best.candidate.source_url!==structuredBase.source_url)throw new Error("latest weak match won over the best historical match");

// G10 adversarial regression matrix. These cases intentionally exercise the
// representation differences that real Japanese and translated news feeds use.
// Keep expected outcomes explicit so future classifier changes cannot silently
// reintroduce duplicates or suppress a genuine continuation.
const g10Failures=[];
const expectG10Decision=(label,expected,previous,current)=>{
  const actual=decision(previous,current);
  if(actual!==expected)g10Failures.push(`${label}: expected ${expected}, received ${actual}`);
};

const g10DuplicateBatch=[
  {...republished,source_url:"https://wire-c.example/openai-gpt5",published_at:"2026-06-03T00:00:00Z",source_published_at:"2026-06-03T00:00:00Z"},
  {...republished,source_url:"https://wire-d.example/openai-gpt5",published_at:"2026-06-04T00:00:00Z",source_published_at:"2026-06-04T00:00:00Z"}
];
const duplicateBatchResult=context.connectStoryTimeline(g10DuplicateBatch,[oldTimeline]);
if(duplicateBatchResult.length!==0){
  g10Failures.push(`duplicate-only batch: expected 0 published articles, received ${duplicateBatchResult.length}`);
}
const sameStableIdLegacy={...structuredBase,primary_entity:"",story_subject:"",event_type:"",event_stage:"",fact_slots:[],new_facts:[],enrichment_version:"legacy"};
const sameStableIdCurrent={...structuredBase,detail:"current structured version",enrichment_version:"ai-radar-2026-08-02-v7-structured-story-diff"};
const migrationVersions=context.connectStoryTimeline([sameStableIdLegacy,sameStableIdCurrent],[]);
const migrationById=new Map();
for(const item of migrationVersions){
  const key=item.article_id||context.stableArticleId(item);
  const existing=migrationById.get(key);
  const isCurrent=item.enrichment_version==="ai-radar-2026-08-02-v7-structured-story-diff";
  const existingIsCurrent=existing&&existing.enrichment_version==="ai-radar-2026-08-02-v7-structured-story-diff";
  if(!existing||(isCurrent&&!existingIsCurrent))migrationById.set(key,item);
}
if(migrationById.size!==1||[...migrationById.values()][0]?.detail!=="current structured version"){
  g10Failures.push(`legacy/current stable ID merge: expected one current structured article, received ${migrationById.size}`);
}

const g10Planned={
  ...structuredBase,event_stage:"planned",event_at:"2026-08-10",event_scope:"global",
  fact_slots:[{type:"date",scope:"launch",value:"2026-08-10"}]
};
const g10Delayed={
  ...g10Planned,event_stage:"delayed",event_at:"2026-08-20",source_url:"https://wire-b.example/gpt5-delay",
  fact_slots:[{type:"date",scope:"launch",value:"2026-08-20"}]
};
expectG10Decision("same-year scheduled date changed", "follow_up", g10Planned, g10Delayed);

const g10ScopeEnglish={
  ...structuredBase,fact_slots:[{type:"region",scope:"API availability",value:"Japan"}]
};
const g10ScopeJapanese={
  ...g10ScopeEnglish,source_url:"https://wire-b.example/gpt5-japan",
  fact_slots:[{type:"region",scope:"API提供範囲",value:"Japan"}]
};
expectG10Decision("fact scope wording changed", "duplicate", g10ScopeEnglish, g10ScopeJapanese);

const g10SeriesB={
  ...fundingUsd,story_subject:"Series B funding",event_scope:"Series B",
  title:"Example AI raises funding in Series B",
  fact_slots:[{type:"amount",scope:"Series B",value:"5億ドル"}]
};
const g10SeriesC={
  ...g10SeriesB,story_subject:"Series C funding",event_scope:"Series C",
  title:"Example AI raises funding in Series C",source_url:"https://wire-c.example/series-c",
  fact_slots:[{type:"amount",scope:"Series C",value:"5億ドル"}]
};
expectG10Decision("different Series B and Series C rounds", "new", g10SeriesB, g10SeriesC);

const g10StageRegression={...structuredBase,event_stage:"announced",source_url:"https://wire-b.example/gpt5-announced"};
expectG10Decision("stage wording regressed from launched to announced", "duplicate", structuredBase, g10StageRegression);

const g10Preview={
  ...structuredBase,primary_entity:"Google",story_entities:["Google","Gemini 3 Flash Preview"],
  story_subject:"Gemini 3 Flash Preview",title:"Google releases Gemini 3 Flash Preview",event_stage:"beta"
};
const g10GeneralAvailability={
  ...g10Preview,story_entities:["Google","Gemini 3 Flash"],story_subject:"Gemini 3 Flash",
  title:"Google launches Gemini 3 Flash",event_stage:"launched",source_url:"https://wire-b.example/gemini-flash-ga"
};
expectG10Decision("Preview became general availability", "follow_up", g10Preview, g10GeneralAvailability);

const g10DollarSymbol={
  ...fundingUsd,source_url:"https://wire-d.example/funding-dollar-symbol",
  fact_slots:[{type:"amount",scope:"Series C",value:"$1 billion"}]
};
expectG10Decision("10億ドル and $1 billion", "duplicate", fundingUsd, g10DollarSymbol);

const g10ThousandOku={
  ...fundingUsd,title:"Example AI raises 1千億円",fact_slots:[{type:"amount",scope:"Series C",value:"1千億円"}]
};
const g10OneThousandOku={
  ...g10ThousandOku,title:"Example AI raises 1000億円",source_url:"https://wire-e.example/funding-thousand-oku",
  fact_slots:[{type:"amount",scope:"Series C",value:"1000億円"}]
};
expectG10Decision("1千億円 and 1000億円", "duplicate", g10ThousandOku, g10OneThousandOku);

const g10RegionEnglish={...structuredBase,fact_slots:[{type:"region",scope:"API",value:"Japan"}]};
const g10RegionJapanese={
  ...g10RegionEnglish,source_url:"https://wire-b.example/gpt5-nihon",
  fact_slots:[{type:"region",scope:"API",value:"日本"}]
};
expectG10Decision("Japan and 日本", "duplicate", g10RegionEnglish, g10RegionJapanese);

const g10NewFactsOnly={
  ...structuredBase,source_url:"https://wire-b.example/gpt5-admin",
  new_facts:["企業向け管理機能が新たに追加された。"]
};
expectG10Decision("material progress present only in new_facts", "follow_up", structuredBase, g10NewFactsOnly);

const g10CorrectionSummaryOnly={
  ...structuredBase,source_url:"https://wire-b.example/gpt5-correction",
  change_summary:"対象地域の説明を日本から米国へ訂正した。"
};
expectG10Decision("correction present only in change_summary", "correction", structuredBase, g10CorrectionSummaryOnly);

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

// The structured fields are required by the production dedupe classifier. An
// otherwise complete AI response that omits them must be rejected or retried,
// never published as a legacy-shaped article.
context.callClaude=async()=>({
  text:JSON.stringify([{
    i:0,title_ja:"OpenAIがGPT-5を公開",summary_ja:"OpenAIはGPT-5をAPIで公開した。",
    detail_ja:"OpenAIはGPT-5をAPI経由で利用できるようにした。開発者は既存サービスへ組み込める。提供条件は公式情報で案内されている。",
    change_ja:"GPT-5がAPIで利用可能になった。",impact_ja:"開発者が新モデルを利用できる。",
    action_ja:"公式の利用条件を確認する。",event_date:"",event_status:"開始済み",
    story_entities:["OpenAI","GPT-5"],importance:"A",categories:["AIツール・モデル"]
  }]),
  stopReason:"end_turn",usage:{input_tokens:100,output_tokens:100}
});
const missingStructuredResult=await context.aiEnrichBatch([{
  tool:"OpenAI",title:"OpenAI launches GPT-5",raw_excerpt:"GPT-5 launched through the API.",
  source_url:"https://example.com/gpt5",source_name:"Example",
  published_at:"2026-06-01T00:00:00Z",source_published_at:"2026-06-01T00:00:00Z"
}]);
if(missingStructuredResult.items.length!==0||missingStructuredResult.rejected.length!==1){
  g10Failures.push("missing required structured fields: expected rejection or retry, received a published item");
}

if(g10Failures.length){
  throw new Error("G10 story regression failures:\n- "+g10Failures.join("\n- "));
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
