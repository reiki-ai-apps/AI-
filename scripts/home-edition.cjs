"use strict";

const EDITION_VERSION="importance-topic-v1";
const MAX_HOME_ARTICLES=5;
const LATE_ARRIVAL_HOURS=48;
const FUTURE_TOLERANCE_MS=15*60*1000;

function validTime(value){
  const time=new Date(value||"").getTime();
  return Number.isFinite(time)?time:0;
}

function articleId(item){
  return String(item?.article_id||item?.id||"").trim();
}

function publishedTime(item){
  return validTime(item?.source_published_at||item?.published_at||item?.source_updated_at);
}

function firstSeenTime(item){
  return validTime(item?.fetched_at)||publishedTime(item);
}

function importanceRank(item){
  const value=String(item?.importance||item?.rank||"C").toUpperCase();
  return ["S","A","B","C"].includes(value)?value:"C";
}

function candidateStatus(item,windowStart,windowEnd){
  const published=publishedTime(item);
  const firstSeen=firstSeenTime(item);
  if(published>windowEnd+FUTURE_TOLERANCE_MS)return {eligible:false,lateArrival:false,dateUnknown:false};
  const publishedInWindow=published>windowStart&&published<=windowEnd;
  const firstSeenInWindow=firstSeen>windowStart&&firstSeen<=windowEnd;
  const lateArrival=firstSeenInWindow&&published>0&&published<=windowStart&&published>=windowEnd-LATE_ARRIVAL_HOURS*3600000;
  const dateUnknown=published===0&&firstSeenInWindow;
  return {eligible:publishedInWindow||firstSeenInWindow,lateArrival,dateUnknown};
}

function scoreArticle(item,windowStart,windowEnd){
  const rank=importanceRank(item);
  const importance={S:60,A:45,B:25,C:10}[rank];
  const text=[
    item?.title,item?.raw_excerpt,item?.detail,item?.change_summary,item?.impact_summary,
    item?.primary_entity,item?.story_subject,item?.event_type,item?.event_scope,
    ...(item?.story_entities||[]),...(item?.related_categories||[])
  ].join(" ").toLowerCase();
  let topicality=0;
  const reasons=[`重要度${rank}`];
  if(/openai|anthropic|google|gemini|deepmind|microsoft|meta|nvidia|xai|chatgpt|claude/.test(text)){
    topicality+=5;reasons.push("主要AI企業・基盤");
  }
  if(/規制|政策|政府|法律|法案|著作権|security|vulnerab|breach|cyber|セキュリティ|脆弱|情報漏えい|攻撃/.test(text)){
    topicality+=10;reasons.push("制度・安全への影響");
  }
  if(/新モデル|基盤モデル|release|launch|提供開始|一般提供|買収|大型投資|資金調達|半導体|gpu|データセンター/.test(text)){
    topicality+=10;reasons.push("大きな製品・市場変化");
  }
  if(/ceo|最高経営責任者|会長|幹部|退任|辞任|就任|再編|研究体制/.test(text)){
    topicality+=7;reasons.push("重要な経営・研究体制");
  }
  topicality=Math.min(20,topicality);

  let scope=0;
  if(/世界|全世界|global|全国|政府|企業全体|数十億|billion|million/.test(text))scope=10;
  else if(/日本|米国|中国|欧州|業界|企業|法人/.test(text))scope=6;
  else scope=3;

  const authority=item?.is_official?10:5;
  if(item?.is_official)reasons.push("公式一次情報");
  const time=publishedTime(item)||firstSeenTime(item);
  const span=Math.max(1,windowEnd-windowStart);
  const freshness=Math.max(0,Math.min(10,Math.round(((time-windowStart)/span)*10)));
  const status=candidateStatus(item,windowStart,windowEnd);
  let penalty=0;
  if(String(item?.event_stage||"").toLowerCase()==="rumor"||/\b(rumou?r|reportedly)\b|〜か$|可能性/.test(String(item?.title||"").toLowerCase())){
    penalty-=10;reasons.push("未確認情報を減点");
  }
  if(status.dateUnknown){penalty-=5;reasons.push("掲載日時不明を減点");}
  if(status.lateArrival)reasons.push("遅れて確認できた新着");
  const total=importance+topicality+scope+authority+freshness+penalty;
  return {
    article_id:articleId(item),total,
    breakdown:{importance,topicality,scope,authority,freshness,penalty},
    reasons:[...new Set(reasons)].slice(0,5),
    published_at:new Date(time||0).toISOString()
  };
}

function entityKey(item){
  return String(item?.primary_entity||(item?.story_entities||[])[0]||item?.tool||"その他").trim().toLowerCase();
}

function selectTopArticles(items,{windowStart,windowEnd,max=MAX_HOME_ARTICLES}={}){
  const start=validTime(windowStart);
  const end=validTime(windowEnd)||Date.now();
  const seen=new Set();
  const ranked=(items||[]).filter(item=>{
    const id=articleId(item);
    if(!id||seen.has(id))return false;
    seen.add(id);
    return candidateStatus(item,start,end).eligible;
  }).map(item=>({item,score:scoreArticle(item,start,end),entity:entityKey(item)}))
    .sort((a,b)=>b.score.total-a.score.total||publishedTime(b.item)-publishedTime(a.item)||articleId(a.item).localeCompare(articleId(b.item)));

  const selected=[];
  const entityCounts=new Map();
  for(const record of ranked){
    if(selected.length>=max)break;
    const count=entityCounts.get(record.entity)||0;
    if(count>=2)continue;
    selected.push(record);entityCounts.set(record.entity,count+1);
  }
  if(selected.length<max){
    for(const record of ranked){
      if(selected.length>=max)break;
      if(!selected.includes(record))selected.push(record);
    }
  }
  return {ranked,selected};
}

function buildHomeEdition(items,previous={},options={}){
  const windowEnd=validTime(options.windowEnd)||Date.now();
  const fallbackStart=windowEnd-24*3600000;
  const windowStart=validTime(options.windowStart||previous.last_window_end)||fallbackStart;
  const selection=selectTopArticles(items,{windowStart,windowEnd,max:options.max||MAX_HOME_ARTICLES});
  const liveIds=new Set((items||[]).map(articleId));
  const previousIds=(previous.article_ids||[]).filter(id=>liveIds.has(String(id))).slice(0,MAX_HOME_ARTICLES);
  const selectedIds=selection.selected.map(record=>record.score.article_id);
  const carriedForward=selectedIds.length===0&&previousIds.length>0;
  const articleIds=carriedForward?previousIds:selectedIds;
  const selectedAt=new Date(options.checkedAt||Date.now()).toISOString();
  const scores={};
  for(const id of articleIds){
    const item=(items||[]).find(candidate=>articleId(candidate)===id);
    if(item)scores[id]=scoreArticle(item,windowStart,windowEnd);
  }
  return {
    version:1,
    selection_version:EDITION_VERSION,
    timezone:"Asia/Tokyo",
    schedule_jst:["07:17","13:17","19:17"],
    window_start:new Date(windowStart).toISOString(),
    window_end:new Date(windowEnd).toISOString(),
    last_window_end:new Date(windowEnd).toISOString(),
    last_checked_at:selectedAt,
    last_published_at:carriedForward?(previous.last_published_at||previous.last_checked_at||selectedAt):selectedAt,
    candidate_count:selection.ranked.length,
    selected_count:articleIds.length,
    carried_forward:carriedForward,
    article_ids:articleIds,
    scores
  };
}

function applyHomeEdition(items,edition){
  const rankById=new Map((edition.article_ids||[]).map((id,index)=>[String(id),index+1]));
  return (items||[]).map(item=>{
    const copy={...item};
    delete copy.home_top_rank;
    delete copy.home_top_score;
    delete copy.home_score_breakdown;
    delete copy.home_selection_reasons;
    delete copy.home_selected_at;
    delete copy.home_window_start;
    delete copy.home_window_end;
    const id=articleId(copy);
    const rank=rankById.get(id);
    if(!rank)return copy;
    const score=edition.scores?.[id]||scoreArticle(copy,validTime(edition.window_start),validTime(edition.window_end));
    copy.home_top_rank=rank;
    copy.home_top_score=score.total;
    copy.home_score_breakdown=score.breakdown;
    copy.home_selection_reasons=score.reasons;
    copy.home_selected_at=edition.last_checked_at;
    copy.home_window_start=edition.window_start;
    copy.home_window_end=edition.window_end;
    return copy;
  });
}

module.exports={
  EDITION_VERSION,MAX_HOME_ARTICLES,validTime,articleId,publishedTime,firstSeenTime,
  candidateStatus,scoreArticle,selectTopArticles,buildHomeEdition,applyHomeEdition
};
