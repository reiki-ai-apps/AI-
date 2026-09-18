import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {videoPublishedToday} from './run-scheduled-update.mjs';
const require=createRequire(import.meta.url);
const {matchedExpertsForSource,finalizeExpertVideoEdition,isFreshExpertVideo}=require('./expert-video.cjs');
const {publicationTextIssues}=require('./publication-quality.cjs');
const registry=JSON.parse(fs.readFileSync('expert-sources.json','utf8'));
const reviews=JSON.parse(fs.readFileSync('docs/video-reviews-20260918.json','utf8')).reviews;
const now=Date.parse('2026-09-18T05:00:00Z');
const pivot=registry.trusted_hosts.find(x=>x.id==='pivot-official');
const tbs=registry.trusted_hosts.find(x=>x.id==='tbs-crossdig-official');
assert.deepEqual(matchedExpertsForSource('Clay Bavor クレイ・バヴォア 森川馨太',pivot,registry).map(x=>x.id),['clay-bavor','keita-morikawa']);
assert.deepEqual(matchedExpertsForSource('newmo 曾川 景介',tbs,registry).map(x=>x.id),['keisuke-sogawa']);
const items=reviews.map(x=>({...x,content_type:'expert_video',source_date_status:'published',
  expert_ids:x.expert_id==='clay-bavor'?['clay-bavor','keita-morikawa']:[x.expert_id]}));
for(const item of items){assert.ok(isFreshExpertVideo(item,now));assert.deepEqual(publicationTextIssues(item),[]);}
const pending={status:'pending_no_new_publishable_video',last_published_day_jst:'2026-09-17',featured_video_keys:[],
  rotation_day_jst:'2026-09-18',previous_edition_day_jst:'2026-09-17',previous_edition_expert_ids:['shota-imai','takahiro-anno'],published_history:[]};
const result=finalizeExpertVideoEdition(items,pending,now,{refreshDue:true});
assert.equal(videoPublishedToday(result.state,result.items,now),true);
assert.equal(result.state.featured_video_keys.length,2);
assert.deepEqual(result.state.previous_edition_expert_ids,['shota-imai','takahiro-anno']);
const retry=finalizeExpertVideoEdition(result.items,result.state,now+60000,{refreshDue:true});
assert.deepEqual(retry.state.featured_video_keys,result.state.featured_video_keys);
assert.equal(retry.state.last_published_at,result.state.last_published_at);
console.log('September 18 recovery passed: attribution, co-presenters, age, readability, two picks and same-day preservation.');
