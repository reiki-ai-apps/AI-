import fs from "node:fs";
import vm from "node:vm";

const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const update=fs.readFileSync(new URL("../update.js",import.meta.url),"utf8");
const data=JSON.parse(fs.readFileSync(new URL("../data.json",import.meta.url),"utf8"));

function functionSource(source,name){
  const start=source.indexOf(`function ${name}(`);
  if(start<0)throw new Error(`${name} was not found`);
  const brace=source.indexOf("{",start);
  let depth=0;
  for(let index=brace;index<source.length;index++){
    if(source[index]==="{")depth++;
    if(source[index]==="}"&&--depth===0)return source.slice(start,index+1);
  }
  throw new Error(`${name} is incomplete`);
}

for(const marker of [
  'name: "AI業界・経営重要速報"',
  'if(item.tool==="AI業界・経営重要速報")score+=34',
  'return "leadership"',
  '["policy","security","frontier","semiconductor","leadership"]',
  "主要AI企業・研究所のCEO交代"
]){
  if(!update.includes(marker))throw new Error(`industry-wide research safeguard missing: ${marker}`);
}

if(!/const cover=selectLatestCover\(allUpdates\)/.test(html)){
  throw new Error("top news is not selected from all articles independently of user themes");
}
if(!/selected\.has\(u\.tool_id\)\|\|rankFromImportance\(u\.importance\)==='S'/.test(html)){
  throw new Error("S-ranked industry news can still disappear from a themed home feed");
}
if(!html.includes("テーマ設定に関係なく重要度で選定")){
  throw new Error("top-news importance policy is not communicated in the UI");
}

const context={Date};
vm.runInNewContext(`
  function validArticleDate(value){const time=new Date(value||"").getTime();return Number.isFinite(time)?time:0;}
  function articleTimelineAt(item){return item?.published_at||item?.source_published_at||item?.fetched_at||"";}
  function rankFromImportance(value){const rank=String(value||"").trim().toUpperCase();return ["S","A","B","C"].includes(rank)?rank:"";}
  ${functionSource(html,"globalCoverScore")}
  ${functionSource(html,"selectLatestCover")}
  globalThis.pick=selectLatestCover;
`,context);

const now=Date.now();
const staleCritical={id:"stale-critical",title:"Google DeepMindがCEO交代と研究体制を再編",importance:"S",published_at:new Date(now-47*3600000).toISOString()};
const freshImportant={id:"fresh-important",title:"OpenAIが重要な新モデルを公開",importance:"A",published_at:new Date(now-6*3600000).toISOString()};
if(context.pick([staleCritical,freshImportant],now)?.id!=="fresh-important"){
  throw new Error("an older S article still prevents the daily top story from updating");
}
const recentCritical={id:"recent-critical",title:"Google DeepMindがCEO交代と研究体制を再編",importance:"S",published_at:new Date(now-18*3600000).toISOString()};
const merelyLatest={id:"latest",title:"小規模なUI更新",importance:"B",published_at:new Date(now-3600000).toISOString()};
if(context.pick([merelyLatest,recentCritical],now)?.id!=="recent-critical"){
  throw new Error("a minor update displaces an industry-critical article inside the fresh window");
}
const newestImportant={id:"newest-important",title:"NVIDIAが大型AI投資を発表",importance:"A",published_at:new Date(now-2*3600000).toISOString()};
const olderCritical={id:"older-critical",title:"OpenAIが経営体制を再編",importance:"S",published_at:new Date(now-8*3600000).toISOString()};
if(context.pick([olderCritical,newestImportant],now)?.id!=="newest-important"){
  throw new Error("the newest important article does not replace an older high-scoring article");
}
const olderImportant={id:"older-important",title:"重要な業界再編",importance:"S",published_at:new Date(now-6*86400000).toISOString()};
const olderMinor={id:"older-minor",title:"小規模な変更",importance:"B",published_at:new Date(now-5*86400000).toISOString()};
if(context.pick([olderMinor,olderImportant],now)?.id!=="older-important"){
  throw new Error("importance fallback fails when there is no news in the fresh windows");
}

const missedArticle=data.find(item=>item.article_id==="article_681923b6852fdf54e3b5");
if(!missedArticle||missedArticle.importance!=="S"||!missedArticle.source_url.includes("k-tai.watch.impress.co.jp")){
  throw new Error("the verified Google DeepMind leadership article is not published as an S article");
}
const currentTop=context.pick(data,now);
const hasFreshData=data.some(item=>{
  const time=new Date(item.published_at||item.source_published_at||item.fetched_at||'').getTime();
  return Number.isFinite(time)&&time>=now-24*3600000;
});
const currentTopTime=new Date(currentTop?.published_at||currentTop?.source_published_at||currentTop?.fetched_at||'').getTime();
if(!currentTop||hasFreshData&&currentTopTime<now-24*3600000){
  throw new Error("the current global top story is stale despite fresh published data");
}
const newestPublishedImportant=data
  .filter(item=>['S','A'].includes(String(item.importance||'').toUpperCase()))
  .filter(item=>{
    const time=new Date(item.published_at||item.source_published_at||item.fetched_at||'').getTime();
    return Number.isFinite(time)&&time>=now-24*3600000;
  })
  .sort((a,b)=>new Date(b.published_at||b.source_published_at||b.fetched_at)-new Date(a.published_at||a.source_published_at||a.fetched_at))[0];
if(newestPublishedImportant&&currentTop?.article_id!==newestPublishedImportant.article_id){
  throw new Error("the live top story is not the newest published S/A article");
}
for(const marker of [
  'const TOP_STORY_REFRESH_MS=5*60000',
  'window.setInterval(refreshTopStoryIfNeeded,TOP_STORY_REFRESH_MS)',
  "document.addEventListener('visibilitychange',refreshTopStoryIfNeeded)",
  "activeTopStoryId=String(cover?.id||'')",
  'const RESYNC_STALE_MS=5*60000',
  'window.setInterval(resyncIfStale,5*60000)'
]){
  if(!html.includes(marker))throw new Error(`periodic top-story refresh safeguard missing: ${marker}`);
}

console.log(`Global top-news selection and industry leadership coverage passed. Current: ${currentTop.title}`);
