import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {capPublishedEdition}=require('./publication-cap.cjs');

const items=Array.from({length:61},(_,index)=>({article_id:`article-${index}`,content_type:'article',
  importance:index===8?'C':'B',published_at:new Date(Date.UTC(2026,9,1)+index*3600000).toISOString(),
  home_top_rank:index<5?index+1:0}));
items[5]={...items[5],content_type:'expert_video',video_id:'video-a',home_video_origin:'new',home_video_selected_at:'2026-10-17T00:00:00Z'};
items[6]={...items[6],content_type:'expert_video',video_id:'video-b',home_video_origin:'continued',home_video_selected_at:'2026-10-16T00:00:00Z'};
const result=capPublishedEdition(items,{featuredVideoKeys:['video-a','video-b']});
assert.equal(result.items.length,60);
assert.deepEqual(result.dropped,['article-8'],'only the lowest-priority unfeatured article is removed');
assert.deepEqual(result.items.slice(0,7),items.slice(0,7),'home news and both videos keep their positions');
assert.deepEqual(capPublishedEdition(items.slice(0,60)).items,items.slice(0,60),'already valid editions are unchanged');
assert.throws(()=>capPublishedEdition(items,{limit:6,featuredVideoKeys:['video-a','video-b']}),/Protected home items exceed/);
const updateSource=fs.readFileSync(new URL('../update.js',import.meta.url),'utf8');
assert.match(updateSource,/capPublishedEdition\(videoEdition\.items/,'bound the final video edition before publishing');
assert.match(updateSource,/writeJsonFile\("data\.json",editionReadyFinal\)/,'only the bounded edition is written');
console.log('Publication cap passed: 61 to 60, home five and two videos preserved.');
