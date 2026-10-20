const OFFICIAL_HOSTS=new Set([
  'openai.com','www.openai.com','anthropic.com','www.anthropic.com',
  'blog.google','deepmind.google','about.google','blogs.microsoft.com',
  'developer.microsoft.com','www.microsoft.com','nvidia.com','www.nvidia.com',
  'blog.youtube','huggingface.co'
]);

function httpUrl(value){
  try{
    const url=new URL(String(value||''));
    return url.protocol==='https:'&&!url.username&&!url.password?url:'';
  }catch{return null;}
}
function videoThumbnail(item){
  if(String(item?.content_type||'')!=='expert_video')return '';
  const id=String(item.video_id||'');
  return /^[A-Za-z0-9_-]{11}$/.test(id)?`https://i.ytimg.com/vi/${id}/hqdefault.jpg`:'';
}
function sourceImage(item,peers=[]){
  const video=videoThumbnail(item);
  if(video)return video;
  if(String(item?.content_type||'article')==='expert_video')return '';
  const source=httpUrl(item?.source_url);
  const image=httpUrl(item?.source_image_url);
  const bound=String(item?.source_image_page_url||'');
  if(image&&peers.some(other=>other?.source_url!==item?.source_url&&
    other?.source_image_url===item?.source_image_url&&other?.source_image_page_url===other?.source_url))return '';
  return source&&image&&image.toString()!==source.toString()&&bound===String(item.source_url)&&OFFICIAL_HOSTS.has(source.hostname)
    ?image.toString():'';
}
function articleVisual(item,peers=[]){
  const actual=sourceImage(item,peers);
  return actual?{url:actual,kind:String(item?.content_type||'')==='expert_video'?'video':'source',label:String(item?.content_type||'')==='expert_video'?'元動画のサムネイル':'情報元の記事画像'}:null;
}
function attrs(tag){
  const result={};
  for(const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)){
    result[match[1].toLowerCase()]=match[2]??match[3]??match[4]??'';
  }
  return result;
}
function meta(html,key){
  for(const match of String(html).matchAll(/<meta\b[^>]*>/gi)){
    const a=attrs(match[0]);
    if((a.property||a.name||'').toLowerCase()===key)return a.content||'';
  }
  return '';
}
function extractSourceImage(html,pageUrl){
  const canonical=meta(html,'og:url');
  if(canonical){
    const requested=httpUrl(pageUrl),declared=httpUrl(canonical);
    if(!requested||!declared||requested.hostname!==declared.hostname||
      requested.pathname.replace(/\/$/,'')!==declared.pathname.replace(/\/$/,''))return '';
  }
  const raw=meta(html,'og:image:secure_url')||meta(html,'og:image');
  let image;
  try{image=new URL(raw,pageUrl);}catch{return '';}
  if(image.protocol!=='https:'||image.username||image.password)return '';
  if(image.toString()===pageUrl)return '';
  if(/(?:^|[\/_-])(logo|avatar|icon|placeholder|fallback)(?:[\/_\-.]|$)/i.test(image.pathname))return '';
  const width=Number(meta(html,'og:image:width'));
  const height=Number(meta(html,'og:image:height'));
  if(width&&width<300||height&&height<150)return '';
  return image.toString();
}
module.exports={OFFICIAL_HOSTS,sourceImage,articleVisual,videoThumbnail,extractSourceImage,httpUrl};
