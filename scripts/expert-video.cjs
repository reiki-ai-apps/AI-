"use strict";

const AI_TOPIC_PATTERN=/(?:\bAI\b|人工知能|生成AI|機械学習|深層学習|大規模言語モデル|\bLLM\b|ChatGPT|Claude|Gemini|AIエージェント|AIコーディング|ロボティクス)/i;
const VIDEO_FORMAT_PATTERN=/(?:動画|講演|対談|インタビュー|ポッドキャスト|文字起こし|解説|討論|セッション|基調講演|YouTube)/i;
const SUBSTANTIVE_SIGNAL_PATTERN=/(?:解説|講座|講演|対談|インタビュー|討論|議論|検証|比較|仕組み|なぜ|何を|どのよう|できる|影響|変わる|未来|政策|規制|技術|研究|実演|実装|条件|課題|対策|リスク|能力|記憶|仕事|社会|開発|モデル|エージェント|コーディング)/i;
const LOW_VALUE_PATTERN=/(?:切り抜き|無断転載|まとめ動画|反応集|shorts?\b|#shorts|予告編|ティザー|CM(?:動画)?\b|プレゼント|キャンペーン|ランキング|おすすめ\d*選|\bVLOG\b|行ってみた|潜入|体験乗車|スパルタキャンプ|無料.{0,12}学べる|受講者募集)/i;
const EXPERT_VIDEO_MAX_AGE_DAYS=10;

function isExpertVideoItem(item){
  return String(item?.content_type||"").toLowerCase()==="expert_video";
}

function jstDayKey(now=Date.now()){
  const parts=new Intl.DateTimeFormat("en-US",{
    timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(new Date(now));
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shouldRefreshExpertVideos(state,now=Date.now(),schedule=""){
  const today=jstDayKey(now);
  const morningStart=Date.parse(`${today}T07:17:00+09:00`);
  const morningEnd=Date.parse(`${today}T12:00:00+09:00`);
  // 朝の定期実行はキュー待ちで遅れても有効。昼・夜の定期実行は対象外。
  // 手動実行は朝7:17〜正午の間だけ許可し、深夜に当日分を消費しない。
  const morningRun=schedule?String(schedule)==="17 22 * * *":now>=morningStart&&now<morningEnd;
  if(!morningRun)return false;
  const lastRefresh=Date.parse(state?.last_successful_refresh_at||"");
  return String(state?.last_successful_refresh_day_jst||"")!==today||lastRefresh<morningStart;
}

function isFreshExpertVideo(item,now=Date.now(),maxAgeDays=EXPERT_VIDEO_MAX_AGE_DAYS){
  if(!isExpertVideoItem(item)||String(item?.source_date_status||"")!=="published")return false;
  const publishedAt=new Date(item?.source_published_at||0).getTime();
  const ageLimit=Math.max(1,Number(maxAgeDays)||EXPERT_VIDEO_MAX_AGE_DAYS)*86400000;
  return Number.isFinite(publishedAt)&&publishedAt>0&&publishedAt<=now&&publishedAt>=now-ageLimit;
}

function decodeJsHexEscapes(value){
  return String(value||"").replace(/\\x([0-9a-f]{2})/gi,(_match,hex)=>String.fromCharCode(Number.parseInt(hex,16)));
}

function decodeJsonText(value){
  return String(value||"")
    .replace(/\\u([0-9a-f]{4})/gi,(_match,hex)=>String.fromCharCode(Number.parseInt(hex,16)))
    .replace(/\\\//g,"/")
    .replace(/\\"/g,'"')
    .replace(/\\n/g," ")
    .replace(/\\t/g," ")
    .replace(/\\\\/g,"\\")
    .replace(/\s+/g," ")
    .trim();
}

function approximatePublishedAt(label,now=Date.now()){
  const text=String(label||"").normalize("NFKC").toLowerCase();
  let amount=Number((text.match(/(\d+)/)||[])[1]||0);
  if(/今日|just now|hour|時間前/.test(text))return new Date(now-Math.max(1,amount)*3600000).toISOString();
  if(/昨日|1 day ago/.test(text))return new Date(now-86400000).toISOString();
  if(/日前|days? ago/.test(text))return new Date(now-Math.max(1,amount)*86400000).toISOString();
  if(/週間前|weeks? ago/.test(text))return new Date(now-Math.max(1,amount)*7*86400000).toISOString();
  if(/か月前|ヶ月前|months? ago/.test(text))return new Date(now-Math.max(1,amount)*30*86400000).toISOString();
  if(/年前|years? ago/.test(text))return new Date(now-Math.max(1,amount)*365*86400000).toISOString();
  return "";
}

function rendererSegments(decoded,marker){
  const starts=[...decoded.matchAll(marker)].map(match=>match.index||0);
  return starts.map((start,index)=>decoded.slice(start,Math.min(starts[index+1]||start+24000,start+24000)));
}

function relativeTimeLabel(segment){
  const candidates=[
    ...[...segment.matchAll(/"accessibilityLabel":"((?:\\.|[^"\\])*)"/g)].map(match=>decodeJsonText(match[1])),
    ...[...segment.matchAll(/"content":"((?:\\.|[^"\\])*)"/g)].map(match=>decodeJsonText(match[1]))
  ];
  return candidates.find(value=>/(?:今日|昨日|\d+\s*(?:秒|分|時間|日|週間|週|か月|ヶ月|月|年)前|(?:second|minute|hour|day|week|month|year)s? ago)/i.test(value))||"";
}

function parseYouTubeChannelVideos(html,source={},now=Date.now()){
  const decoded=decodeJsHexEscapes(html);
  // YouTubeの現行HTMLはlockupViewModel、旧HTMLはvideoRendererを使う。
  // videoId単体で区切ると、同じカード内の操作ボタンにもvideoIdが繰り返され、
  // タイトルに到達する前にカードを切ってしまうため、カード単位で解析する。
  const segments=[
    ...rendererSegments(decoded,/"richItemRenderer":\{/g),
    ...rendererSegments(decoded,/"videoRenderer":\{/g),
    ...rendererSegments(decoded,/"gridVideoRenderer":\{/g)
  ];
  const seen=new Set();
  const videos=[];
  for(const segment of segments){
    const lockupId=segment.match(/"contentId":"([A-Za-z0-9_-]{11})"/);
    const rendererId=segment.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
    const videoId=lockupId?.[1]||rendererId?.[1]||"";
    if(!videoId)continue;
    if(seen.has(videoId))continue;
    const lockupTitle=segment.match(/"lockupMetadataViewModel":\{"title":\{"content":"((?:\\.|[^"\\])*)"/);
    const rendererTitle=segment.match(/"title":\{(?:"runs":\[\{"text":"((?:\\.|[^"\\])*)"|"simpleText":"((?:\\.|[^"\\])*)")/);
    const title=decodeJsonText(lockupTitle?.[1]||rendererTitle?.[1]||rendererTitle?.[2]||"");
    if(!title)continue;
    const publishedMatch=segment.match(/"publishedTimeText":\{(?:"simpleText":"((?:\\.|[^"\\])*)"|"runs":\[\{"text":"((?:\\.|[^"\\])*)")/);
    const publishedLabel=decodeJsonText(publishedMatch?.[1]||publishedMatch?.[2]||relativeTimeLabel(segment));
    const descriptionMatch=segment.match(/"descriptionSnippet":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"/);
    const description=decodeJsonText(descriptionMatch?.[1]||"");
    seen.add(videoId);
    videos.push({
      videoId,
      title,
      description,
      publishedLabel,
      publishedAt:approximatePublishedAt(publishedLabel,now),
      link:`https://www.youtube.com/watch?v=${videoId}`,
      sourceName:String(source.source_name||"YouTube"),
      channelId:String(source.channel_id||""),
      platform:"YouTube"
    });
  }
  return videos;
}

function expertById(registry,id){
  return (registry?.experts||[]).find(expert=>expert.id===id)||null;
}

function expertMentioned(text,expert){
  const haystack=String(text||"").normalize("NFKC").toLowerCase();
  return [expert?.name,...(expert?.aliases||[])].filter(Boolean)
    .some(alias=>haystack.includes(String(alias).normalize("NFKC").toLowerCase().replace(/\s+/g,""))||
      haystack.replace(/\s+/g,"").includes(String(alias).normalize("NFKC").toLowerCase().replace(/\s+/g,"")));
}

function matchedExpertsForSource(text,source,registry){
  if(source.expert_id){
    const expert=expertById(registry,source.expert_id);
    return expert?[expert]:[];
  }
  const allowed=new Set(source.allowed_experts||[]);
  return (registry?.experts||[]).filter(expert=>(allowed.has("*")||allowed.has(expert.id))&&expertMentioned(text,expert));
}

function isSubstantiveAiVideo(text){
  const value=String(text||"");
  return AI_TOPIC_PATTERN.test(value)&&SUBSTANTIVE_SIGNAL_PATTERN.test(value)&&!LOW_VALUE_PATTERN.test(value);
}

function isWebVideoCandidate(text){
  const value=String(text||"");
  return isSubstantiveAiVideo(value)&&VIDEO_FORMAT_PATTERN.test(value);
}

function dedupeExpertVideoCandidates(items){
  const output=[];
  const exact=new Set();
  const statementKeys=new Set();
  for(const item of items||[]){
    const exactKey=String(item?.video_id||item?.source_url||"").toLowerCase().replace(/[?#].*$/g,"");
    if(exactKey&&exact.has(exactKey))continue;
    const normalizedTitle=String(item?.title||"").normalize("NFKC").toLowerCase()
      .replace(/(?:切り抜き|shorts?|youtube|動画|講演|対談|インタビュー|文字起こし)/g,"")
      .replace(/[^\p{L}\p{N}]+/gu,"");
    const statementKey=`${item?.expert_id||""}|${normalizedTitle}`;
    if(normalizedTitle.length>=12&&statementKeys.has(statementKey))continue;
    if(exactKey)exact.add(exactKey);
    if(normalizedTitle.length>=12)statementKeys.add(statementKey);
    output.push(item);
  }
  return output;
}

function selectExpertVideoArchivePicks(items,limit=12,now=Date.now()){
  const candidates=dedupeExpertVideoCandidates((items||[]).filter(item=>isFreshExpertVideo(item,now)))
    .sort((a,b)=>new Date(b.source_published_at||b.published_at||b.fetched_at||0)-new Date(a.source_published_at||a.published_at||a.fetched_at||0));
  const selected=[];
  const selectedIds=new Set();
  for(const item of candidates){
    if(selected.length>=limit)break;
    if(selectedIds.has(item.expert_id))continue;
    selected.push(item);selectedIds.add(item.expert_id);
  }
  for(const item of candidates){
    if(selected.length>=limit)break;
    if(selected.includes(item))continue;
    selected.push(item);
  }
  return selected;
}

function selectExpertVideoReviewCandidates(items,limit=6,maxPerExpert=2,now=Date.now()){
  const candidates=dedupeExpertVideoCandidates((items||[]).filter(isExpertVideoItem))
    .filter(item=>isFreshExpertVideo(item,now))
    .sort((a,b)=>{
      const quality=item=>{
        const text=`${item.title||""} ${item.raw_excerpt||""}`;
        let score=0;
        if(/(?:講演|対談|インタビュー|討論|議論)/i.test(text))score+=22;
        if(/(?:解説|講座|検証|比較|仕組み|実演|実装|条件|課題|対策)/i.test(text))score+=18;
        if(["primary","institutional"].includes(String(item.source_trust||"")))score+=15;
        if(LOW_VALUE_PATTERN.test(text))score-=100;
        const time=new Date(item.source_published_at||item.published_at||item.fetched_at||0).getTime();
        if(Number.isFinite(time)&&time>0)score+=Math.max(0,30-(now-time)/86400000);
        return score;
      };
      return quality(b)-quality(a);
    });
  const selected=[];
  const selectedKeys=new Set();
  const counts=new Map();
  const add=item=>{
    const key=String(item.video_id||item.source_url||"");
    const expert=String(item.expert_id||item.expert_name||"unknown");
    if(!key||selectedKeys.has(key)||(counts.get(expert)||0)>=maxPerExpert||selected.length>=limit)return false;
    selected.push(item);selectedKeys.add(key);counts.set(expert,(counts.get(expert)||0)+1);return true;
  };
  for(const item of candidates){
    const expert=String(item.expert_id||item.expert_name||"unknown");
    if((counts.get(expert)||0)===0)add(item);
  }
  for(const item of candidates)add(item);
  return selected;
}

function buildExpertWebDiscoveryUrl(expert,lookbackDays=EXPERT_VIDEO_MAX_AGE_DAYS){
  const query=`"${expert.name}" (AI OR 生成AI OR 人工知能 OR ChatGPT) (動画 OR 講演 OR 対談 OR インタビュー OR ポッドキャスト OR 文字起こし) when:${Math.max(1,Number(lookbackDays)||EXPERT_VIDEO_MAX_AGE_DAYS)}d`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;
}

module.exports={
  AI_TOPIC_PATTERN,VIDEO_FORMAT_PATTERN,SUBSTANTIVE_SIGNAL_PATTERN,LOW_VALUE_PATTERN,
  EXPERT_VIDEO_MAX_AGE_DAYS,isExpertVideoItem,jstDayKey,shouldRefreshExpertVideos,isFreshExpertVideo,
  decodeJsHexEscapes,approximatePublishedAt,parseYouTubeChannelVideos,
  expertMentioned,matchedExpertsForSource,isSubstantiveAiVideo,isWebVideoCandidate,
  dedupeExpertVideoCandidates,selectExpertVideoArchivePicks,selectExpertVideoReviewCandidates,
  buildExpertWebDiscoveryUrl
};
