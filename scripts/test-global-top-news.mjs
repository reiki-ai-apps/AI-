import fs from "node:fs";

const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const update=fs.readFileSync(new URL("../update.js",import.meta.url),"utf8");
const data=JSON.parse(fs.readFileSync(new URL("../data.json",import.meta.url),"utf8"));
const edition=JSON.parse(fs.readFileSync(new URL("../home-edition.json",import.meta.url),"utf8"));

for(const marker of [
  'name: "AI業界・経営重要速報"',
  'if(item.tool==="AI業界・経営重要速報")score+=34',
  'return "leadership"',
  '["policy","security","frontier","semiconductor","leadership"]',
  "主要AI企業・研究所のCEO交代"
]){
  if(!update.includes(marker))throw new Error(`industry-wide research safeguard missing: ${marker}`);
}

for(const marker of [
  "const selected=getUpdates().filter(item=>Number(item.home_top_rank)>=1",
  "const list=homeTopUpdates();",
  "前回更新後の新着を話題性・重要性で審査",
  "const feedList=cover?list.filter(item=>item.id!==cover.id).slice(0,4):list.slice(0,5)",
  "const nextId=String(homeTopUpdates()[0]?.id||'')"
]){
  if(!html.includes(marker))throw new Error(`global top-five contract missing: ${marker}`);
}

if(!/selected\.has\(u\.tool_id\)\|\|rankFromImportance\(u\.importance\)==='S'/.test(html)){
  throw new Error("S-ranked industry news can still disappear from the themed archive state");
}

const selected=data.filter(item=>Number(item.home_top_rank)>0).sort((a,b)=>a.home_top_rank-b.home_top_rank);
if(selected.length<1||selected.length>5)throw new Error(`home edition must contain 1-5 stories, got ${selected.length}`);
if(new Set(selected.map(item=>item.article_id)).size!==selected.length)throw new Error("home edition contains duplicate article IDs");
if(selected.some((item,index)=>item.home_top_rank!==index+1))throw new Error("home edition ranks are not consecutive from 1");
if(JSON.stringify(selected.map(item=>item.article_id))!==JSON.stringify(edition.article_ids)){
  throw new Error("published top-five order differs from the edition checkpoint");
}
if(selected.some(item=>!item.home_selected_at||!item.home_window_start||!item.home_window_end)){
  throw new Error("a selected story is missing its auditable edition window");
}

for(const marker of [
  'const TOP_STORY_REFRESH_MS=5*60000',
  'window.setInterval(refreshTopStoryIfNeeded,TOP_STORY_REFRESH_MS)',
  "document.addEventListener('visibilitychange',refreshTopStoryIfNeeded)",
  "activeTopStoryId=String(cover?.id||'')",
  'const RESYNC_STALE_MS=5*60000',
  'window.setInterval(resyncIfStale,5*60000)'
]){
  if(!html.includes(marker))throw new Error(`periodic edition refresh safeguard missing: ${marker}`);
}

console.log(`Global top-five selection and industry leadership coverage passed. Current #1: ${selected[0].title}`);
