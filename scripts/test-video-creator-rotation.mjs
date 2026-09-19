import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {videoPublishedToday} from './run-scheduled-update.mjs';
const require=createRequire(import.meta.url);
const {rotationContext,allowedCreator}=require('./video-creator-rotation.cjs');
const {finalizeExpertVideoEdition,selectExpertVideoReviewCandidates,shouldRefreshExpertVideos}=require('./expert-video.cjs');
const now=Date.parse('2026-09-17T01:00:00Z');
const v=(id,person,extra={})=>({content_type:'expert_video',video_id:id,expert_id:person,
  source_date_status:'published',source_published_at:'2026-09-16T10:00:00Z',title:'AIの使い方を解説',...extra});
const old={last_published_day_jst:'2026-09-16',status:'published',featured_video_keys:['a0','b0'],
  published_history:[{day_jst:'2026-09-16',video_key:'c0',expert_id:'c'},
    {day_jst:'2026-09-16',video_key:'a0',expert_id:'a'},{day_jst:'2026-09-16',video_key:'b0',expert_id:'b'}]};
const candidates=[v('a1','a',{expert_tier:'practical_ai_educator'}),v('b1','b'),v('c1','c'),v('d1','d')];
assert.deepEqual(new Set(rotationContext(old,candidates,now).previous_edition_expert_ids),new Set(['a','b']));
assert.deepEqual(new Set(selectExpertVideoReviewCandidates(candidates,6,2,now,old).map(x=>x.expert_id)),new Set(['c','d']),'do not spend review slots on previous creators');
const today=finalizeExpertVideoEdition(candidates,old,now,{refreshDue:true});
assert.deepEqual(new Set(today.state.featured_expert_ids),new Set(['c','d']),'hard exclusion beats learning priority and score');
assert.equal(videoPublishedToday(today.state,today.items,now),true);
assert.deepEqual(new Set(today.state.published_editions[0].expert_ids),new Set(['c','d']));
const none=finalizeExpertVideoEdition(candidates.slice(0,2),old,now,{refreshDue:true});
assert.equal(none.state.featured_video_keys.length,2,'reviewed carryovers protect both slots when a new pair is unavailable');
assert.equal(none.items.filter(x=>x.home_video_origin==='continued').length,2);
assert.equal(videoPublishedToday(none.state,none.items,now),false,'carryovers are not a successful daily refresh');
assert.equal(shouldRefreshExpertVideos(none.state,now),true);
const partial=finalizeExpertVideoEdition([candidates[2]],old,now,{refreshDue:true});
const retried=finalizeExpertVideoEdition(candidates,partial.state,now+60000,{refreshDue:true});
assert.deepEqual(retried.state.previous_edition_expert_ids,partial.state.previous_edition_expert_ids,'partial retry freezes yesterday, not first pick today');
assert.deepEqual(retried.state.featured_expert_ids,['c','d']);
const tomorrow=finalizeExpertVideoEdition([...today.items,v('a2','a'),v('b2','b')],today.state,now+86400000,{refreshDue:true});
assert.deepEqual(new Set(tomorrow.state.featured_expert_ids),new Set(['a','b']));
assert.deepEqual(new Set(tomorrow.state.previous_edition_expert_ids),new Set(['c','d']));
assert.equal(rotationContext(today.state,[],now+3*86400000).previous_edition_day_jst,'2026-09-17','a missing day does not erase the last actual edition');
const legacy={...old,last_published_day_jst:'2026-09-17',featured_video_keys:['a1','b1'],
  published_history:[...old.published_history,{day_jst:'2026-09-17',video_key:'a1',expert_id:'a'},{day_jst:'2026-09-17',video_key:'b1',expert_id:'b'}]};
assert.equal(shouldRefreshExpertVideos(legacy,now),true,'already published legacy pair is not considered complete');
assert.equal(videoPublishedToday(legacy,candidates.map(x=>({...x,home_video_selected_at:new Date(now).toISOString()})),now),false);
assert.deepEqual(new Set(finalizeExpertVideoEdition(candidates,legacy,now,{refreshDue:true}).state.featured_expert_ids),new Set(['c','d']),'repair today without blocking an earlier replaced creator from yesterday');
assert.equal(allowedCreator(v('joint','c',{expert_ids:['c','a']}),rotationContext(old,[],now)),false,'co-presenter cannot bypass previous-creator ban');
const joint=finalizeExpertVideoEdition([v('one','c',{expert_ids:['c','d']}),v('two','d')],old,now,{refreshDue:true});
assert.equal(joint.state.featured_video_keys.length,1,'shared guest cannot occupy both slots');
const forgedJoint={...today.state,featured_video_keys:['one','two'],featured_video_key:'one'};
assert.equal(videoPublishedToday(forgedJoint,[v('one','c',{expert_ids:['c','d'],home_video_selected_at:new Date(now).toISOString()}),v('two','d',{home_video_selected_at:new Date(now).toISOString()})],now),false,'publication gate rejects a shared guest even when primary IDs differ');
assert.equal(allowedCreator(v('unknown',''),rotationContext(old,[],now)),false,'unidentified creator cannot evade the rule');
console.log('Previous-edition creator exclusion passed: selection, retries, migration, next day, gaps and co-presenters.');
