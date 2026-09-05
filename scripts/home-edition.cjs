"use strict";

const EDITION_VERSION="cross-edition-novelty-v3";
const MAX_HOME_ARTICLES=5;
const LATE_ARRIVAL_HOURS=48;
const FUTURE_TOLERANCE_MS=15*60*1000;
const RECENT_STORY_WINDOW_MS=72*60*60*1000;
const MAX_RECENT_STORY_HISTORY=45;
const TOOL_EVOLUTION_TARGET=2;
const MIN_TOOL_EVOLUTION_SCORE=40;
const TOOL_CATEGORIES=new Set([
  "AIツール・モデル","画像・動画生成","アプリ開発・自動化","音楽・クリエイティブ",
  "EC・業務活用","営業・マーケティング"
]);
const TOOL_STAGES=new Set(["announced","planned","beta","launched","expanded"]);

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

function compactText(value){
  return String(value||"").normalize("NFKC").toLowerCase()
    .replace(/[\s\u3000'\"`’“”。、，,・:：;；!?！？()（）\[\]{}【】「」『』<>《》／/\\_\-–—]/g,"");
}

function eventType(item){
  return String(item?.event_type||"other").trim().toLowerCase();
}

function eventStage(item){
  return String(item?.event_stage||"other").trim().toLowerCase();
}

function isToolEvolutionCandidate(item){
  const type=eventType(item);
  const stage=eventStage(item);
  if(!["release","research","other"].includes(type)||!TOOL_STAGES.has(stage))return false;
  const categories=[...(item?.related_categories||[]),...(item?.categories||[])].map(String);
  const text=[
    item?.tool,item?.title,item?.raw_excerpt,item?.detail,item?.change_summary,item?.impact_summary,
    item?.primary_entity,item?.story_subject,...(item?.story_entities||[]),...categories
  ].join(" ").toLowerCase();
  const toolContext=categories.some(category=>TOOL_CATEGORIES.has(category))||
    /\b(?:chatgpt|claude|gemini|grok|copilot|cursor|windsurf|runway|midjourney|firefly|kling|veo|canva|suno|heygen|elevenlabs|notion|gamma|perplexity|deepseek|qwen|llama)\b/i.test(text)||
    /AIツール|動画生成|画像生成|音声生成|アプリ開発|デザイン編集|動画編集/.test(text);
  const capabilityDelta=/公開|提供開始|一般提供|ベータ|追加|搭載|対応|新機能|新モデル|生成|編集|自動化|判定|連携|できる|release|launch|available|capabilit|feature|model|workflow|integration/i.test(text);
  return toolContext&&capabilityDelta&&Boolean(String(item?.story_subject||item?.title||"").trim());
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
  const toolEvolution=isToolEvolutionCandidate(item)?8:0;
  if(toolEvolution)reasons.push("AIツールの能力進化");
  const total=importance+topicality+scope+authority+freshness+toolEvolution+penalty;
  return {
    article_id:articleId(item),total,
    breakdown:{importance,topicality,scope,authority,freshness,tool_evolution:toolEvolution,penalty},
    reasons:[...new Set(reasons)].slice(0,6),
    published_at:new Date(time||0).toISOString()
  };
}

function entityKey(item){
  return compactText(item?.primary_entity||(item?.story_entities||[])[0]||item?.tool||"その他");
}

function productSignals(item){
  const primary=compactText(item?.primary_entity||(item?.story_entities||[])[0]||"");
  const values=[item?.story_subject,...(item?.story_entities||[])];
  for(const slot of item?.fact_slots||[]){
    if(String(slot?.type||"").toLowerCase()==="version")values.push(slot?.normalized_value,slot?.value);
  }
  const signals=new Set();
  const productPattern=/(?:chatgpt|gpt|gemini|claude|grok|llama|qwen|kimi|deepseek|veo|kling|runway|midjourney|firefly|copilot|cursor|windsurf|canva|sora|suno|heygen|elevenlabs|notionai|gamma)[a-z0-9.]*/g;
  for(const value of values){
    const normalized=compactText(value);
    if(!normalized)continue;
    const withoutPrimary=primary&&normalized.startsWith(primary)?normalized.slice(primary.length):normalized;
    if(withoutPrimary.length>=4)signals.add(withoutPrimary);
    for(const match of withoutPrimary.match(productPattern)||[]){
      if(match.length>=4)signals.add(match);
    }
  }
  return signals;
}

function setsOverlap(a,b){
  for(const value of a)if(b.has(value))return true;
  return false;
}

function signalsContainEachOther(a,b){
  for(const left of a){
    for(const right of b){
      if(Math.min(left.length,right.length)>=6&&(left.includes(right)||right.includes(left)))return true;
    }
  }
  return false;
}

function titleGrams(value){
  const text=compactText(value).replace(/発表|公開|提供開始|一般提供|リリース|発売|追加|搭載|開始|announces?|launch(?:es|ed)?|releases?/g,"");
  const grams=new Set();
  for(let index=0;index<=text.length-3;index++)grams.add(text.slice(index,index+3));
  return grams;
}

function titleSimilarity(a,b){
  const left=titleGrams(a),right=titleGrams(b);
  if(!left.size||!right.size)return 0;
  let overlap=0;
  for(const gram of left)if(right.has(gram))overlap++;
  return overlap/Math.max(left.size,right.size);
}

function materialProgression(a,b){
  const related=[a,b].some(item=>["follow_up","correction"].includes(String(item?.relation_type||item?.dedupe_decision||"").toLowerCase()));
  if(!related)return false;
  if([a,b].some(item=>String(item?.relation_type||item?.dedupe_decision||"").toLowerCase()==="correction"))return true;
  const stages=new Set([eventStage(a),eventStage(b)]);
  if(stages.size>1&&[...stages].some(stage=>["launched","expanded","fixed","restored","cancelled","corrected"].includes(stage)))return true;
  return eventType(a)!==eventType(b)&&!["other",""].includes(eventType(a))&&!["other",""].includes(eventType(b));
}

function sameEditionStory(a,b){
  if(!a||!b)return false;
  if(articleId(a)&&articleId(a)===articleId(b))return true;
  const storyA=String(a?.story_id||"").trim();
  const storyB=String(b?.story_id||"").trim();
  if(storyA&&storyA===storyB)return !materialProgression(a,b);
  const primaryA=entityKey(a),primaryB=entityKey(b);
  const samePrimary=primaryA&&primaryA===primaryB;
  const signalsA=productSignals(a),signalsB=productSignals(b);
  const sameProduct=setsOverlap(signalsA,signalsB)||signalsContainEachOther(signalsA,signalsB);
  const sameType=eventType(a)===eventType(b)||[eventType(a),eventType(b)].includes("other");
  const stageA=eventStage(a),stageB=eventStage(b);
  const sameLifecycle=stageA===stageB||[stageA,stageB].every(stage=>["announced","planned","beta","launched","expanded","other"].includes(stage));
  if(sameProduct&&sameType&&sameLifecycle&&!materialProgression(a,b))return true;
  const subjectA=compactText(a?.story_subject),subjectB=compactText(b?.story_subject);
  if(samePrimary&&sameType&&subjectA&&subjectB&&Math.min(subjectA.length,subjectB.length)>=6&&
    (subjectA.includes(subjectB)||subjectB.includes(subjectA))&&!materialProgression(a,b))return true;
  return samePrimary&&sameType&&titleSimilarity(a?.title,b?.title)>=0.72&&!materialProgression(a,b);
}

function collapseRankedStories(ranked){
  const distinctRanked=[];
  const duplicateGroups=[];
  for(const record of ranked){
    const representative=distinctRanked.find(candidate=>sameEditionStory(candidate.item,record.item));
    if(!representative){distinctRanked.push(record);continue;}
    let group=duplicateGroups.find(entry=>entry.representative_id===articleId(representative.item));
    if(!group){
      group={representative_id:articleId(representative.item),duplicate_ids:[]};
      duplicateGroups.push(group);
    }
    group.duplicate_ids.push(articleId(record.item));
  }
  return {distinctRanked,duplicateGroups};
}

function distinctArticleIds(items,ids,max=MAX_HOME_ARTICLES){
  const byId=new Map((items||[]).map(item=>[articleId(item),item]));
  const selected=[];
  for(const rawId of ids||[]){
    if(selected.length>=max)break;
    const id=String(rawId||"");
    const item=byId.get(id);
    if(!item||selected.some(existing=>sameEditionStory(existing,item)))continue;
    selected.push(item);
  }
  return selected.map(articleId);
}

function storyHistoryEntry(item,selectedAt,editionWindowEnd){
  return {
    article_id:articleId(item),
    story_id:String(item?.story_id||""),
    title:String(item?.title||""),
    primary_entity:String(item?.primary_entity||""),
    story_subject:String(item?.story_subject||""),
    event_type:String(item?.event_type||"other"),
    event_stage:String(item?.event_stage||"other"),
    event_scope:String(item?.event_scope||""),
    story_entities:Array.isArray(item?.story_entities)?item.story_entities:[],
    fact_slots:Array.isArray(item?.fact_slots)?item.fact_slots:[],
    relation_type:String(item?.relation_type||""),
    dedupe_decision:String(item?.dedupe_decision||""),
    previous_article_id:String(item?.previous_article_id||""),
    selected_at:new Date(validTime(selectedAt)||Date.now()).toISOString(),
    edition_window_end:new Date(validTime(editionWindowEnd)||Date.now()).toISOString()
  };
}

function recentStoryHistory(items,previous,windowEnd){
  const cutoff=windowEnd-RECENT_STORY_WINDOW_MS;
  const stored=Array.isArray(previous?.recent_story_history)?previous.recent_story_history:[];
  const history=stored.filter(entry=>{
    const time=validTime(entry?.selected_at);
    return articleId(entry)&&time>=cutoff&&time<=windowEnd+60*60*1000;
  });
  if(!history.length){
    const byId=new Map((items||[]).map(item=>[articleId(item),item]));
    const selectedAt=previous?.home_content_changed_at||previous?.last_published_at||previous?.last_checked_at;
    for(const id of previous?.article_ids||[]){
      const item=byId.get(String(id));
      if(item)history.push(storyHistoryEntry(item,selectedAt,previous?.window_end||previous?.last_window_end||windowEnd));
    }
  }
  return history.slice(-MAX_RECENT_STORY_HISTORY);
}

function sameArticleOrder(left,right){
  return left.length===right.length&&left.every((id,index)=>String(id)===String(right[index]));
}

function selectTopArticles(items,{windowStart,windowEnd,max=MAX_HOME_ARTICLES,excludeStories=[]}={}){
  const start=validTime(windowStart);
  const end=validTime(windowEnd)||Date.now();
  const seen=new Set();
  const ranked=(items||[]).filter(item=>{
    const id=articleId(item);
    if(!id||seen.has(id))return false;
    seen.add(id);
    return candidateStatus(item,start,end).eligible;
  }).map(item=>({item,score:scoreArticle(item,start,end),entity:entityKey(item),tool_evolution:isToolEvolutionCandidate(item)}))
    .sort((a,b)=>b.score.total-a.score.total||publishedTime(b.item)-publishedTime(a.item)||articleId(a.item).localeCompare(articleId(b.item)));

  const {distinctRanked,duplicateGroups}=collapseRankedStories(ranked);
  const novelRanked=[];
  const crossEditionDuplicateGroups=[];
  for(const record of distinctRanked){
    const previousMatch=(excludeStories||[]).find(entry=>sameEditionStory(entry,record.item));
    if(!previousMatch){novelRanked.push(record);continue;}
    crossEditionDuplicateGroups.push({
      representative_id:articleId(previousMatch),
      duplicate_ids:[articleId(record.item)]
    });
  }
  const selected=[];
  const entityCounts=new Map();
  const add=record=>{
    if(!record||selected.includes(record)||selected.length>=max)return false;
    selected.push(record);
    entityCounts.set(record.entity,(entityCounts.get(record.entity)||0)+1);
    return true;
  };

  for(const record of novelRanked.filter(record=>importanceRank(record.item)==="S"))add(record);

  const meaningfulTools=novelRanked.filter(record=>record.tool_evolution&&record.score.total>=MIN_TOOL_EVOLUTION_SCORE);
  const availableToolEntities=new Set(meaningfulTools.map(record=>record.entity));
  const toolTarget=Math.min(TOOL_EVOLUTION_TARGET,availableToolEntities.size,Math.max(0,max-selected.length));
  const selectedToolEntities=new Set(selected.filter(record=>record.tool_evolution).map(record=>record.entity));
  for(const record of meaningfulTools){
    if(selected.filter(candidate=>candidate.tool_evolution).length>=toolTarget)break;
    if(selectedToolEntities.has(record.entity))continue;
    if(add(record))selectedToolEntities.add(record.entity);
  }

  for(const record of novelRanked){
    if(selected.length>=max)break;
    const count=entityCounts.get(record.entity)||0;
    if(count>=2)continue;
    add(record);
  }
  if(selected.length<max){
    for(const record of novelRanked){
      if(selected.length>=max)break;
      add(record);
    }
  }
  selected.sort((a,b)=>b.score.total-a.score.total||publishedTime(b.item)-publishedTime(a.item)||articleId(a.item).localeCompare(articleId(b.item)));
  return {ranked,distinctRanked,novelRanked,duplicateGroups,crossEditionDuplicateGroups,selected,toolTarget};
}

function buildHomeEdition(items,previous={},options={}){
  const windowEnd=validTime(options.windowEnd)||Date.now();
  const fallbackStart=windowEnd-24*3600000;
  const windowStart=validTime(options.windowStart||previous.last_window_end)||fallbackStart;
  const previousWindowEnd=validTime(previous.window_end||previous.last_window_end);
  const previousWindowStart=validTime(previous.window_start);
  const rebuildingSameWindow=previousWindowEnd===windowEnd&&previousWindowStart===windowStart;
  let history=recentStoryHistory(items,previous,windowEnd);
  const exclusionHistory=rebuildingSameWindow
    ?history.filter(entry=>validTime(entry?.edition_window_end)!==windowEnd)
    :history;
  const selection=selectTopArticles(items,{
    windowStart,windowEnd,max:options.max||MAX_HOME_ARTICLES,excludeStories:exclusionHistory
  });
  const liveIds=new Set((items||[]).map(articleId));
  const previousIds=distinctArticleIds(items,(previous.article_ids||[]).filter(id=>liveIds.has(String(id))),MAX_HOME_ARTICLES);
  const selectedIds=distinctArticleIds(items,selection.selected.map(record=>record.score.article_id),MAX_HOME_ARTICLES);
  const carriedForward=selectedIds.length===0&&previousIds.length>0;
  const articleIds=carriedForward?previousIds:selectedIds;
  const selectedAt=new Date(options.checkedAt||Date.now()).toISOString();
  const previousArticleIds=Array.isArray(previous.article_ids)?previous.article_ids.map(String):[];
  const contentChanged=!sameArticleOrder(articleIds,previousArticleIds);
  const previousChangedAt=previous.home_content_changed_at||previous.last_published_at||previous.last_checked_at||selectedAt;
  const homeContentChangedAt=contentChanged?selectedAt:previousChangedAt;
  const previousUnchanged=Number(previous.consecutive_unchanged_editions)||0;
  const previousZero=Number(previous.consecutive_zero_candidate_editions)||0;
  const unchangedEditions=contentChanged?0:(rebuildingSameWindow?previousUnchanged:previousUnchanged+1);
  const zeroCandidateEditions=selection.ranked.length===0
    ?(rebuildingSameWindow?previousZero:previousZero+1)
    :0;
  const staleHours=Math.max(0,(validTime(selectedAt)-validTime(homeContentChangedAt))/3600000);
  const healthReasons=[];
  if(staleHours>=24)healthReasons.push("トップ記事の内容が24時間以上変わっていません");
  if(zeroCandidateEditions>=2)healthReasons.push("新着候補0件が2回以上続いています");
  const updateHealth=healthReasons.length?"DEGRADED":"HEALTHY";

  if(rebuildingSameWindow){
    history=history.filter(entry=>validTime(entry?.edition_window_end)!==windowEnd);
  }
  if(!carriedForward||rebuildingSameWindow){
    const byId=new Map((items||[]).map(item=>[articleId(item),item]));
    for(const id of articleIds){
      const item=byId.get(id);
      if(item)history.push(storyHistoryEntry(item,carriedForward?previousChangedAt:selectedAt,windowEnd));
    }
  }
  const historyCutoff=windowEnd-RECENT_STORY_WINDOW_MS;
  const historyByArticle=new Map();
  for(const entry of history){
    if(validTime(entry?.selected_at)>=historyCutoff)historyByArticle.set(articleId(entry),entry);
  }
  const recentHistory=[...historyByArticle.values()]
    .sort((a,b)=>validTime(a.selected_at)-validTime(b.selected_at))
    .slice(-MAX_RECENT_STORY_HISTORY);
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
    last_published_at:contentChanged?selectedAt:(previous.last_published_at||previous.last_checked_at||selectedAt),
    home_content_changed_at:homeContentChangedAt,
    consecutive_unchanged_editions:unchangedEditions,
    consecutive_zero_candidate_editions:zeroCandidateEditions,
    update_health:updateHealth,
    update_health_reasons:healthReasons,
    edition_status:carriedForward?"NO_NEW_STORIES":"NEW_STORIES",
    candidate_count:selection.ranked.length,
    distinct_candidate_count:selection.distinctRanked.length,
    duplicate_candidate_count:selection.ranked.length-selection.distinctRanked.length,
    duplicate_groups:selection.duplicateGroups,
    novel_candidate_count:selection.novelRanked.length,
    cross_edition_duplicate_count:selection.distinctRanked.length-selection.novelRanked.length,
    cross_edition_duplicate_groups:selection.crossEditionDuplicateGroups,
    selected_count:articleIds.length,
    tool_evolution_selected_count:articleIds.filter(id=>{
      const item=(items||[]).find(candidate=>articleId(candidate)===id);
      return item&&isToolEvolutionCandidate(item);
    }).length,
    carried_forward:carriedForward,
    article_ids:articleIds,
    scores,
    recent_story_history:recentHistory
  };
}

function applyHomeEdition(items,edition){
  const safeIds=distinctArticleIds(items,edition.article_ids||[],MAX_HOME_ARTICLES);
  const rankById=new Map(safeIds.map((id,index)=>[String(id),index+1]));
  return (items||[]).map(item=>{
    const copy={...item};
    delete copy.home_top_rank;
    delete copy.home_top_score;
    delete copy.home_score_breakdown;
    delete copy.home_selection_reasons;
    delete copy.home_selected_at;
    delete copy.home_window_start;
    delete copy.home_window_end;
    delete copy.home_content_changed_at;
    delete copy.home_update_health;
    delete copy.home_consecutive_unchanged_editions;
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
    copy.home_content_changed_at=edition.home_content_changed_at;
    copy.home_update_health=edition.update_health;
    copy.home_consecutive_unchanged_editions=edition.consecutive_unchanged_editions;
    return copy;
  });
}

module.exports={
  EDITION_VERSION,MAX_HOME_ARTICLES,RECENT_STORY_WINDOW_MS,validTime,articleId,publishedTime,firstSeenTime,
  candidateStatus,isToolEvolutionCandidate,scoreArticle,sameEditionStory,distinctArticleIds,
  selectTopArticles,buildHomeEdition,applyHomeEdition
};
