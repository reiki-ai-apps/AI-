import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {sourceImage,articleVisual,videoThumbnail,extractSourceImage}=require('./source-image.cjs');
const {storyVisualSvg}=require('./story-visual.cjs');
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
const uniqueA={article_id:'article_12345678',title:'OpenAIが新モデルを公開'};
const uniqueB={article_id:'article_87654321',title:'OpenAIが別の機能を公開'};
assert.equal(articleVisual(uniqueA).kind,'graphic','article without a source photo receives its own visual');
assert.notEqual(articleVisual(uniqueA).url,articleVisual(uniqueB).url,'different articles never share a generated visual');
assert.match(storyVisualSvg({...uniqueA,title:'AIと安全性 <検証>'}),/AIと安全性 &lt;検証&gt;/,'visual text is escaped');
assert.equal(articleVisual({...item,source_image_url:'',primary_entity:'OpenAI'}),null,'brand logos are not reused as article images');
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
assert.match(html,/assets\/story-visuals\/\$\{id\}\.svg/,'browser uses a unique published article visual');
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
console.log('Article visuals passed: source photos first, original video thumbnails, unique article illustrations without recycled stock photos.');
