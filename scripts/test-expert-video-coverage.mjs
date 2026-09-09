import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const {
  isExpertVideoItem,parseYouTubeChannelVideos,matchedExpertsForSource,
  dedupeExpertVideoCandidates,selectExpertVideoArchivePicks,selectExpertVideoReviewCandidates,
  isSubstantiveAiVideo,buildExpertWebDiscoveryUrl
}=require("./expert-video.cjs");

const registry=JSON.parse(fs.readFileSync(new URL("../expert-sources.json",import.meta.url),"utf8"));
const updateSource=fs.readFileSync(new URL("../update.js",import.meta.url),"utf8");
const homeEditionSource=fs.readFileSync(new URL("./home-edition.cjs",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const workflow=fs.readFileSync(new URL("../.github/workflows/update.yml",import.meta.url),"utf8");
const data=JSON.parse(fs.readFileSync(new URL("../data.json",import.meta.url),"utf8"));

assert.equal(registry.version,"ai-radar-experts-2026-09-09-v1","専門家台帳の版を固定する");
assert.ok(registry.experts.length>=8,"初期専門家を8人以上登録する");
for(const name of ["松尾豊","岡野原大輔","今井翔太","中島聡","安野貴博","落合陽一","山本一成","堀江貴文"]){
  assert.ok(registry.experts.some(expert=>expert.name===name),`${name}を専門家台帳へ登録する`);
}
const horie=registry.experts.find(expert=>expert.name==="堀江貴文");
assert.equal(horie.tier,"informed_business_commentary","研究者と事業解説者を同じ区分にしない");
assert.ok(registry.experts.every(expert=>expert.selection_reason&&expert.profile_url),"選定理由と確認先を全員分保存する");
assert.ok(registry.trusted_hosts.some(host=>host.trust==="institutional"),"公的・研究機関の公式配信を監視する");
assert.ok(registry.web_discovery?.enabled,"YouTube以外の動画・講演ページも探索する");

const fixture='\\x22videoRenderer\\x22:\\x7b\\x22videoId\\x22:\\x22abcDEF12345\\x22,\\x22thumbnail\\x22:\\x7b\\x7d,\\x22title\\x22:\\x7b\\x22runs\\x22:\\x5b\\x7b\\x22text\\x22:\\x22AIがコードを書く時代を中島聡が解説\\x22\\x7d\\x5d\\x7d,\\x22publishedTimeText\\x22:\\x7b\\x22simpleText\\x22:\\x221日前\\x22\\x7d';
const parsed=parseYouTubeChannelVideos(fixture,{source_name:"中島聡のLife is Beautiful"},Date.parse("2026-09-09T00:00:00Z"));
assert.equal(parsed.length,1,"YouTube公式チャンネルHTMLから動画を抽出する");
assert.equal(parsed[0].videoId,"abcDEF12345");
const nakajima=registry.experts.find(expert=>expert.name==="中島聡");
assert.deepEqual(matchedExpertsForSource(parsed[0].title,{expert_id:nakajima.id},registry).map(expert=>expert.id),[nakajima.id]);

const duplicateFixture=[
  {content_type:"expert_video",expert_id:"shota-imai",video_id:"same-video-1",source_url:"https://www.youtube.com/watch?v=same-video-1",title:"今井翔太が生成AIの進化を解説",published_at:"2026-09-09T01:00:00Z"},
  {content_type:"expert_video",expert_id:"shota-imai",video_id:"same-video-1",source_url:"https://example.com/mirror",title:"今井翔太が生成AIの進化を解説",published_at:"2026-09-09T02:00:00Z"},
  {content_type:"expert_video",expert_id:"yutaka-matsuo",video_id:"other-video",source_url:"https://example.com/other",title:"松尾豊がAI政策を講演",published_at:"2026-09-09T03:00:00Z"}
];
assert.equal(dedupeExpertVideoCandidates(duplicateFixture).length,2,"同じ動画・同じ発言を重複させない");
assert.equal(selectExpertVideoArchivePicks(duplicateFixture,3).length,2,"専門家動画の公開枠を独立して確保する");
assert.equal(isSubstantiveAiVideo("【VLOG】AIロボタクシーに体験乗車してみた"),false,"VLOGを重要発言として扱わない");
assert.equal(isSubstantiveAiVideo("AIコーディングが仕事をどう変えるか、実装例を対談で解説"),true,"具体的な解説・対談を候補にする");
const reviewFixture=[
  {content_type:"expert_video",expert_id:"a",video_id:"a1",title:"AIの仕組みを解説",published_at:"2026-09-08T00:00:00Z",source_trust:"primary"},
  {content_type:"expert_video",expert_id:"a",video_id:"a2",title:"AI実装を対談",published_at:"2026-09-07T00:00:00Z",source_trust:"primary"},
  {content_type:"expert_video",expert_id:"b",video_id:"b1",title:"生成AI政策を講演",published_at:"2026-09-06T00:00:00Z",source_trust:"institutional"}
];
const reviewPicks=selectExpertVideoReviewCandidates(reviewFixture,3,2,Date.parse("2026-09-09T00:00:00Z"));
assert.equal(reviewPicks.length,3,"1人目だけで止めず、良質な次候補まで審査する");
assert.equal(new Set(reviewPicks.slice(0,2).map(item=>item.expert_id)).size,2,"先に異なる専門家を審査する");
assert.ok(buildExpertWebDiscoveryUrl(nakajima).includes("news.google.com/rss/search"),"Web動画探索フィードを作る");

assert.match(updateSource,/collectExpertVideoCandidates/,"専門家動画を毎回収集する");
assert.match(updateSource,/AI_DAILY_EXPERT_LIMIT\s*=\s*10/,"記事枠が埋まっても専門家動画の専用審査枠を確保する");
assert.match(updateSource,/enrichNewItems\(expertReviewCandidates,cache,ledger,"expert",2\)/,"専門家動画を記事とは別の小分けバッチで審査する");
assert.match(updateSource,/"shortDescription"/,"YouTubeの短い定型メタ情報ではなく動画の完全な説明文を読む");
assert.match(updateSource,/詳細なチャプター一覧/,"公式チャプターを検証可能な動画内容として審査する");
assert.match(updateSource,/isYouTubeSource\?18000:7000/,"YouTubeの完全説明を待つため取得時間を確保する");
assert.match(updateSource,/content_type:\s*"expert_video"/,"動画を公開データで識別する");
assert.match(updateSource,/発言者の意見・予測・評価は確定事実として書かず/,"専門家の見解を事実と混同しない");
assert.match(homeEditionSource,/isEditorialArticle/,"記事トップ5を記事だけに固定する");
assert.match(html,/専門家の重要発言/,"ホームに記事とは別の専門家枠を表示する");
assert.match(html,/記事と専門家動画・発言/,"分類検索で種類を区別する");
assert.match(workflow,/test-expert-video-coverage\.mjs/,"定期更新前に専門家動画契約を検査する");

for(const item of data.filter(isExpertVideoItem)){
  for(const key of ["expert_id","expert_name","expert_role","expert_tier","platform","source_trust"]){
    assert.ok(String(item[key]||"").trim(),`公開動画に${key}を保存する`);
  }
  assert.equal(Number(item.home_top_rank)||0,0,"専門家動画を記事トップ5へ混ぜない");
}

console.log("Expert video coverage tests passed.");
