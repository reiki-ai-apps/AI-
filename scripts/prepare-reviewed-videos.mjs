// Produce an inspectable patch, never write production data directly.
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../update.js',import.meta.url));
const source=fs.readFileSync('update.js','utf8');
const ctx={require,console,process,setTimeout,clearTimeout,URL,AbortController,AbortSignal,fetch};
vm.createContext(ctx);vm.runInContext(source.slice(0,source.indexOf('(async () => {')),ctx);
const {finalizeExpertVideoEdition,isFreshExpertVideo,isExpertVideoItem,selectDailyExpertVideoArchivePicks}=require('./scripts/expert-video.cjs');
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
  const official=expert?.official_sources.find(x=>x.channel_id===meta?.channelId);
  const host=registry.trusted_hosts.find(x=>x.channel_id===meta?.channelId);
  const verifiedSource=official?{...official,expert_id:expert.id}:host;
  const attributed=meta&&verifiedSource?ctx.matchedVideoExperts(meta,verifiedSource,registry):[];
  if(!expert||!attributed.some(x=>x.id===expert.id)||meta.exactPublishedAt!==review.source_published_at)throw Error('source verification failed');
  const base=ctx.expertVideoRecord(expert,verifiedSource,{...meta,link:review.source_url,experts:attributed},new Date(now).toISOString());
  const item={...base,...review,source_title:meta.title,published_at:review.source_published_at,
    importance:'A',primary_entity:expert.name,event_type:'other',event_stage:'other',event_scope:'YouTube公式動画',
    structured_complete:true,enrichment_version:vm.runInContext('PROMPT_VERSION',ctx),
    expert_context_basis:'official_description_and_chapters_editorial_review',
    context_source_name:base.source_name+'の公式説明・チャプター',
    context_source_note:'公式説明と目次から、動画で学べる内容を編集しています。動画全編や文字起こしを確認した要約ではなく、個別の実演結果や発言の結論は推測していません。',
    fetched_at:new Date(now).toISOString(),home_video_selected_at:'',context_source_url:review.source_url,
    story_entities:[expert.name],fact_slots:[],event_at:'',event_status:'不明',event_date_precision:'unknown'};
  for(const key of ['article_id','story_id','story_sequence','relation_type','relation_confidence','previous_article_id','previous_title','previous_source_published_at','continuation_lead','dedupe_decision','dedupe_reasons'])delete item[key];
  if(!isFreshExpertVideo(item,now)||publicationTextIssues(item).length)throw Error('publication quality failed: '+JSON.stringify(publicationTextIssues(item)));
  fresh.push(item);
}
const enriched=ctx.connectStoryTimeline(fresh,history.items);
if(enriched.length!==2)throw Error('need two distinct reviewed videos');
const combined=[...enriched,...previous];
const articleCount=previous.filter(x=>!isExpertVideoItem(x)).length;
const videoIds=new Set(selectDailyExpertVideoArchivePicks(combined.filter(isExpertVideoItem),state,60-articleCount,now).map(x=>x.article_id));
const result=finalizeExpertVideoEdition(combined.filter(x=>!isExpertVideoItem(x)||videoIds.has(x.article_id)),state,now,{refreshDue:true,attemptedSources:2,successfulSources:2,candidateCount:2});
if(result.state.status!=='published'||result.items.length>60)throw Error('invalid recovered edition');
result.state.last_manual_recovery_method='official_description_and_chapters_editorial_review';
const block=(v,n)=>JSON.stringify(v,null,2).split('\n').map(l=>' '.repeat(n)+l).join('\n');
const lines=(s,p)=>s.split('\n').map(l=>p+l).join('\n');
let patch='*** Begin Patch\n*** Update File: data.json\n@@\n [\n'+lines(result.items.slice(0,2).map(x=>block(x,2)+',').join('\n'),'+')+'\n';
previous.forEach((old,i)=>{
  const next=result.items.find(x=>x.article_id===old.article_id);
  const comma=i===previous.length-1?'':',',nextComma=next===result.items.at(-1)?'':',';
  if(JSON.stringify(old)===JSON.stringify(next)&&comma===nextComma)return;
  patch+='@@\n'+lines(block(old,2)+comma,'-')+'\n'+(next?lines(block(next,2)+nextComma,'+')+'\n':'');
});
const indexItems=ctx.updateStoryIndex({version:1,items:[]},result.items.slice(0,2)).items;
patch+='*** Update File: .story-index.json\n@@\n   "items": [\n'+lines(indexItems.map(x=>block(x,4)+',').join('\n'),'+')+'\n';
patch+='*** Update File: .expert-video-state.json\n@@\n'+lines(JSON.stringify(state,null,2),'-')+'\n'+lines(JSON.stringify(result.state,null,2),'+')+'\n*** End Patch';
console.log(JSON.stringify({patch,selected:result.state.featured_video_keys,titles:enriched.map(x=>x.title),retired:previous.filter(x=>!result.items.some(y=>y.article_id===x.article_id)).map(x=>x.article_id)}));
