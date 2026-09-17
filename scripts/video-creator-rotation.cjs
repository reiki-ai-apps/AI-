'use strict';
const day=now=>new Date(Number(now)+9*3600000).toISOString().slice(0,10);
const keys=state=>[...new Set([...(state.featured_video_keys||[]),state.featured_video_key].filter(Boolean))];
function creatorIds(item={}){
  return [...new Set([item.expert_id,...(Array.isArray(item.expert_ids)?item.expert_ids:[])].filter(Boolean).map(String))];
}
function rotationContext(state={},items=[],now=Date.now()){
  const today=day(now);
  // Freeze the previous edition throughout the day's partial retries and replacements.
  if(state.rotation_day_jst===today&&Array.isArray(state.previous_edition_expert_ids))return {
    rotation_day_jst:today,previous_edition_day_jst:state.previous_edition_day_jst||'',
    previous_edition_expert_ids:[...new Set(state.previous_edition_expert_ids)]
  };
  const history=state.published_history||[],editions=state.published_editions||[];
  const dates=[...history,...editions,{day_jst:state.last_published_day_jst}].map(x=>x.day_jst)
    .filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x||'')&&x<today).sort();
  const previousDay=dates.at(-1)||'';
  const known=new Map([...history,...items.map(x=>({...x,video_key:x.video_id||x.source_url||x.article_id}))].map(x=>[x.video_key,x]));
  const snapshot=editions.findLast(x=>x.day_jst===previousDay);
  let ids=snapshot?.expert_ids||[];
  if(!ids.length&&state.last_published_day_jst===previousDay){
    ids=[...(state.featured_expert_ids||[]),...keys(state).flatMap(k=>creatorIds(known.get(k)))];
  }
  if(!ids.length&&previousDay){
    // v3 migration: use the final two different creators that day, not every replaced pick.
    const last=[];const people=new Set();
    for(const entry of [...history].reverse().filter(x=>x.day_jst===previousDay)){
      const resolved=creatorIds(entry).length?creatorIds(entry):creatorIds(known.get(entry.video_key));
      if(!resolved.length||resolved.some(x=>people.has(x)))continue;
      last.push(...resolved);resolved.forEach(x=>people.add(x));if(people.size>=2)break;
    }
    ids=last;
  }
  return {rotation_day_jst:today,previous_edition_day_jst:previousDay,previous_edition_expert_ids:[...new Set(ids)]};
}
function allowedCreator(item,rotation){
  const ids=creatorIds(item);
  return ids.length>0&&!ids.some(id=>rotation.previous_edition_expert_ids.includes(id));
}
module.exports={creatorIds,rotationContext,allowedCreator};
