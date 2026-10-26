import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {sourceImage}=require('./source-image.cjs');
const {REVIEW_VERSION,subjectFor,relevantCommonsImage,clearCommonsImage}=require('./article-image-policy.cjs');

const dataFile=new URL('../data.json',import.meta.url);
const editionFile=new URL('../home-edition.json',import.meta.url);
const items=JSON.parse(fs.readFileSync(dataFile,'utf8'));
const edition=JSON.parse(fs.readFileSync(editionFile,'utf8'));
const topIds=new Set(edition.article_ids||[]);
const bad=/logo|icon|symbol|wordmark|banner|flag|seal|emblem|avatar|placeholder|stock|wallpaper|meme|screenshot of article|text only/i;
const safeLicense=/^(?:CC BY(?:-SA)? [234]\.0|CC0|Public domain)$/i;

function plain(value){return String(value||'').replace(/<[^>]*>/g,' ').replace(/&(?:amp|quot|lt|gt);/g,' ').replace(/\s+/g,' ').trim().slice(0,120);}
function goodImage(page,item){
  const info=page?.imageinfo?.[0];
  if(!info||bad.test(page.title)||!relevantCommonsImage(item,info.descriptionurl))return false;
  if(!/^image\/(?:jpeg|png|webp)$/i.test(info.mime||'')||info.width<700||info.height<350)return false;
  const license=plain(info.extmetadata?.LicenseShortName?.value);
  if(!safeLicense.test(license))return false;
  const url=new URL(info.thumburl||info.url);
  if(url.protocol!=='https:'||!['upload.wikimedia.org','thumb.wikimedia.org','commons.wikimedia.org'].includes(url.hostname))return false;
  return true;
}
async function candidates(term,item){
  const url=new URL('https://commons.wikimedia.org/w/api.php');
  for(const [key,value] of Object.entries({action:'query',generator:'search',gsrsearch:term,gsrnamespace:'6',gsrlimit:'15',prop:'imageinfo',iiprop:'url|size|mime|extmetadata',iiurlwidth:'1200',format:'json'}))url.searchParams.set(key,value);
  const response=await fetch(url,{signal:AbortSignal.timeout(9000),headers:{'User-Agent':'KIZASHI-AI-Radar/1.0 (news image attribution)'}});
  if(!response.ok)throw new Error(`Commons HTTP ${response.status}`);
  const result=await response.json();
  return Object.values(result.query?.pages||{}).filter(page=>goodImage(page,item)).sort((a,b)=>a.index-b.index);
}

let added=0,removed=0,reviewed=0;
for(const item of items){
  if(!item.commons_image_url&&!item.commons_image_page_url)continue;
  if(!relevantCommonsImage(item,item.commons_image_page_url)){
    clearCommonsImage(item);
    removed++;
  }else if(item.commons_image_review_version!==REVIEW_VERSION){
    item.commons_image_review_version=REVIEW_VERSION;
    reviewed++;
  }
}
const used=new Set(items.map(item=>item.commons_image_page_url).filter(Boolean));
if(!process.argv.includes('--validate-only')){
for(const id of topIds){
  const item=items.find(entry=>entry.article_id===id);
  if(!item||item.content_type==='expert_video'||item.editorial_image_url||sourceImage(item,items)||item.commons_image_url)continue;
  const term=subjectFor(item)?.name||'';
  if(!term)continue;
  try{
    const page=(await candidates(term,item)).find(entry=>!used.has(entry.imageinfo[0].descriptionurl));
    if(!page)continue;
    const info=page.imageinfo[0];
    item.commons_image_url=info.thumburl||info.url;
    item.commons_image_page_url=info.descriptionurl;
    item.commons_image_license=plain(info.extmetadata.LicenseShortName.value);
    item.commons_image_license_url=String(info.extmetadata.LicenseUrl?.value||'');
    item.commons_image_credit=plain(info.extmetadata.Artist?.value)||'Wikimedia Commons';
    item.commons_image_subject=term;
    item.commons_image_review_version=REVIEW_VERSION;
    used.add(info.descriptionurl);
    added++;
  }catch(error){console.warn(`Commons image unavailable for ${id}: ${error.message}`);}
}
}
if(added||removed||reviewed)fs.writeFileSync(dataFile,JSON.stringify(items,null,2)+'\n');
console.log(`Commons images: ${added} added, ${removed} unrelated removed, ${reviewed} existing reviewed`);
