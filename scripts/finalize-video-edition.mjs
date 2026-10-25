import fs from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const {finalizeExpertVideoEdition,shouldRefreshExpertVideos,HOME_VIDEO_LIMIT}=require('./expert-video.cjs');

// Run after article validation as well as enrichment: removing one invalid
// candidate must not leave a public one-card edition. No network or AI calls.
export function repairVideoDisplay(items,state,now=Date.now()){
  const result=finalizeExpertVideoEdition(items,state,now,{refreshDue:shouldRefreshExpertVideos(state,now),
    attemptedSources:state.source_attempts,successfulSources:state.source_successes,candidateCount:state.fresh_candidate_count});
  // 2026-10-25 本人「毎日必ず内容を入れ替えて…」: 前の日の動画で2枠を埋めない。そろわない日は今日の分だけを載せる。
  if(result.state.featured_video_keys.length<HOME_VIDEO_LIMIT){
    console.log(`::warning::Video slots: ${result.state.featured_video_keys.length} of ${HOME_VIDEO_LIMIT}. No previous-day video is reused; retry at the next scheduled run.`);
  }
  if((result.state.repeated_from_previous_day_keys||[]).length){
    throw new Error('Video publication held: a video shown on a previous day was selected again.');
  }
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const items=JSON.parse(fs.readFileSync('data.json','utf8'));
  const state=JSON.parse(fs.readFileSync('.expert-video-state.json','utf8'));
  const result=repairVideoDisplay(items,state);
  fs.writeFileSync('data.json',JSON.stringify(result.items,null,2)+'\n');
  fs.writeFileSync('.expert-video-state.json',JSON.stringify(result.state,null,2)+'\n');
  console.log(`Video slots: ${result.state.featured_video_keys.length}; today's ${result.state.fresh_selected_count}; previous-day repeats 0; refresh ${result.state.status}`);
}
