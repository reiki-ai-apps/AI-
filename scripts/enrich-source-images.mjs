import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {OFFICIAL_HOSTS,httpUrl,extractSourceImage}=require('./source-image.cjs');
const file=new URL('../data.json',import.meta.url);
const items=JSON.parse(fs.readFileSync(file,'utf8'));
let added=0;
async function pageHtml(url){
  let target=url;
  let response;
  for(let hop=0;hop<3;hop++){
    response=await fetch(target,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{'user-agent':'KIZASHI-source-image-check/1.0'}});
    if(![301,302,303,307,308].includes(response.status))break;
    const next=httpUrl(new URL(response.headers.get('location')||'',target));
    if(!next||!OFFICIAL_HOSTS.has(next.hostname)||next.hostname!==url.hostname)return '';
    target=next;
  }
  const final=httpUrl(response.url);
  if(!response.ok||!final||!OFFICIAL_HOSTS.has(final.hostname)||
    !String(response.headers.get('content-type')||'').includes('text/html'))return '';
  if(Number(response.headers.get('content-length')||0)>1_500_000)return '';
  const reader=response.body.getReader();
  const chunks=[];let size=0;
  while(true){
    const {done,value}=await reader.read();if(done)break;
    size+=value.length;if(size>1_500_000){await reader.cancel();return '';}
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
for(const item of items){
  if(String(item.content_type||'article')==='expert_video')continue;
  const url=httpUrl(item.source_url);
  if(!url||!OFFICIAL_HOSTS.has(url.hostname))continue;
  if(item.source_image_url&&item.source_image_page_url===item.source_url)continue;
  try{
    const image=extractSourceImage(await pageHtml(url),url);
    if(image){item.source_image_url=image;item.source_image_page_url=item.source_url;added++;}
  }catch(error){console.log(`Source image unavailable for ${url.hostname}: ${error.message}`);}
}
if(added)fs.writeFileSync(file,JSON.stringify(items,null,2)+'\n');
console.log(`Verified publisher preview images added: ${added}`);
