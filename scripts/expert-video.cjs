"use strict";

const AI_TOPIC_PATTERN=/(?:\bAI\b|人工知能|生成AI|機械学習|深層学習|大規模言語モデル|\bLLM\b|ChatGPT|Claude|Gemini|AIエージェント|AIコーディング|ロボティクス)/i;
const VIDEO_FORMAT_PATTERN=/(?:動画|講演|対談|インタビュー|ポッドキャスト|文字起こし|解説|討論|セッション|基調講演|YouTube)/i;
const LOW_VALUE_PATTERN=/(?:切り抜き|無断転載|まとめ動画|反応集|shorts?\b|#shorts|予告編|ティザー|CM\b|プレゼント|キャンペーン|ランキング|おすすめ\d*選)/i;

function isExpertVideoItem(item){
  return String(item?.content_type||"").toLowerCase()==="expert_video";
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
  return AI_TOPIC_PATTERN.test(value)&&!LOW_VALUE_PATTERN.test(value);
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

function selectExpertVideoArchivePicks(items,limit=12){
  const candidates=dedupeExpertVideoCandidates((items||[]).filter(isExpertVideoItem))
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

function buildExpertWebDiscoveryUrl(expert,lookbackDays=30){
  const query=`"${expert.name}" (AI OR 生成AI OR 人工知能 OR ChatGPT) (動画 OR 講演 OR 対談 OR インタビュー OR ポッドキャスト OR 文字起こし) when:${Math.max(1,Number(lookbackDays)||30)}d`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;
}

module.exports={
  AI_TOPIC_PATTERN,VIDEO_FORMAT_PATTERN,LOW_VALUE_PATTERN,
  isExpertVideoItem,decodeJsHexEscapes,approximatePublishedAt,parseYouTubeChannelVideos,
  expertMentioned,matchedExpertsForSource,isSubstantiveAiVideo,isWebVideoCandidate,
  dedupeExpertVideoCandidates,selectExpertVideoArchivePicks,buildExpertWebDiscoveryUrl
};
