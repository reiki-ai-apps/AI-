import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {createRequire} from "node:module";
import {parsePlayerMetadata,mergeChannelVideos,parseOfficialEpisodeLinks} from "./youtube-publication.cjs";
const require=createRequire(new URL("../update.js",import.meta.url));
const now=Date.parse("2026-09-15T00:00:00Z");
const date="2026-09-10T09:00:00Z";
const payload={videoDetails:{videoId:"newvideo001",channelId:"trusted",shortDescription:"公式の完全な説明"},
 microformat:{playerMicroformatRenderer:{externalVideoId:"newvideo001",publishDate:date}}};
assert.equal(parsePlayerMetadata(payload,"newvideo001").exactPublishedAt,new Date(date).toISOString());
assert.equal(parsePlayerMetadata(payload,"wrongvideo1"),null);
assert.equal(parsePlayerMetadata({...payload,microformat:{playerMicroformatRenderer:{uploadDate:date}}},"newvideo001").exactPublishedAt,"","upload date is not substituted for missing publication evidence");
const merged=mergeChannelVideos([{videoId:"undated"},{videoId:"fresh",description:"page"}],[{videoId:"fresh",exactPublishedAt:date,description:"complete"}]);
assert.equal(merged[0].videoId,"fresh");assert.equal(merged[0].description,"complete");
assert.deepEqual(parseOfficialEpisodeLinks('<a href="/articles/withbloomberg/123">AI開発 <b>岡野原</b></a><a href="https://evil.example/articles/withbloomberg/999">AI</a>',"https://newsdig.tbs.co.jp/list/withbloomberg").map(x=>x.url),["https://newsdig.tbs.co.jp/articles/withbloomberg/123"]);

const source=fs.readFileSync(new URL("../update.js",import.meta.url),"utf8").replace(/\r\n?/g,"\n");
const context={require,console:{log(){},error(){}},process,setTimeout,clearTimeout,URL,AbortController,AbortSignal,fetch};
vm.createContext(context);vm.runInContext(source.slice(0,source.indexOf("(async () => {")),context);
const guestRegistry={experts:[{id:'anno',name:'安野貴博'}]};
const guestSource={allowed_experts:['anno'],attribution_scope:'title_and_chapters'};
assert.equal(context.matchedVideoExperts({title:'他の人のAI解説',description:'チャンネル代表：安野貴博'},guestSource,guestRegistry).length,0,'channel boilerplate is not evidence that a person appears');
assert.equal(context.matchedVideoExperts({title:'安野貴博がAIを解説',description:''},guestSource,guestRegistry).length,1);
const expert={id:"test-expert",name:"専門家",tier:"core_research",official_sources:[{platform:"youtube",channel_id:"trusted",trust:"primary"}]};
const registry={experts:[expert],trusted_hosts:[],web_discovery:{enabled:false}};
context.fetchText=async url=>{
 if(url.includes("/feeds/"))return '<feed><entry><yt:videoId>newvideo001</yt:videoId><title>AI研究を解説</title><published>'+date+'</published><media:description>公式の説明</media:description></entry></feed>';
 throw Error("page unavailable");
};
let result=await context.collectExpertVideoCandidates(registry,new Date(now).toISOString());
assert.equal(result.items.length,1,"a page failure must not skip a working RSS");
const cards=["oldvideo001","oldvideo002","oldvideo003","oldvideo004","newvideo001","wrongvideo1"];
const page=cards.map(id=>JSON.stringify({richItemRenderer:{content:{videoRenderer:{videoId:id,title:{simpleText:"AI研究を解説"}}}}})).join(",");
context.fetchText=async url=>{if(url.includes("/feeds/"))throw Error("RSS unavailable");return page;};
context.cachedYouTubeMetadata=async url=>url.endsWith("newvideo001")?parsePlayerMetadata(payload,"newvideo001"):
 url.includes("oldvideo")?{...parsePlayerMetadata(payload,"newvideo001"),exactPublishedAt:"2026-08-01T00:00:00Z"}:
 {...parsePlayerMetadata(payload,"newvideo001"),channelId:"imposter"};
result=await context.collectExpertVideoCandidates(registry,new Date(now).toISOString());
assert.equal(result.items.length,1,"old cards cannot fill fresh slots; wrong channel cannot recover dates");
assert.equal(result.items[0].video_id,"newvideo001");

const selection=source.slice(source.indexOf("  const reused=[];"),source.indexOf("  fresh.sort((a,b)=>candidateScore(b)-candidateScore(a));")+ "  fresh.sort((a,b)=>candidateScore(b)-candidateScore(a));".length);
const select=Function("expertRetryOnly","filteredOut","expertVideoState","cacheEntryFor","isExpertVideoItem","findReusablePrevious","previous","cache","PROMPT_VERSION","bootstrapCacheResult","candidateScore","RETRY_TTL_MS",selection+";return fresh;");
const fixtures=[{video_id:"seen",content_type:"expert_video",status:"retry"},{video_id:"new",content_type:"expert_video",status:"retry"},{video_id:"rejected",content_type:"expert_video",status:"rejected"},{video_id:"article",status:"retry"}];
const args=[fixtures,{featured_video_key:"seen"},x=>({status:x.status,processed_at:new Date().toISOString()}),x=>x.content_type==="expert_video",()=>null,[],{},"v1",()=>{},()=>0,90*60000];
assert.equal(select(false,...args).length,0);
assert.deepEqual(select(true,...args).map(x=>x.video_id),["new"],"bounded morning retries bypass only transient expert retry cache, not rejections or already featured videos");
console.log("Video discovery recovery passed: exact dates, missing RSS/page, fresh slots, official index and effective retries.");
