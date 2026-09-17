// Produce an inspectable patch, never write production data directly.
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../update.js',import.meta.url));
const source=fs.readFileSync('update.js','utf8');
const ctx={require,console,process,setTimeout,clearTimeout,URL,AbortController,AbortSignal,fetch};
vm.createContext(ctx);vm.runInContext(source.slice(0,source.indexOf('(async () => {')),ctx);
const {finalizeExpertVideoEdition,isFreshExpertVideo}=require('./scripts/expert-video.cjs');
const {publicationTextIssues}=require('./scripts/publication-quality.cjs');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const previous=read('data.json'),state=read('.expert-video-state.json'),history=read('.story-index.json');
const reviews=read(process.argv[2]).reviews,now=Date.now();
const registry=read('expert-sources.json');
const fresh=[];
for(const review of reviews){
  if((state.published_history||[]).some(x=>x.video_key===review.video_id))throw Error('already featured: '+review.video_id);
  const meta=await ctx.cachedYouTubeMetadata(review.source_url);
  const expert=registry.experts.find(x=>x.id===review.expert_id);
  if(!meta||!expert?.official_sources.some(x=>x.channel_id===meta.channelId)||meta.exactPublishedAt!==review.source_published_at)throw Error('source verification failed');
  const template=previous.find(x=>x.expert_id===review.expert_id);
  const item={...template,...review,source_title:meta.title,published_at:review.source_published_at,
    fetched_at:new Date(now).toISOString(),home_video_selected_at:'',context_source_url:review.source_url,
    story_entities:[expert.name],fact_slots:[],event_at:'',event_status:'不明',event_date_precision:'unknown'};
  for(const key of ['article_id','story_id','story_sequence','relation_type','relation_confidence','previous_article_id','previous_title','previous_source_published_at','continuation_lead','dedupe_decision','dedupe_reasons'])delete item[key];
  if(!isFreshExpertVideo(item,now)||publicationTextIssues(item).length)throw Error('publication quality failed');
  fresh.push(item);
}
const enriched=ctx.connectStoryTimeline(fresh,history.items);
if(enriched.length!==2)throw Error('need two distinct reviewed videos');
const result=finalizeExpertVideoEdition([...enriched,...previous],state,now,{refreshDue:true,attemptedSources:2,successfulSources:2,candidateCount:2});
if(result.state.status!=='published'||result.items.length>60)throw Error('invalid recovered edition');
result.state.last_manual_recovery_method='official_description_and_chapters_editorial_review';
const block=(v,n)=>JSON.stringify(v,null,2).split('\n').map(l=>' '.repeat(n)+l).join('\n');
const lines=(s,p)=>s.split('\n').map(l=>p+l).join('\n');
let patch='*** Begin Patch\n*** Update File: data.json\n@@\n [\n'+lines(result.items.slice(0,2).map(x=>block(x,2)+',').join('\n'),'+')+'\n';
previous.forEach((old,i)=>{
  const next=result.items[i+2];if(JSON.stringify(old)===JSON.stringify(next))return;
  const comma=i===previous.length-1?'':',';
  patch+='@@\n'+lines(block(old,2)+comma,'-')+'\n'+lines(block(next,2)+comma,'+')+'\n';
});
const indexItems=ctx.updateStoryIndex({version:1,items:[]},result.items.slice(0,2)).items;
patch+='*** Update File: .story-index.json\n@@\n   "items": [\n'+lines(indexItems.map(x=>block(x,4)+',').join('\n'),'+')+'\n';
patch+='*** Update File: .expert-video-state.json\n@@\n'+lines(JSON.stringify(state,null,2),'-')+'\n'+lines(JSON.stringify(result.state,null,2),'+')+'\n*** End Patch';
console.log(JSON.stringify({patch,selected:result.state.featured_video_keys,titles:enriched.map(x=>x.title)}));
