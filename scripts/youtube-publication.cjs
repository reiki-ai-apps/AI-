// Only exact publication evidence from the requested video's official player is used.
function parsePlayerMetadata(payload,videoId){
  const details=payload?.videoDetails||{};
  const meta=payload?.microformat?.playerMicroformatRenderer||{};
  if(details.videoId!==videoId||(meta.externalVideoId&&meta.externalVideoId!==videoId))return null;
  const raw=String(meta.publishDate||"");
  const date=/^\d{4}-\d{2}-\d{2}T/.test(raw)&&Number.isFinite(Date.parse(raw))
    ?new Date(raw).toISOString():"";
  return {videoId,channelId:String(details.channelId||meta.externalChannelId||""),
    exactPublishedAt:date,publishedAt:date,title:String(details.title||""),
    description:String(details.shortDescription||meta.description?.simpleText||"")};
}

function mergeChannelVideos(page=[],feed=[]){
  const byId=new Map(page.map(video=>[video.videoId,video]));
  for(const video of feed){
    const old=byId.get(video.videoId)||{};
    byId.set(video.videoId,{...old,...video,description:video.description||old.description||""});
  }
  // Exact, newest feed records must not be crowded out by undated page cards.
  return [...byId.values()].sort((a,b)=>
    (Date.parse(b.exactPublishedAt)||0)-(Date.parse(a.exactPublishedAt)||0)||
    (Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0));
}
function parseOfficialEpisodeLinks(html,baseUrl){
  const base=new URL(baseUrl),found=new Map();
  for(const match of String(html||"").matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    try{
      const url=new URL(match[1].replace(/&amp;/g,"&"),base);
      if(url.origin!==base.origin||!/^\/articles\/withbloomberg\/\d+$/.test(url.pathname))continue;
      const title=match[2].replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
      const link=url.origin+url.pathname;
      if(title&&!found.has(link))found.set(link,{url:link,title});
    }catch{}
  }
  return [...found.values()];
}
module.exports={parsePlayerMetadata,mergeChannelVideos,parseOfficialEpisodeLinks};
