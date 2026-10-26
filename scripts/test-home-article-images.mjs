import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {articleVisual}=require('./source-image.cjs');
const {REVIEW_VERSION,relevantCommonsImage}=require('./article-image-policy.cjs');
const items=JSON.parse(fs.readFileSync(new URL('../data.json',import.meta.url),'utf8'));
const edition=JSON.parse(fs.readFileSync(new URL('../home-edition.json',import.meta.url),'utf8'));
const byId=new Map(items.map(item=>[item.article_id,item]));
const seen=new Map();
let covered=0;
const selectedIds=edition.article_ids||[];
assert.deepEqual(items.filter(item=>Number(item.home_top_rank)>0).sort((a,b)=>a.home_top_rank-b.home_top_rank)
  .map(item=>item.article_id),selectedIds,'visible home ranks match the selected edition');
for(const id of selectedIds){
  const item=byId.get(id);
  assert.ok(item,`home article exists: ${id}`);
  if(item.commons_image_url){
    assert.equal(item.commons_image_review_version,REVIEW_VERSION,`Commons photo reviewed: ${id}`);
    assert.ok(relevantCommonsImage(item,item.commons_image_page_url),`Commons photo matches article: ${id}`);
  }
  const visual=articleVisual(item,items);
  if(!visual)continue;
  covered++;
  const prior=seen.get(visual.url);
  assert.ok(!prior||prior===item.source_url,`image reused across different home stories: ${id} and ${prior}`);
  seen.set(visual.url,item.source_url);
}
console.log(`Home imagery: ${covered}/${selectedIds.length} article-specific visuals; missing images are reported, not fabricated.`);
if(covered<selectedIds.length)
  console.warn(`::warning::Home imagery is ${covered}/${selectedIds.length}; remaining stories need a verified publisher photo, relevant licensed photograph, or unique editorial artwork.`);
if(!selectedIds.length)console.warn('::warning::No selected home stories; imagery coverage cannot be evaluated for this edition.');
