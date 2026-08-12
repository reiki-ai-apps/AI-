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
const important={id:"important",title:"Google DeepMindがCEO交代と研究体制を再編",importance:"S",published_at:new Date(now-6*86400000).toISOString()};
const merelyLatest={id:"latest",title:"小規模なUI更新",importance:"B",published_at:new Date(now-3600000).toISOString()};
if(context.pick([merelyLatest,important])?.id!=="important"){
  throw new Error("a merely newer article still displaces an industry-critical article");
}

const missedArticle=data.find(item=>item.article_id==="article_681923b6852fdf54e3b5");
if(!missedArticle||missedArticle.importance!=="S"||!missedArticle.source_url.includes("k-tai.watch.impress.co.jp")){
  throw new Error("the verified Google DeepMind leadership article is not published as an S article");
}
const currentTop=context.pick(data);
if(!currentTop||!['S','A'].includes(currentTop.importance)){
  throw new Error("the current global top story is not an industry-important article");
}

console.log("Global top-news selection and industry leadership coverage passed.");
