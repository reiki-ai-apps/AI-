import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {sourceImage,articleVisual,videoThumbnail,extractSourceImage}=require('./source-image.cjs');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const publisher='https://openai.com/index/test-article';
const image='https://cdn.openai.com/images/article-photo.webp';
const item={content_type:'article',source_url:publisher,source_image_page_url:publisher,source_image_url:image};
assert.equal(sourceImage(item),image,'verified source-bound image is displayed');
assert.equal(sourceImage({...item,source_image_page_url:'https://openai.com/index/other'}),'','image cannot be borrowed from another article');
assert.equal(sourceImage({...item,source_url:'https://news.google.com/rss/articles/123'}),'','Google News redirect is not an image source');
assert.equal(sourceImage({...item,source_image_url:'javascript:alert(1)'}),'','unsafe image URL is hidden');
assert.equal(sourceImage({content_type:'article',source_url:publisher}),'','article without verified image has no decorative fallback');
assert.deepEqual(articleVisual(item),{url:image,kind:'source',label:'情報元の記事画像'},'original image takes priority');
assert.equal(articleVisual({...item,source_image_url:'',primary_entity:'OpenAI'}).kind,'brand','OpenAI story uses its official logo');
assert.equal(articleVisual({title:'OpenAIと競争する他社',primary_entity:'他社'}),null,'mention alone must not borrow OpenAI logo');
assert.equal(articleVisual({title:'半導体株が下落',primary_entity:'半導体業界'}).kind,'photo');
assert.equal(articleVisual({title:'AI脆弱性チェックを追加',primary_entity:'アステリア'}).url.endsWith('/photo-code-screen.jpg'),true);
assert.equal(articleVisual({title:'米8州がOpenAIを提訴',primary_entity:'OpenAI'}).url.endsWith('/photo-courthouse.jpg'),true,'a matched photograph precedes the logo');
assert.equal(articleVisual({title:'数学論文を発表'}).credit,'David Malone / CC BY 4.0','attribution is retained');
assert.equal(articleVisual({title:'Anthropicの自主規制、裁判資料がアモデイCEOの葛藤を明らかに'}).url.endsWith('/photo-anthropic-visit.jpg'),true,'a person/organization photo precedes generic court imagery');
const video={content_type:'expert_video',video_id:'abcDEF12345'};
assert.equal(videoThumbnail(video),'https://i.ytimg.com/vi/abcDEF12345/hqdefault.jpg');
assert.equal(sourceImage(video),videoThumbnail(video));
assert.equal(videoThumbnail({...video,video_id:'invalid'}),'');
assert.equal(extractSourceImage(`<meta property="og:url" content="${publisher}/"><meta content="${image}" property="og:image">`,publisher),image);
assert.equal(extractSourceImage(`<meta property="og:url" content="https://openai.com/index/other"><meta property="og:image" content="${image}">`,publisher),'');
assert.match(html,/function articleMedia\(u\)/);
assert.match(html,/function articleVisual\(u\)/);
assert.match(html,/primary_entity:String\(it\?\.primary_entity\|\|''\)/,'browser import retains exact entity for brand matching');
assert.match(html,/visual\?`<div class="ucard-image/);
assert.match(html,/coverVisual\?`<div class="daily-cover-image/);
assert.doesNotMatch(html,/話題のイメージ画像/);
// Test the mapping with fixed examples. The live top five changes several times a day;
// a new story without a licensed photo must not stop the entire news update.
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
  const visual=articleVisual({title});
  assert.equal(visual?.kind,'photo',`fixed topic has a real photo: ${title}`);
  assert.ok(fs.existsSync(new URL(`../assets/${visual.url.split('/').pop()}`,import.meta.url)),`bundled photo exists: ${title}`);
  assert.ok(visual.label&&visual.creditUrl?.startsWith('https://commons.wikimedia.org/wiki/File:'),`photo attribution exists: ${title}`);
}
assert.equal(articleVisual({title:'画像に対応しない未知のニュース'}),null,'unknown story safely remains without an invented image');
console.log('Article visuals passed: source image first, fixed photo mappings verified without blocking changing news.');
