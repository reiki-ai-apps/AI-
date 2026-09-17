import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {jstDayKey,isFreshExpertVideo,expertVideoKey,featuredVideoKeys,HOME_VIDEO_LIMIT}=require('./expert-video.cjs');
const {creatorIds,rotationContext,allowedCreator}=require('./video-creator-rotation.cjs');

export function videoPublishedToday(state,items,now=Date.now()){
  const today=jstDayKey(now);
  if(state?.status!=='published'||state.last_published_day_jst!==today||!Array.isArray(items))return false;
  const keys=featuredVideoKeys(state);
  const rotation=rotationContext(state,items,now);
  const selected=items.filter(item=>keys.includes(expertVideoKey(item))&&isFreshExpertVideo(item,now)&&
    Number.isFinite(Date.parse(item.home_video_selected_at))&&jstDayKey(Date.parse(item.home_video_selected_at))===today);
  const people=selected.flatMap(creatorIds);
  return selected.every(item=>allowedCreator(item,rotation))&&new Set(people).size===people.length&&
    new Set(selected.map(expertVideoKey)).size===HOME_VIDEO_LIMIT&&new Set(selected.map(item=>item.expert_id)).size===HOME_VIDEO_LIMIT;
}

// Retry within the same morning run, before public data is committed.
// Reuse update.js's persisted cache/usage ledger and existing daily spending caps.
export async function runScheduledUpdate({run,readState,readItems,now=Date.now,
  videoOnly=false,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),log=console.log}){
  if(videoOnly&&videoPublishedToday(readState(),readItems(),now())){
    log('Today has two verified videos; no extra AI call or article update.');return 0;
  }
  let code=1;
  for(let attempt=1;attempt<=3;attempt++){
    code=await run(attempt);
    const time=now(),day=jstDayKey(time);
    const inMorning=time>=Date.parse(day+'T05:17:00+09:00')&&time<Date.parse(day+'T12:00:00+09:00');
    if(!inMorning||videoPublishedToday(readState(),readItems(),time))return code;
    if(attempt===3)break;
    log('::warning::Morning video not yet published; retrying within this morning run ('+attempt+'/3).');
    await sleep(60000);
  }
  log('::warning::No new verified morning video after 3 attempts. Keep the last verified video without changing its publication date; retry at the next scheduled run.');
  return code||2;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const read=(file,fallback)=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}};
  process.exitCode=await runScheduledUpdate({
    videoOnly:process.env.AI_EXPERT_RETRY_ONLY==='1',
    run:attempt=>spawnSync(process.execPath,['update.js'],{stdio:'inherit',
      env:{...process.env,AI_EXPERT_RETRY_ONLY:process.env.AI_EXPERT_RETRY_ONLY==='1'||attempt>1?'1':'0'}}).status??1,
    readState:()=>read('.expert-video-state.json',{}),
    readItems:()=>read('data.json',[])
  });
}
