import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {sourceImage}=require('./source-image.cjs');

const dataFile=new URL('../data.json',import.meta.url);
const editionFile=new URL('../home-edition.json',import.meta.url);
const items=JSON.parse(fs.readFileSync(dataFile,'utf8'));
const edition=JSON.parse(fs.readFileSync(editionFile,'utf8'));
const topIds=new Set(edition.article_ids||[]);
const used=new Set(items.map(item=>item.commons_image_page_url).filter(Boolean));
const bad=/logo|icon|symbol|wordmark|banner|flag|seal|emblem|avatar|placeholder|stock|wallpaper|meme|screenshot of article|text only/i;
const safeLicense=/^(?:CC BY(?:-SA)? [234]\.0|CC0|Public domain)$/i;
const entities=['Google Gemini','DeepSeek','Anthropic','OpenAI','Nvidia','Microsoft','Canva','Runway','xAI','Claude','Meta AI','Adobe','Hugging Face'];

function plain(value){return String(value||'').replace(/<[^>]*>/g,' ').replace(/&(?:amp|quot|lt|gt);/g,' ').replace(/\s+/g,' ').trim().slice(0,120);}
function searchTerm(item){
  const text=[item.primary_entity,item.story_subject,item.title].join(' ');
  return entities.find(entity=>text.toLowerCase().includes(entity.toLowerCase()))||'';
}
function goodImage(page,term){
  const info=page?.imageinfo?.[0];
  if(!info||!String(page.title||'').toLowerCase().includes(term.toLowerCase())||bad.test(page.title))return false;
  if(!/^image\/(?:jpeg|png|webp)$/i.test(info.mime||'')||info.width<700||info.height<350)return false;
  const license=plain(info.extmetadata?.LicenseShortName?.value);
  if(!safeLicense.test(license))return false;
  const url=new URL(info.thumburl||info.url);
  if(url.protocol!=='https:'||!['upload.wikimedia.org','thumb.wikimedia.org','commons.wikimedia.org'].includes(url.hostname))return false;
  return true;
}
async function candidates(term){
  const url=new URL('https://commons.wikimedia.org/w/api.php');
  for(const [key,value] of Object.entries({action:'query',generator:'search',gsrsearch:term,gsrnamespace:'6',gsrlimit:'15',prop:'imageinfo',iiprop:'url|size|mime|extmetadata',iiurlwidth:'1200',format:'json'}))url.searchParams.set(key,value);
  const response=await fetch(url,{signal:AbortSignal.timeout(9000),headers:{'User-Agent':'KIZASHI-AI-Radar/1.0 (news image attribution)'}});
  if(!response.ok)throw new Error(`Commons HTTP ${response.status}`);
  const result=await response.json();
  return Object.values(result.query?.pages||{}).filter(page=>goodImage(page,term)).sort((a,b)=>a.index-b.index);
}

let added=0;
for(const id of topIds){
  const item=items.find(entry=>entry.article_id===id);
  if(!item||item.content_type==='expert_video'||item.editorial_image_url||sourceImage(item,items)||item.commons_image_url)continue;
  const term=searchTerm(item);
  if(!term)continue;
  try{
    const page=(await candidates(term)).find(entry=>!used.has(entry.imageinfo[0].descriptionurl));
    if(!page)continue;
    const info=page.imageinfo[0];
    item.commons_image_url=info.thumburl||info.url;
    item.commons_image_page_url=info.descriptionurl;
    item.commons_image_license=plain(info.extmetadata.LicenseShortName.value);
    item.commons_image_license_url=String(info.extmetadata.LicenseUrl?.value||'');
    item.commons_image_credit=plain(info.extmetadata.Artist?.value)||'Wikimedia Commons';
    item.commons_image_subject=term;
    used.add(info.descriptionurl);
    added++;
  }catch(error){console.warn(`Commons image unavailable for ${id}: ${error.message}`);}
}
if(added)fs.writeFileSync(dataFile,JSON.stringify(items,null,2)+'\n');
console.log(`Article-specific licensed Commons images added: ${added}`);
