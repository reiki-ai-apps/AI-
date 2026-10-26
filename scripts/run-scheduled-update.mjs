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
  const selected=items.filter(item=>keys.includes(expertVideoKey(item))&&item.home_video_origin!=='continued'&&isFreshExpertVideo(item,now)&&
    Number.isFinite(Date.parse(item.home_video_selected_at))&&jstDayKey(Date.parse(item.home_video_selected_at))===today);
  const people=selected.flatMap(creatorIds);
  return selected.every(item=>allowedCreator(item,rotation))&&new Set(people).size===people.length&&
    new Set(selected.map(expertVideoKey)).size===HOME_VIDEO_LIMIT&&new Set(selected.map(item=>item.expert_id)).size===HOME_VIDEO_LIMIT;
}

// 2026-10-25 本人「毎日必ず内容を入れ替えて…絶対に崩さないで」: その日（日本時間）の記事の版がまだ無ければ、
// 動画だけの再確認の回でも記事を作る。GitHub が朝・昼の定期実行を飛ばした日も、その日のうちに入れ替える。
// 2026-10-27: 夜中の回が今日の版を0件で作ると、朝の見回りの回が「今日の版はある」と見て記事を作らず、朝のホームが空のままだった。
// 今日の版でも3件に満たなければ、見回りの回でも記事を探し直す（前の日の記事で埋めない決まりはそのまま）。
export function articlesDueToday(edition,now=Date.now()){
  const editionDay=String(edition?.edition_day_jst||'')||(Number.isFinite(Date.parse(edition?.last_checked_at))?jstDayKey(Date.parse(edition.last_checked_at)):'');
  if(editionDay!==jstDayKey(now))return true;
  return Array.isArray(edition?.article_ids)&&edition.article_ids.length<3;
}

// Retry within the same morning run, before public data is committed.
// Reuse update.js's persisted cache/usage ledger and existing daily spending caps.
export async function runScheduledUpdate({run,readState,readItems,now=Date.now,shouldRetry=()=>true,
  videoOnly=false,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),log=console.log}){
  if(videoOnly&&videoPublishedToday(readState(),readItems(),now())){
    log('Today has two verified videos; no extra AI call or article update.');return 0;
  }
  let code=1;let articleCode=null;
  for(let attempt=1;attempt<=3;attempt++){
    code=await run(attempt);
    if(attempt===1&&!videoOnly)articleCode=code;
    if(!shouldRetry()){
      log('::warning::AI service needs owner action; do not repeat requests in this run.');
      return code||1;
    }
    const time=now(),day=jstDayKey(time);
    const inMorning=time>=Date.parse(day+'T05:17:00+09:00')&&time<Date.parse(day+'T12:00:00+09:00');
    if(!inMorning||videoPublishedToday(readState(),readItems(),time))return articleCode===0?0:code;
    if(attempt===3)break;
    log('::warning::Morning video not yet published; retrying within this morning run ('+attempt+'/3).');
    await sleep(60000);
  }
  if(articleCode===0){
    // 動画が見つからないだけで、作り終えたその日の記事を捨てない（10/25 朝は2回とも記事ごと捨てていた）。
    log("::warning::No new verified morning video after 3 attempts. Publish today's articles; never reuse a previous-day video. Retry videos at the next scheduled run.");
    return 0;
  }
  log('::warning::No new verified morning video after 3 attempts. Retry at the next scheduled run.');
  return code||2;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const read=(file,fallback)=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}};
  const {classifyUpdateFailure,makeUpdateHealth}=await import('./update-health.mjs');
  let failure='';
  const videoOnly=process.env.AI_EXPERT_RETRY_ONLY==='1'&&!articlesDueToday(read('home-edition.json',{}));
  if(process.env.AI_EXPERT_RETRY_ONLY==='1'&&!videoOnly)console.log("::warning::Today has no article edition yet; this recovery run builds today's articles too.");
  if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,'full_update='+(videoOnly?'false':'true')+'\n');
  process.exitCode=await runScheduledUpdate({
    videoOnly,
    run:attempt=>{
      const result=spawnSync(process.execPath,['update.js'],{encoding:'utf8',maxBuffer:32*1024*1024,
        env:{...process.env,AI_EXPERT_RETRY_ONLY:videoOnly||attempt>1?'1':'0'}});
      process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
      failure=classifyUpdateFailure((result.stdout||'')+'\n'+(result.stderr||''));
      return result.status??1;
    },
    shouldRetry:()=>!['credit_required','credentials_required'].includes(failure),
    readState:()=>read('.expert-video-state.json',{}),
    readItems:()=>read('data.json',[])
  });
  fs.writeFileSync('update-health.json',JSON.stringify(makeUpdateHealth({
    code:process.exitCode,failure,edition:read('home-edition.json',{}),video:read('.expert-video-state.json',{})
  }),null,2)+'\n');
}
