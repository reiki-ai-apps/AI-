// A Commons filename is only a candidate when it names the article's actual
// subject. A word shared with an unrelated object (Runway/airport) is not proof.
const REVIEW_VERSION='subject-v1';
const COMMONS_FIELDS=['commons_image_url','commons_image_page_url','commons_image_license',
  'commons_image_license_url','commons_image_credit','commons_image_subject','commons_image_review_version'];
const SUBJECTS=[
  {name:'Runway AI',pattern:/\brunway\b/i,filename:/\b(?:runway[ _-]?(?:ai|ml|gen[ _-]?\d)|runwayml)\b/i},
  {name:'Anthropic',pattern:/\banthropic\b/i,filename:/\banthropic\b/i},
  {name:'NVIDIA',pattern:/\bnvidia\b|エヌビディア/i,filename:/\bnvidia\b/i},
  {name:'OpenAI',pattern:/\bopenai\b/i,filename:/\bopenai\b/i},
  {name:'Google',pattern:/\bgoogle\b|グーグル/i,filename:/\bgoogle\b/i},
  {name:'Microsoft',pattern:/\bmicrosoft\b|マイクロソフト/i,filename:/\bmicrosoft\b/i},
  {name:'Canva',pattern:/\bcanva\b/i,filename:/\bcanva\b/i},
  {name:'Adobe',pattern:/\badobe\b/i,filename:/\badobe\b/i},
  {name:'DeepSeek',pattern:/\bdeepseek\b/i,filename:/\bdeepseek\b/i},
  {name:'Hugging Face',pattern:/\bhugging[ _-]?face\b/i,filename:/\bhugging[ _-]?face\b/i}
];
const BAD_FILE=/\b(?:logo|icon|symbol|wordmark|banner|flag|seal|emblem|avatar|placeholder|stock|wallpaper|meme|purple)\b/i;
const PRODUCTS=[/\bCanva Craft\b/i,/\bDecisions API\b/i,/\bGemini 4 Argon\b/i,/\bClaude Duet\b/i,/\bCodex\b/i];
const OTHER_PRODUCTS=/\b(?:Codex|Gemini|Claude|Canva Craft|Decisions API)\b/i;
function subjectFor(item){
  const primary=String(item?.primary_entity||'');
  const primaryMatch=SUBJECTS.find(subject=>subject.pattern.test(primary));
  if(primaryMatch)return primaryMatch;
  const text=[item?.story_subject,item?.title].join(' ');
  return SUBJECTS.find(subject=>subject.pattern.test(text))||null;
}
function commonsFilename(pageUrl){
  try{
    const url=new URL(String(pageUrl||''));
    if(url.protocol!=='https:'||url.hostname!=='commons.wikimedia.org')return '';
    return decodeURIComponent(url.pathname.split('/').pop()||'').replace(/^File:/i,'').replace(/[_\.\-]/g,' ');
  }catch{return '';}
}
function relevantCommonsImage(item,pageUrl){
  const subject=subjectFor(item);
  const filename=commonsFilename(pageUrl);
  if(!subject||!filename||BAD_FILE.test(filename))return false;
  const title=String(item?.title||'');
  const product=PRODUCTS.find(pattern=>pattern.test(title));
  if(product&&!product.test(filename))return false;
  // An unrelated product screen is not a picture of a company announcement.
  if(!product&&OTHER_PRODUCTS.test(filename)&&!OTHER_PRODUCTS.test(title))return false;
  // Keep the original separators for Runway AI / RunwayML matching.
  const original=decodeURIComponent(new URL(pageUrl).pathname.split('/').pop()||'').replace(/^File:/i,'');
  return subject.filename.test(original.replace(/[_\.\-]/g,' '));
}
function clearCommonsImage(item){for(const field of COMMONS_FIELDS)delete item[field];}
module.exports={REVIEW_VERSION,COMMONS_FIELDS,subjectFor,relevantCommonsImage,clearCommonsImage};
