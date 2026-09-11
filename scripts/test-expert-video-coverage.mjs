import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const {
  EXPERT_VIDEO_MAX_AGE_DAYS,isExpertVideoItem,jstDayKey,shouldRefreshExpertVideos,isFreshExpertVideo,
  parseYouTubeChannelVideos,matchedExpertsForSource,
  dedupeExpertVideoCandidates,selectExpertVideoArchivePicks,selectExpertVideoReviewCandidates,
  isSubstantiveAiVideo,buildExpertWebDiscoveryUrl,finalizeExpertVideoEdition,extractVideoChapters
}=require("./expert-video.cjs");

const registry=JSON.parse(fs.readFileSync(new URL("../expert-sources.json",import.meta.url),"utf8"));
const updateSource=fs.readFileSync(new URL("../update.js",import.meta.url),"utf8");
const homeEditionSource=fs.readFileSync(new URL("./home-edition.cjs",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const workflow=fs.readFileSync(new URL("../.github/workflows/update.yml",import.meta.url),"utf8");
const data=JSON.parse(fs.readFileSync(new URL("../data.json",import.meta.url),"utf8"));
const dailyState=JSON.parse(fs.readFileSync(new URL("../.expert-video-state.json",import.meta.url),"utf8"));

// 実際のホーム選定関数を実行し、翌日の候補が複数になっても1件を超えないことを守る。
const homeSelectorSource=html.match(/function homeExpertVideos\(items\)\{[\s\S]*?\n\}\nfunction expertVideoCard/)?.[0]
  ?.replace(/\nfunction expertVideoCard$/,"");
assert.ok(homeSelectorSource,"ホームの動画選定関数が存在する");
const selectHomeVideos=Function("isExpertVideo","byFeedOrder",`${homeSelectorSource}; return homeExpertVideos;`)(
  isExpertVideoItem,(a,b)=>b.order-a.order
);
const homeVideoFixtures=[
  {content_type:"article",video_id:"news",order:9},
  {content_type:"expert_video",video_id:"older",expert_id:"expert-a",order:1},
  {content_type:"expert_video",video_id:"newer",expert_id:"expert-b",order:3},
  {content_type:"expert_video",video_id:"middle",expert_id:"expert-c",order:2}
];
const homeFixturesBefore=JSON.stringify(homeVideoFixtures);
assert.deepEqual(selectHomeVideos(homeVideoFixtures).map(item=>item.video_id),["newer"],"複数の動画があっても既存の優先順で1件だけをホームに表示する");
assert.equal(JSON.stringify(homeVideoFixtures),homeFixturesBefore,"分類ページ用の動画を削除・並べ替えない");
assert.equal(selectHomeVideos([homeVideoFixtures[1]]).length,1,"動画が1件だけならそのまま表示する");
assert.equal(selectHomeVideos([]).length,0,"候補がないとき架空の動画を補充しない");
assert.equal(selectHomeVideos([homeVideoFixtures[0]]).length,0,"通常記事を動画枠へ混ぜない");

assert.equal(registry.version,"ai-radar-experts-2026-09-10-v2","専門家台帳の版を固定する");
assert.equal(registry.web_discovery.lookback_days,10,"Web動画探索を投稿10日以内に絞る");
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
  {content_type:"expert_video",expert_id:"shota-imai",video_id:"same-video-1",source_url:"https://www.youtube.com/watch?v=same-video-1",title:"今井翔太が生成AIの進化を解説",published_at:"2026-09-09T01:00:00Z",source_published_at:"2026-09-09T01:00:00Z",source_date_status:"published"},
  {content_type:"expert_video",expert_id:"shota-imai",video_id:"same-video-1",source_url:"https://example.com/mirror",title:"今井翔太が生成AIの進化を解説",published_at:"2026-09-09T02:00:00Z",source_published_at:"2026-09-09T02:00:00Z",source_date_status:"published"},
  {content_type:"expert_video",expert_id:"yutaka-matsuo",video_id:"other-video",source_url:"https://example.com/other",title:"松尾豊がAI政策を講演",published_at:"2026-09-09T03:00:00Z",source_published_at:"2026-09-09T03:00:00Z",source_date_status:"published"}
];
const testNow=Date.parse("2026-09-10T00:00:00Z");
assert.equal(dedupeExpertVideoCandidates(duplicateFixture).length,2,"同じ動画・同じ発言を重複させない");
assert.equal(selectExpertVideoArchivePicks(duplicateFixture,3,testNow).length,2,"専門家動画の公開枠を独立して確保する");
const exactlyTenDays={content_type:"expert_video",source_published_at:"2026-08-31T00:00:00Z",source_date_status:"published"};
const tooOld={...exactlyTenDays,source_published_at:"2026-08-30T23:59:59Z"};
const unknownDate={content_type:"expert_video",published_at:"2026-09-09T00:00:00Z",source_published_at:"",source_date_status:"unknown"};
assert.equal(EXPERT_VIDEO_MAX_AGE_DAYS,10,"専門家動画の公開期限を10日に固定する");
assert.equal(isFreshExpertVideo(exactlyTenDays,testNow),true,"投稿からちょうど10日の動画は掲載できる");
assert.equal(isFreshExpertVideo(tooOld,testNow),false,"投稿から10日を超えた動画は掲載しない");
assert.equal(isFreshExpertVideo(unknownDate,testNow),false,"投稿日を確認できない動画は掲載しない");
const beforeJstMidnight=Date.parse("2026-09-09T14:59:59Z");
const afterJstMidnight=Date.parse("2026-09-09T15:00:00Z");
assert.equal(jstDayKey(beforeJstMidnight),"2026-09-09","日次判定は日本時間を使う");
assert.equal(jstDayKey(afterJstMidnight),"2026-09-10","日本時間の日付変更で次の動画更新を許可する");
assert.equal(shouldRefreshExpertVideos({last_successful_refresh_day_jst:"2026-09-10"},afterJstMidnight),false,"同じ日本日の2回目以降は動画探索しない");
assert.equal(shouldRefreshExpertVideos({last_successful_refresh_day_jst:"2026-09-09"},afterJstMidnight),false,"深夜の手動実行で当日の朝更新を消費しない");
const morning=Date.parse("2026-09-09T22:17:00Z");
const morningState={last_published_day_jst:"2026-09-10",last_successful_refresh_day_jst:"2026-09-10",last_successful_refresh_at:"2026-09-09T22:17:00Z"};
assert.equal(shouldRefreshExpertVideos({},morning-1),false,"朝7:17より前には更新しない");
assert.equal(shouldRefreshExpertVideos({},morning),true,"朝7:17から手動再実行も可能");
assert.equal(shouldRefreshExpertVideos({},morning,"17 22 * * *"),true,"朝の定期実行で動画を更新する");
assert.equal(shouldRefreshExpertVideos(morningState,morning+60000,"17 22 * * *"),false,"同じ朝の成功後は再更新しない");
assert.equal(shouldRefreshExpertVideos({last_successful_refresh_day_jst:"2026-09-10",last_successful_refresh_at:"2026-09-09T16:04:36Z"},morning,"17 22 * * *"),true,"旧方式の深夜更新があっても朝に更新する");
const afternoon=Date.parse("2026-09-10T04:17:00Z");
assert.equal(shouldRefreshExpertVideos({},afternoon,"17 4 * * *"),true,"未更新なら昼に再試行する");
assert.equal(shouldRefreshExpertVideos({},afternoon,"17 10 * * *"),true,"未更新なら夜にも再試行する");
assert.equal(shouldRefreshExpertVideos({},afternoon),true,"当日の手動救済を午後も許可する");
assert.equal(shouldRefreshExpertVideos(morningState,afternoon,"17 4 * * *"),false,"掲載済みの日は昼に差し替えない");
assert.equal(shouldRefreshExpertVideos({},afternoon,"17 22 * * *"),true,"朝の定期実行が遅延しても更新できる");
assert.equal(shouldRefreshExpertVideos(morningState,morning+86400000,"17 22 * * *"),true,"翌朝は再び更新する");
assert.equal(isSubstantiveAiVideo("【VLOG】AIロボタクシーに体験乗車してみた"),false,"VLOGを重要発言として扱わない");
assert.equal(isSubstantiveAiVideo("AIコーディングが仕事をどう変えるか、実装例を対談で解説"),true,"具体的な解説・対談を候補にする");
const cybercabTitle='テスラの無人タクシー「サイバーキャブ」の何がすごいのか解説します';
assert.equal(isSubstantiveAiVideo(cybercabTitle),true,"AIという文字がない自動運転解説も拾う");
assert.equal(isSubstantiveAiVideo(cybercabTitle.normalize('NFD')),true,"YouTubeの分離した濁点を正規化する");
assert.equal(isSubstantiveAiVideo('新型自動車の内装と乗り心地を解説'),false,"一般の車レビューまでAI動画へ広げない");
assert.equal(isSubstantiveAiVideo('サイバーキャブに体験乗車【VLOG】'),false,"自動運転でも体験VLOGは対象外");
assert.match(html,/function importedContextSourceFields/,"補助報道の出典を端末へ引き継ぐ");
assert.match(html,/解説の確認元/,"動画本文を直接確認できない場合の根拠を表示する");
const reviewFixture=[
  {content_type:"expert_video",expert_id:"a",video_id:"a1",title:"AIの仕組みを解説",published_at:"2026-09-08T00:00:00Z",source_published_at:"2026-09-08T00:00:00Z",source_date_status:"published",source_trust:"primary"},
  {content_type:"expert_video",expert_id:"a",video_id:"a2",title:"AI実装を対談",published_at:"2026-09-07T00:00:00Z",source_published_at:"2026-09-07T00:00:00Z",source_date_status:"published",source_trust:"primary"},
  {content_type:"expert_video",expert_id:"b",video_id:"b1",title:"生成AI政策を講演",published_at:"2026-09-06T00:00:00Z",source_published_at:"2026-09-06T00:00:00Z",source_date_status:"published",source_trust:"institutional"},
  {content_type:"expert_video",expert_id:"c",video_id:"c1",title:"古いAI講演",published_at:"2026-08-01T00:00:00Z",source_published_at:"2026-08-01T00:00:00Z",source_date_status:"published",source_trust:"institutional"}
];
const reviewPicks=selectExpertVideoReviewCandidates(reviewFixture,3,2,Date.parse("2026-09-09T00:00:00Z"));
const priorVideo={featured_video_key:'a1',last_published_day_jst:'2026-09-08',last_published_at:'2026-09-08T00:00:00Z',published_history:[{video_key:'a1',day_jst:'2026-09-08'}]};
const selectionTime=Date.parse('2026-09-09T00:00:00Z');
const edition=finalizeExpertVideoEdition(reviewFixture,priorVideo,selectionTime,{refreshDue:true,successfulSources:15});
assert.notEqual(edition.state.featured_video_key,'a1','前日の動画を更新済みとして再掲載しない');
assert.equal(edition.state.last_published_day_jst,'2026-09-09');
assert.equal(edition.items.filter(item=>item.home_video_selected_at).length,1,'ホームの選定は常に最大1件');
const unchanged=finalizeExpertVideoEdition(reviewFixture,edition.state,selectionTime+3600000,{refreshDue:true});
assert.equal(unchanged.state.featured_video_key,edition.state.featured_video_key,'同日二重更新を防ぐ');
const pending=finalizeExpertVideoEdition([reviewFixture[0]],priorVideo,selectionTime,{refreshDue:true,successfulSources:15});
assert.equal(pending.state.status,'pending_no_new_publishable_video','取得成功でも別動画がなければ未完了');
assert.equal(pending.state.last_published_day_jst,'2026-09-08','取得だけで成功日を書き換えない');
assert.equal(shouldRefreshExpertVideos(pending.state,selectionTime+6*3600000),true,'未完了は昼に再試行できる');
assert.equal(finalizeExpertVideoEdition([],priorVideo,selectionTime,{refreshDue:true}).items.length,0,'候補なしでも架空の記事を作らない');
const actualSelection=selectHomeVideos([{...reviewFixture[0],order:9},{...reviewFixture[2],home_video_selected_at:new Date(selectionTime).toISOString(),order:1}]);
assert.equal(actualSelection[0].video_id,'b1','元動画が少し古くても今日の選定がホームに出る');
const chapters=extractVideoChapters('採用キャンペーン\n00:00 はじめに\n31:19 日本でのAI活用\n35:56 AIと専門性\n切り抜き禁止');
assert.ok(chapters.includes('31:19 日本でのAI活用'));
assert.ok(!chapters.includes('キャンペーン')&&!chapters.includes('切り抜き'));
assert.equal(isSubstantiveAiVideo('安野貴博のAI解説 '+chapters),true,'宣伝や転載禁止の注意書きで本編を除外しない');
assert.equal(reviewPicks.length,3,"1人目だけで止めず、良質な次候補まで審査する");
assert.equal(new Set(reviewPicks.slice(0,2).map(item=>item.expert_id)).size,2,"先に異なる専門家を審査する");
assert.ok(buildExpertWebDiscoveryUrl(nakajima).includes("news.google.com/rss/search"),"Web動画探索フィードを作る");

assert.match(updateSource,/shouldRefreshExpertVideos\(expertVideoState,editionNow,process.env.AI_UPDATE_SCHEDULE/,"動画の探索を朝の定期実行に結び付ける");
assert.ok(workflow.includes('AI_UPDATE_SCHEDULE: ${{ github.event.schedule }}'),"朝・昼・夜の起動元を判定へ渡す");
assert.match(updateSource,/finalizeExpertVideoEdition\(applyHomeEdition/,"動画の実際の掲載結果で成功を判定する");
assert.match(updateSource,/isFreshExpertVideo\(item,editionNow,EXPERT_VIDEO_MAX_AGE_DAYS\)/,"キャッシュを含む全公開経路で10日超の動画を除外する");
assert.match(updateSource,/AI_DAILY_EXPERT_LIMIT\s*=\s*14/,"記事枠が埋まっても専門家動画の専用審査枠を確保する");
assert.match(updateSource,/enrichNewItems\(expertReviewCandidates,cache,ledger,"expert",2\)/,"専門家動画を記事とは別の小分けバッチで審査する");
assert.match(updateSource,/"shortDescription"/,"YouTubeの短い定型メタ情報ではなく動画の完全な説明文を読む");
assert.match(updateSource,/詳細なチャプター一覧/,"公式チャプターを検証可能な動画内容として審査する");
assert.match(updateSource,/isYouTubeSource\?18000:7000/,"YouTubeの完全説明を待つため取得時間を確保する");
assert.match(updateSource,/fetchYouTubePlayerDescription/,"通常ページの説明が短い時はYouTube公式player応答で補完する");
assert.match(updateSource,/videoDetails\?\.shortDescription/,"YouTube公式player応答の完全説明欄を使う");
assert.match(updateSource,/parseYouTubeVideoFeed/,"公式チャンネルRSSの説明と公開日時も候補へ統合する");
assert.match(updateSource,/EXPERT TITLE FALLBACK/,"説明取得障害時も具体的な公式タイトルだけ安全に掲載する");
assert.match(updateSource,/EXPERT_TITLE_FALLBACK_BLOCK_PATTERN/,"誇張・切り抜き・販促動画をタイトル救済から除外する");
assert.match(updateSource,/expertResult\.processed\+expertTitleFallbacks\.length/,"専門家動画だけ追加できた回も公開処理を継続する");
assert.match(updateSource,/hasPublishableExpertCache/,"日次審査枠を使い切っても保存済み専門家動画を公開できる");
assert.match(updateSource,/content_type:\s*"expert_video"/,"動画を公開データで識別する");
assert.match(updateSource,/発言者の意見・予測・評価は確定事実として書かず/,"専門家の見解を事実と混同しない");
assert.match(homeEditionSource,/isEditorialArticle/,"記事トップ5を記事だけに固定する");
assert.match(html,/専門家の重要発言/,"ホームに記事とは別の専門家枠を表示する");
assert.match(html,/記事と専門家動画・発言/,"分類検索で種類を区別する");
assert.match(workflow,/test-expert-video-coverage\.mjs/,"定期更新前に専門家動画契約を検査する");
assert.match(workflow,/\.expert-video-state\.json/,"成功した日次動画確認を公開コミットへ保存する");
assert.equal(dailyState.max_age_days,10,"日次状態にも10日ルールを明示する");

for(const item of data.filter(isExpertVideoItem)){
  for(const key of ["expert_id","expert_name","expert_role","expert_tier","platform","source_trust"]){
    assert.ok(String(item[key]||"").trim(),`公開動画に${key}を保存する`);
  }
  assert.equal(Number(item.home_top_rank)||0,0,"専門家動画を記事トップ5へ混ぜない");
}

console.log("Expert video coverage tests passed.");
