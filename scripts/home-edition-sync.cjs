const {applyHomeEdition}=require('./home-edition.cjs');

function synchronizeHomeEdition(items,edition){
  const next=applyHomeEdition(items,edition);
  const visible=next.filter(item=>Number(item.home_top_rank)>0)
    .sort((a,b)=>Number(a.home_top_rank)-Number(b.home_top_rank))
    .map(item=>String(item.article_id));
  const selected=(edition.article_ids||[]).map(String);
  if(JSON.stringify(visible)!==JSON.stringify(selected))
    throw new Error('Home edition references a missing, ineligible, or previous-day article');
  return next;
}

module.exports={synchronizeHomeEdition};
