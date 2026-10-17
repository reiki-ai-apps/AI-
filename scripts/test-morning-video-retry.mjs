import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {runScheduledUpdate,videoPublishedToday} from './run-scheduled-update.mjs';
const {selectDailyExpertVideoArchivePicks}=createRequire(import.meta.url)('./expert-video.cjs');
const morning=Date.parse('2026-09-12T20:17:00Z');
const state={status:'published',last_published_day_jst:'2026-09-13',featured_video_key:'new-video',featured_video_keys:['new-video','second-video']};
const item={content_type:'expert_video',video_id:'new-video',expert_id:'a',source_date_status:'published',
  source_published_at:'2026-09-12T10:00:00Z',home_video_selected_at:new Date(morning).toISOString()};
assert.equal(videoPublishedToday(state,[item,{...item,video_id:'second-video',expert_id:'b'}],morning),true);
assert.equal(videoPublishedToday(state,[],morning),false,'state alone does not prove a new video is published');
assert.equal(videoPublishedToday(state,[{...item,video_id:'yesterday'}],morning),false);
assert.equal(videoPublishedToday(state,[{...item,home_video_selected_at:'2026-09-11T22:00:00Z'}],morning),false);
assert.equal(videoPublishedToday(state,[{...item,source_published_at:'2026-09-01T10:00:00Z'}],morning),false);
{
  const old=[1,2,3].map(n=>({...item,video_id:'old-'+n,expert_id:'expert-'+n}));
  const unseen={...item,video_id:'unseen',expert_id:'expert-4',source_published_at:'2026-09-11T10:00:00Z'};
  const history={published_history:old.map(i=>({video_key:i.video_id})),featured_video_key:'old-1',last_published_day_jst:'2026-09-12'};
  const picks=selectDailyExpertVideoArchivePicks([...old,unseen],history,3,morning);
  assert.equal(picks.length,3);assert.equal(picks[0].video_id,'unseen','archive cap must not discard the next unseen video');
  const locked=selectDailyExpertVideoArchivePicks([...old,unseen],{...history,last_published_day_jst:'2026-09-13',featured_video_key:'unseen'},3,morning);
  assert.equal(locked[0].video_id,'unseen','keep today selection stable in later editions');
}
{
  const source=fs.readFileSync(new URL('../update.js',import.meta.url),'utf8');
  const expression=source.match(/const publicationReadyFinal=([\s\S]*?);/)?.[1];
  assert.ok(expression);
  const context={require:createRequire(new URL('../update.js',import.meta.url)),console,process,setTimeout,clearTimeout,URL,AbortController,fetch};
  vm.createContext(context);
  vm.runInContext(source.slice(0,source.indexOf('(async () => {')),context);
  const prepare=(previous,final,expertRetryOnly=true,expertVideoState={})=>{
    Object.assign(context,{previous,final,expertRetryOnly,expertVideoState,editionNow:morning});
    return vm.runInContext(expression,context);
  };
  const news={article_id:'news',content_type:'article',home_top_rank:1,detail:'keep exact'};
  const result=prepare([news,{content_type:'expert_video',video_id:'old'}],[{content_type:'article',detail:'must not replace news'},item]);
  assert.equal(result[0],news,'video-only retry preserves prepared article objects unchanged');
  assert.equal(result.length,2);assert.equal(result[1].video_id,item.video_id);

  const articles=count=>Array.from({length:count},(_,i)=>({...news,article_id:'news-'+i,home_top_rank:i<5?i+1:0}));
  const videos=count=>Array.from({length:count},(_,i)=>({...item,video_id:'video-'+i,expert_id:'expert-'+i,title:'Video '+i}));
  // Reproduce the failure: an already capped final pool can contain more videos
  // than will fit once the previous 49 news articles are restored (49 + 12 = 61).
  for(const [newsCount,videoCount,expected] of [[48,11,59],[49,11,60],[49,12,60],[58,12,60],[59,12,60],[60,12,60],[49,0,49]]){
    const previous=articles(newsCount);
    const final=[...articles(60-videoCount),...videos(videoCount)];
    assert.equal(final.length,60,'the upstream selector already respected its cap');
    const before=JSON.stringify({previous,final});
    const ready=prepare(previous,final);
    assert.equal(ready.length,expected,`${newsCount} retained news + ${videoCount} selected videos`);
    previous.forEach((article,i)=>assert.equal(ready[i],article,'preserve every prepared article and its rank'));
    assert.equal(ready.filter(value=>value.content_type==='expert_video').length,Math.min(videoCount,60-newsCount));
    assert.equal(JSON.stringify({previous,final}),before,'selection must not mutate either input');
  }

  // At the two-slot boundary, retain today's reviewed pair even when they are
  // last in the array; a blind slice could discard both home video selections.
  const candidates=videos(12);
  const selectedState={...state,featured_video_key:'video-10',featured_video_keys:['video-10','video-11'],
    published_history:[10,11].map(i=>({day_jst:'2026-09-13',video_key:'video-'+i,expert_id:'expert-'+i}))};
  const ready=prepare(articles(58),[...articles(48),...candidates],true,selectedState);
  assert.deepEqual(new Set(ready.filter(value=>value.content_type==='expert_video').map(value=>value.video_id)),new Set(['video-10','video-11']));
  const {finalizeExpertVideoEdition}=createRequire(import.meta.url)('./expert-video.cjs');
  const finalized=finalizeExpertVideoEdition(ready,selectedState,morning,{refreshDue:false});
  assert.equal(finalized.items.length,60,'video finalization must not exceed the publication cap');
  assert.deepEqual(new Set(finalized.state.featured_video_keys),new Set(['video-10','video-11']));
  assert.equal(prepare(finalized.items,finalized.items,true,finalized.state).length,60,'repeated retries remain capped');

  const regular=prepare(articles(60),[...articles(48),...candidates],false);
  assert.equal(regular.length,60,'regular editions keep their selected pool');
  assert.equal(regular.filter(value=>value.content_type==='expert_video').length,12);
  assert.throws(()=>prepare(articles(61),candidates),/publication cap/i,'invalid oversized news input must fail instead of silently deleting prepared articles');
}
for(const [label,time,succeedAt,expected] of [
  ['success first time',morning,1,1],['transient failure recovers in morning',morning,2,2],
  ['no new eligible video',morning,99,3],['already afternoon',morning+8*3600000,99,1],
  ['before preparation time',morning-1,99,1]
]){
  let calls=0,waits=0;
  const result=await runScheduledUpdate({
    run:async attempt=>{calls++;assert.equal(attempt,calls);return calls>=succeedAt?0:1;},
    readState:()=>calls>=succeedAt?state:{status:'pending_no_new_publishable_video'},
    readItems:()=>calls>=succeedAt?[item,{...item,video_id:'second-video',expert_id:'b'}]:[],now:()=>time,
    sleep:async ms=>{assert.equal(ms,60000);waits++;},log:()=>{}
  });
  assert.equal(calls,expected,label);assert.equal(waits,expected-1,label);
  assert.equal(result,calls>=succeedAt?0:1);
}
console.log('Morning video retry tests passed: early start, bounded same-run recovery, verified publication and no false success.');
