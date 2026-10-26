const fs=require('node:fs');
const path=require('node:path');
const {REVIEW_VERSION,relevantCommonsImage}=require('./article-image-policy.cjs');
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
function editorialImage(item){
  const id=String(item?.article_id||'');
  const local=`assets/story-photos/${id}.png`;
  if(!/^article_[A-Za-z0-9_-]{8,90}$/.test(id)||item?.editorial_image_url!==local)return '';
  const absolute=path.resolve(__dirname,'..',local);
  return fs.existsSync(absolute)?`https://reiki-ai-apps.github.io/AI-/${local}`:'';
}
function commonsImage(item,peers=[]){
  const image=httpUrl(item?.commons_image_url);
  const page=httpUrl(item?.commons_image_page_url);
  if(!image||!page||!['upload.wikimedia.org','thumb.wikimedia.org','commons.wikimedia.org'].includes(image.hostname)||
    page.hostname!=='commons.wikimedia.org'||!item?.commons_image_subject||
    item.commons_image_review_version!==REVIEW_VERSION||!relevantCommonsImage(item,page.toString())||
    peers.some(other=>other?.article_id!==item?.article_id&&other?.commons_image_page_url===item?.commons_image_page_url))return null;
  return {url:image.toString(),kind:'photo',label:'記事テーマの関連画像（出来事そのものの写真ではありません）',
    alt:`${String(item.commons_image_subject)}に関連する資料画像`,credit:String(item.commons_image_credit||'Wikimedia Commons'),
    creditUrl:page.toString(),licenseUrl:httpUrl(item.commons_image_license_url)?.toString()||''};
}
function articleVisual(item,peers=[]){
  const actual=sourceImage(item,peers);
  if(actual)return {url:actual,kind:String(item?.content_type||'')==='expert_video'?'video':'source',label:String(item?.content_type||'')==='expert_video'?'元動画のサムネイル':'情報元の記事画像'};
  const editorial=editorialImage(item);
  if(editorial)return {url:editorial,kind:'editorial',label:'AI制作のイメージ画像（実際の場面の写真ではありません）',alt:String(item.editorial_image_alt||item.title||'記事のイメージ画像')};
  return commonsImage(item,peers);
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
module.exports={OFFICIAL_HOSTS,sourceImage,editorialImage,commonsImage,articleVisual,videoThumbnail,extractSourceImage,httpUrl};
