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
function sourceImage(item){
  const video=videoThumbnail(item);
  if(video)return video;
  if(String(item?.content_type||'article')==='expert_video')return '';
  const source=httpUrl(item?.source_url);
  const image=httpUrl(item?.source_image_url);
  const bound=String(item?.source_image_page_url||'');
  return source&&image&&bound===String(item.source_url)&&OFFICIAL_HOSTS.has(source.hostname)
    ?image.toString():'';
}
const ASSET_BASE='https://reiki-ai-apps.github.io/AI-/assets/';
const COMMONS='https://commons.wikimedia.org/wiki/File:';
const PHOTO_RULES=[
  {match:/ジェンスン・フアン|Jensen Huang/i,file:'photo-jensen.jpg',label:'ジェンスン・フアン氏の資料写真（今回の発言時ではありません）',credit:'Anders Eidesvik / CC BY-SA 4.0',page:`${COMMONS}Jensen_huang_stanford_2026-04-30_010.jpg`,license:'https://creativecommons.org/licenses/by-sa/4.0/'},
  {match:/Anthropic.*アモデイ|アモデイ.*Anthropic/i,file:'photo-anthropic-visit.jpg',label:'Anthropic訪問時の資料写真（本件の裁判資料とは無関係）',credit:'Alecsandra Dragoi / DSIT / CC BY 2.0',page:`${COMMONS}Secretary_of_State_Peter_Kyle_visits_Anthropic_in_San_Francisco._(54098999333).jpg`,license:'https://creativecommons.org/licenses/by/2.0/'},
  {match:/Grok Voice.*テスラ|テスラ.*Grok Voice/i,file:'photo-tesla.jpg',label:'テスラ車の資料写真（Grok Voiceの画面ではありません）',credit:'Rostyslav Lutsenko / CC0',page:`${COMMONS}Tesla_Model_3_(2016).jpg`},
  {match:/中国政府.*輸出規制|中国.*AI技術.*輸出規制/,file:'photo-china-flag.jpg',label:'中国の国旗の資料写真（発表現場ではありません）',credit:'Daderot / Public domain',page:`${COMMONS}Chinese_flag_(Beijing)_-_IMG_1104.jpg`},
  {match:/提訴|訴訟|裁判|司法長官/,file:'photo-courthouse.jpg',label:'米国の裁判所の資料写真（本件の現場ではありません）',credit:'Roc0ast3r / CC0',page:`${COMMONS}Sevier_County_Courthouse_with_flag_of_the_United_States_-_1.jpg`},
  {match:/数学|数論|未解決問題|定理|証明/,file:'photo-math-board.jpg',label:'数学の資料写真（記事の研究とは別）',credit:'David Malone / CC BY 4.0',page:`${COMMONS}Mathematics_(cryptography)_on_a_blackboard.jpg`,license:'https://creativecommons.org/licenses/by/4.0/'},
  {match:/脆弱性|セキュリティ|サイバー|不正アクセス|AI自動テスト|アプリ開発|プログラミング/,file:'photo-code-screen.jpg',label:'ソフト開発の資料写真（当該製品の画面ではありません）',credit:'Slashme / CC0',page:`${COMMONS}RustCodeOnScreen.jpg`},
  {match:/韓国株|KOSPI/,file:'photo-stockmarket.jpg',label:'株価表示の資料写真（韓国市場の当日写真ではありません）',credit:'AhmadArdity / CC0',page:`${COMMONS}Stockmarket.jpg`},
  {match:/半導体|GPU|チップ|メモリー/,file:'photo-wafer.jpg',label:'半導体ウエハーの資料写真（記事の製品ではありません）',credit:'ISCIX-Ex / CC0',page:`${COMMONS}Wafer300mm-LargeIC-testset.jpg`},
  {match:/株価|株式|市場|投資|決算|売上高/,file:'photo-stockmarket.jpg',label:'株価表示の資料写真（当日の市場ではありません）',credit:'AhmadArdity / CC0',page:`${COMMONS}Stockmarket.jpg`}
];
function articleVisual(item){
  const actual=sourceImage(item);
  if(actual)return {url:actual,kind:String(item?.content_type||'')==='expert_video'?'video':'source',label:String(item?.content_type||'')==='expert_video'?'元動画のサムネイル':'情報元の記事画像'};
  if(String(item?.content_type||'article')==='expert_video')return null;
  const entity=String(item?.primary_entity||'').trim();
  const title=String(item?.title||'');
  const photo=PHOTO_RULES.find(rule=>rule.match.test(title));
  if(photo)return {url:`${ASSET_BASE}${photo.file}`,kind:'photo',label:photo.label,credit:photo.credit,creditUrl:photo.page,licenseUrl:photo.license||''};
  if(entity==='OpenAI'||(!entity&&/\bOpenAI\b/i.test(title)))
    return {url:`${ASSET_BASE}brand-openai-white-wordmark.png`,kind:'brand',label:'OpenAIの企業ロゴ（記事写真ではありません）'};
  if(/脆弱性|セキュリティ|サイバー|不正アクセス|AI自動テスト/.test(title))
    return {url:`${ASSET_BASE}ai-card-cyber.webp`,kind:'topic',label:'セキュリティの関連イメージ'};
  if(/半導体株|株価|株式市場|投資|決算|売上高/.test(title))
    return {url:`${ASSET_BASE}ai-card-finance.webp`,kind:'topic',label:'市場・投資の関連イメージ'};
  return null;
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
  if(/(?:^|[\/_-])(logo|avatar|icon|placeholder|fallback)(?:[\/_\-.]|$)/i.test(image.pathname))return '';
  const width=Number(meta(html,'og:image:width'));
  const height=Number(meta(html,'og:image:height'));
  if(width&&width<300||height&&height<150)return '';
  return image.toString();
}
module.exports={OFFICIAL_HOSTS,sourceImage,articleVisual,videoThumbnail,extractSourceImage,httpUrl};
