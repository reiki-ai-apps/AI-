import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {articleVisual}=require('./source-image.cjs');
const {REVIEW_VERSION,relevantCommonsImage}=require('./article-image-policy.cjs');
function audit(items,edition){
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
  return {covered,total:selectedIds.length};
}

// Non-empty fixtures keep the quality gate meaningful even on a NO_NEW_STORIES day.
const sourceFixture={article_id:'article_fixture_source',home_top_rank:1,content_type:'article',
  source_url:'https://openai.com/index/fixture',source_image_page_url:'https://openai.com/index/fixture',
  source_image_url:'https://cdn.openai.com/fixture-photo.jpg'};
const editorialId='article_c79b90537d390e19bfc0';
const editorialFixture={article_id:editorialId,home_top_rank:2,content_type:'article',
  editorial_image_url:`assets/story-photos/${editorialId}.png`};
assert.deepEqual(audit([sourceFixture,editorialFixture],{article_ids:[sourceFixture.article_id,editorialId]}),
  {covered:2,total:2},'two distinct story images render on a populated home');
assert.deepEqual(audit([{...editorialFixture,home_top_rank:1},{...sourceFixture,home_top_rank:2}],
  {article_ids:[editorialId,sourceFixture.article_id]}),{covered:2,total:2},'rotation keeps image/article binding');
assert.deepEqual(audit([], {article_ids:[]}),{covered:0,total:0},'empty selection is recognized, not counted as image coverage');
assert.throws(()=>audit([{...sourceFixture,home_top_rank:5}],{article_ids:[]}),
  /visible home ranks/,'stale rank cannot masquerade as a selected story');
const runwayFixture={article_id:'article_fixture_runway',home_top_rank:1,primary_entity:'Runway',
  title:'RunwayのCEOがAI動画について発言',commons_image_url:'https://upload.wikimedia.org/example.jpg',
  commons_image_page_url:'https://commons.wikimedia.org/wiki/File:Brussels_Airport_Runway_25_R.jpg',
  commons_image_subject:'Runway AI',commons_image_review_version:REVIEW_VERSION};
assert.throws(()=>audit([runwayFixture],{article_ids:[runwayFixture.article_id]}),
  /Commons photo matches article/,'airport photograph is not an image of Runway AI');

const items=JSON.parse(fs.readFileSync(new URL('../data.json',import.meta.url),'utf8'));
const edition=JSON.parse(fs.readFileSync(new URL('../home-edition.json',import.meta.url),'utf8'));
const {covered,total}=audit(items,edition);
console.log(`Home imagery: ${covered}/${total} article-specific visuals; missing images are reported, not fabricated.`);
if(covered<total)
  console.warn(`::warning::Home imagery is ${covered}/${total}; remaining stories need a verified publisher photo, relevant licensed photograph, or unique editorial artwork.`);
if(!total)console.warn('::warning::No selected home stories; imagery coverage cannot be evaluated for this edition.');
