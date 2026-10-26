import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {sourceImage,editorialImage,articleVisual,videoThumbnail,extractSourceImage}=require('./source-image.cjs');
const {REVIEW_VERSION,subjectFor,relevantCommonsImage}=require('./article-image-policy.cjs');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const publisher='https://openai.com/index/test-article';
const image='https://cdn.openai.com/images/article-photo.webp';
const item={content_type:'article',source_url:publisher,source_image_page_url:publisher,source_image_url:image};
assert.equal(sourceImage(item),image,'verified source-bound image is displayed');
assert.equal(sourceImage({...item,source_image_page_url:'https://openai.com/index/other'}),'','image cannot be borrowed from another article');
assert.equal(sourceImage({...item,source_url:'https://news.google.com/rss/articles/123'}),'','Google News redirect is not an image source');
assert.equal(sourceImage({...item,source_image_url:'javascript:alert(1)'}),'','unsafe image URL is hidden');
assert.equal(sourceImage({...item,source_image_url:publisher}),'','article URL is not an image');
assert.equal(sourceImage(item,[item,{...item,source_url:'https://openai.com/index/another-story',source_image_page_url:'https://openai.com/index/another-story'}]),'','one publisher preview image cannot be reused for different stories');
assert.equal(sourceImage(item,[item,{...item}]),image,'the same source article may show its own image in more than one view');
assert.equal(sourceImage({content_type:'article',source_url:publisher}),'','article without verified image has no decorative fallback');
assert.deepEqual(articleVisual(item),{url:image,kind:'source',label:'情報元の記事画像'},'original image takes priority');
const current=require('../data.json').filter(entry=>entry.editorial_image_url);
// The archive rotates. A count of four, five or zero is not a workflow failure.
assert.equal(new Set(current.map(entry=>entry.editorial_image_url)).size,current.length,'no editorial image is reused');
for(const entry of current){
  assert.equal(articleVisual(entry).kind,'editorial','article-specific imagery is used');
  assert.ok(editorialImage(entry).endsWith(entry.editorial_image_url),'local image is tied to this article id');
  assert.equal(editorialImage({...entry,article_id:'article_notthisone'}),'','an editorial image cannot be borrowed by another article');
}
assert.equal(articleVisual({...item,source_image_url:'',primary_entity:'OpenAI'}),null,'brand logos are not reused as article images');
const runway={article_id:'article_runway123',primary_entity:'Runway',title:'RunwayのCEOがAI動画について発言'};
const airport='https://commons.wikimedia.org/wiki/File:Brussels_Airport_Runway_25_R.jpg';
const runwayAi='https://commons.wikimedia.org/wiki/File:Runway_AI_video_generation_demo.jpg';
assert.equal(subjectFor(runway)?.name,'Runway AI');
assert.equal(relevantCommonsImage(runway,airport),false,'airport runway is unrelated to Runway AI');
assert.equal(relevantCommonsImage(runway,runwayAi),true,'Runway AI-specific filename may be considered');
assert.equal(relevantCommonsImage({primary_entity:'OpenAI',title:'OpenAIが新API「Decisions API」を発表'},
  'https://commons.wikimedia.org/wiki/File:OpenAI_Codex_extention_for_VScode.png'),false,'another product screen is unrelated');
assert.equal(relevantCommonsImage({primary_entity:'Canva',title:'Canva Craftを発表'},
  'https://commons.wikimedia.org/wiki/File:Multimedia_Pembelajaran_Interaktif_by_Canva.jpg'),false,'brand mention alone is insufficient for a named product');
assert.equal(articleVisual({...runway,commons_image_url:'https://upload.wikimedia.org/test.jpg',commons_image_page_url:airport,
  commons_image_subject:'Runway AI',commons_image_review_version:REVIEW_VERSION}),null,'unrelated cached photo never renders');
assert.equal(articleVisual({title:'OpenAIと競争する他社',primary_entity:'他社'}),null,'mention alone must not borrow OpenAI logo');
const video={content_type:'expert_video',video_id:'abcDEF12345'};
assert.equal(videoThumbnail(video),'https://i.ytimg.com/vi/abcDEF12345/hqdefault.jpg');
assert.equal(sourceImage(video),videoThumbnail(video));
assert.equal(videoThumbnail({...video,video_id:'invalid'}),'');
assert.equal(extractSourceImage(`<meta property="og:url" content="${publisher}/"><meta content="${image}" property="og:image">`,publisher),image);
assert.equal(extractSourceImage(`<meta property="og:url" content="https://openai.com/index/other"><meta property="og:image" content="${image}">`,publisher),'');
assert.equal(extractSourceImage(`<meta property="og:image" content="${publisher}">`,publisher),'','article page cannot be its own preview image');
assert.match(html,/function articleMedia\(u\)/);
assert.match(html,/function articleVisual\(u\)/);
assert.match(html,/visual\?`<div class="ucard-image/);
assert.match(html,/coverVisual\?`<div class="daily-cover-image/);
assert.match(html,/assets\/story-photos\/\$\{id\}\.png/,'browser uses a unique article photograph-style image');
assert.doesNotMatch(html,/assets\/story-visuals\/\$\{id\}\.svg/,'logo-like graphic fallback is removed');
assert.doesNotMatch(html,/話題のイメージ画像/);
// A topic or organization name must never recycle one stock photo across new stories.
for(const title of [
  'ジェンスン・フアン氏がAIについて発言',
  'AnthropicのアモデイCEOが発言',
  'Grok Voiceをテスラへ搭載',
  '中国政府が輸出規制を発表',
  'OpenAIが提訴された',
  '数学論文を発表',
  'AI脆弱性チェックを追加',
  '韓国株が上昇',
  '半導体の新製品',
  '株式市場の動向'
]){
  assert.equal(articleVisual({title}),null,`no recycled topic photo: ${title}`);
}
assert.equal(articleVisual({title:'画像に対応しない未知のニュース'}),null,'unknown story safely remains without an invented image');
assert.doesNotMatch(html,/photo-courthouse\.jpg|photo-stockmarket\.jpg|brand-openai-white-wordmark\.png/,'browser does not reuse generic article images');
assert.match(html,/other\.source_image_url===u\.source_image_url/,'browser hides publisher image duplicates across stories');
console.log('Article visuals passed: verified source photos first, unique labeled editorial images, no logo-like fallback.');
