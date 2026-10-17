const IMPORTANCE={C:0,B:1,A:2,S:3};

function articleTime(item){
  const value=Date.parse(item.source_published_at||item.published_at||item.fetched_at||'');
  return Number.isFinite(value)?value:0;
}

function videoKey(item){
  return String(item.video_id||item.source_url||item.article_id||'');
}

// The home five and the two reviewed video slots must survive a full archive.
// Prune only the least important, oldest unfeatured entry when upstream stages
// produce an extra item. Never raise the publication ceiling to hide the bug.
function capPublishedEdition(items,{limit=60,featuredVideoKeys=[]}={}){
  if(!Array.isArray(items)||!Number.isInteger(limit)||limit<1)throw new Error('Invalid publication cap');
  if(items.length<=limit)return {items,dropped:[]};
  const featured=new Set(featuredVideoKeys);
  const protectedItem=item=>Number(item.home_top_rank)>0||
    (item.content_type==='expert_video'&&(
      featured.has(videoKey(item))||
      (item.home_video_selected_at&&['new','continued'].includes(item.home_video_origin))
    ));
  const protectedCount=items.filter(protectedItem).length;
  if(protectedCount>limit)throw new Error(`Protected home items exceed publication cap: ${protectedCount}/${limit}`);
  const removable=items.map((item,index)=>({item,index})).filter(({item})=>!protectedItem(item))
    .sort((a,b)=>(IMPORTANCE[String(a.item.importance||'C').toUpperCase()]??0)-
      (IMPORTANCE[String(b.item.importance||'C').toUpperCase()]??0)||
      articleTime(a.item)-articleTime(b.item)||a.index-b.index);
  const excess=items.length-limit;
  if(removable.length<excess)throw new Error(`Not enough unfeatured items to apply publication cap: ${items.length}/${limit}`);
  const removed=new Set(removable.slice(0,excess).map(entry=>entry.index));
  return {items:items.filter((_,index)=>!removed.has(index)),
    dropped:removable.slice(0,excess).map(entry=>entry.item.article_id||videoKey(entry.item))};
}

module.exports={capPublishedEdition};
