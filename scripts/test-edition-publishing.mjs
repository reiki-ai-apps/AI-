import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const {candidateStatus,isToolEvolutionCandidate,sameEditionStory,selectTopArticles,buildHomeEdition,applyHomeEdition}=require("./home-edition.cjs");

const start=Date.parse("2026-09-02T00:00:00.000Z");
const end=Date.parse("2026-09-02T06:00:00.000Z");
const base=(id,published,extra={})=>({
  article_id:id,title:`記事${id}`,importance:"B",source_published_at:published,
  fetched_at:published,related_categories:["AIツール・モデル"],primary_entity:`企業${id}`,...extra
});

assert.equal(candidateStatus(base("at-start","2026-09-02T00:00:00.000Z"),start,end).eligible,false,"更新区間の開始点は前回分なので含めない");
assert.equal(candidateStatus(base("at-end","2026-09-02T06:00:00.000Z"),start,end).eligible,true,"更新区間の終了点は今回分として含める");
assert.equal(candidateStatus(base("late","2026-09-01T12:00:00.000Z",{fetched_at:"2026-09-02T01:00:00.000Z"}),start,end).lateArrival,true,"48時間以内の遅延取得を候補へ戻す");

const candidates=[
  base("s","2026-09-02T01:00:00.000Z",{importance:"S",title:"政府がAI安全規制を発表",is_official:true,primary_entity:"政府"}),
  base("a1","2026-09-02T02:00:00.000Z",{importance:"A",title:"OpenAIが新モデルを提供開始",primary_entity:"OpenAI"}),
  base("a2","2026-09-02T02:10:00.000Z",{importance:"A",title:"OpenAIが新しい基盤モデルを公開",primary_entity:"OpenAI"}),
  base("a3","2026-09-02T02:20:00.000Z",{importance:"A",title:"OpenAIが新機能を発表",primary_entity:"OpenAI"}),
  base("b1","2026-09-02T03:00:00.000Z",{title:"NVIDIAがAI半導体を発表",primary_entity:"NVIDIA"}),
  base("b2","2026-09-02T04:00:00.000Z",{title:"企業向けAIサービスを公開",primary_entity:"別企業"}),
  base("c","2026-09-02T05:00:00.000Z",{importance:"C",primary_entity:"小企業"})
];
const selection=selectTopArticles(candidates,{windowStart:start,windowEnd:end});
assert.equal(selection.selected.length,5,"ホーム選定は最大5件");
assert.equal(new Set(selection.selected.map(record=>record.score.article_id)).size,5,"選定IDは重複しない");
assert.equal(selection.selected[0].score.article_id,"s","重要度と社会影響の大きい記事が上位になる");
assert.ok(selection.selected.filter(record=>record.entity==="openai").length<=2,"候補がある場合は同一企業へ偏らない");

const geminiRich=base("gemini-rich","2026-09-02T04:30:00.000Z",{
  title:"Google、『Gemini 3.8 Flash』を公開 価格据え置きでCyberも追加",importance:"A",is_official:true,
  primary_entity:"Google",story_subject:"Gemini 3.8 Flashおよび防御特化モデルCyber",event_type:"release",event_stage:"launched",
  story_entities:["Google","Gemini 3.8 Flash","Gemini Cyber"],fact_slots:[{type:"version",scope:"モデル",value:"Gemini 3.8 Flash",normalized_value:"gemini3.8flash"}]
});
const geminiCopy=base("gemini-copy","2026-09-02T04:40:00.000Z",{
  title:"Google、Gemini 3.8 Flashを発表 6週間で3度目",importance:"A",
  primary_entity:"Google",story_subject:"Gemini 3.8 Flash",event_type:"release",event_stage:"launched",
  story_entities:["Google","Gemini 3.8 Flash"],fact_slots:[{type:"version",scope:"モデル名",value:"Gemini 3.8 Flash",normalized_value:"gemini3.8flash"}]
});
assert.equal(sameEditionStory(geminiRich,geminiCopy),true,"URLとstory_idが違っても同じ製品発表を同一ニュースと判定する");
const distinctPool=[
  geminiRich,geminiCopy,
  base("claude-tool","2026-09-02T04:50:00.000Z",{title:"AnthropicがClaude判定ツールを公開",primary_entity:"Anthropic",story_subject:"Claude判定ツール",event_type:"release",event_stage:"launched"}),
  base("runway-tool","2026-09-02T05:00:00.000Z",{title:"Runwayが動画ワークフロー機能を公開",importance:"C",primary_entity:"Runway",story_subject:"Runway動画ワークフロー",event_type:"release",event_stage:"launched",related_categories:["画像・動画生成"]}),
  base("policy","2026-09-02T05:10:00.000Z",{title:"政府がAI法案を承認",importance:"A",primary_entity:"政府",story_subject:"AI法案",event_type:"policy",event_stage:"approved"}),
  base("chip","2026-09-02T05:20:00.000Z",{title:"NVIDIAが新しいAI半導体を発表",primary_entity:"NVIDIA",story_subject:"AI半導体",event_type:"release",event_stage:"announced"})
];
const distinctSelection=selectTopArticles(distinctPool,{windowStart:start,windowEnd:end});
assert.equal(distinctSelection.ranked.length,6,"候補URLの監査件数は保持する");
assert.equal(distinctSelection.distinctRanked.length,5,"同じ出来事を統合した件数を別に記録する");
assert.equal(distinctSelection.selected.length,5,"別の出来事が5件あればトップ5を満たす");
assert.ok(distinctSelection.selected.some(record=>record.score.article_id==="gemini-rich"),"同じ出来事では公式性と情報量の強い記事を残す");
assert.ok(!distinctSelection.selected.some(record=>record.score.article_id==="gemini-copy"),"同じGemini発表を2枠へ入れない");

const progressionAnnouncement={...geminiCopy,article_id:"gemini-announcement",story_id:"story-gemini",event_stage:"announced"};
const progressionLaunch={...geminiRich,article_id:"gemini-launch",story_id:"story-gemini",event_stage:"launched",relation_type:"follow_up",previous_article_id:"gemini-announcement"};
assert.equal(sameEditionStory(progressionAnnouncement,progressionLaunch),false,"正式提供などの実質的な続報は別の進展として残せる");

const toolQuotaPool=[
  base("critical-1","2026-09-02T01:00:00.000Z",{importance:"S",title:"政府がAI安全法を施行",primary_entity:"政府",story_subject:"AI安全法",event_type:"policy",event_stage:"enacted"}),
  base("critical-2","2026-09-02T01:10:00.000Z",{importance:"S",title:"大規模AI障害の原因を特定",primary_entity:"基盤企業",story_subject:"大規模AI障害",event_type:"security",event_stage:"cause_identified"}),
  base("critical-3","2026-09-02T01:20:00.000Z",{importance:"S",title:"AI半導体の重大脆弱性を修正",primary_entity:"半導体企業",story_subject:"重大脆弱性",event_type:"security",event_stage:"fixed"}),
  base("important-other","2026-09-02T01:30:00.000Z",{importance:"A",title:"AI企業が大型資金調達",primary_entity:"投資先",story_subject:"大型資金調達",event_type:"funding",event_stage:"announced"}),
  base("kling-evolution","2026-09-02T01:40:00.000Z",{importance:"C",title:"Kling AIが動画編集の新機能を公開",primary_entity:"Kling AI",story_subject:"Kling動画編集機能",event_type:"release",event_stage:"launched",event_scope:"全世界",related_categories:["画像・動画生成"]}),
  base("canva-evolution","2026-09-02T01:50:00.000Z",{importance:"C",title:"CanvaがAIデザイン編集機能を提供開始",primary_entity:"Canva",story_subject:"Canva AIデザイン編集",event_type:"release",event_stage:"launched",event_scope:"全世界",related_categories:["画像・動画生成"]})
];
assert.equal(isToolEvolutionCandidate(toolQuotaPool[4]),true,"動画生成・編集ツールの能力差分を候補として認識する");
const toolQuotaSelection=selectTopArticles(toolQuotaPool,{windowStart:start,windowEnd:end});
assert.equal(toolQuotaSelection.selected.filter(record=>record.tool_evolution).length,2,"重大S級を守りながら有力なツール進化を2製品まで確保する");
assert.ok(toolQuotaSelection.selected.some(record=>record.score.article_id==="kling-evolution"),"Klingなど動画生成の進化を比較対象へ入れる");
assert.ok(toolQuotaSelection.selected.some(record=>record.score.article_id==="canva-evolution"),"Canvaなど編集ツールの進化を比較対象へ入れる");

const firstEdition=buildHomeEdition(candidates,{}, {windowStart:start,windowEnd:end,checkedAt:end});
const flagged=applyHomeEdition(candidates,firstEdition).filter(item=>item.home_top_rank);
assert.deepEqual(flagged.map(item=>item.home_top_rank).sort((a,b)=>a-b),[1,2,3,4,5],"1位の大型記事を含む合計5件に順位を付ける");
const carried=buildHomeEdition(candidates,firstEdition,{windowStart:end,windowEnd:end+3600000,checkedAt:end+3600000});
assert.equal(carried.carried_forward,true,"新着0件なら直前のトップ5を保持する");
assert.deepEqual(carried.article_ids,firstEdition.article_ids,"新着0件で表示記事を勝手に差し替えない");

const nextStart=end;
const nextEnd=end+6*3600000;
const priorGemini={...geminiRich,source_published_at:"2026-09-02T05:30:00.000Z",fetched_at:"2026-09-02T05:30:00.000Z"};
const nextGemini={...geminiCopy,article_id:"gemini-other-media",source_published_at:"2026-09-02T07:00:00.000Z",fetched_at:"2026-09-02T07:00:00.000Z"};
const priorGeminiEdition=buildHomeEdition([priorGemini],{}, {windowStart:start,windowEnd:end,checkedAt:end});
const crossEdition=buildHomeEdition([priorGemini,nextGemini],priorGeminiEdition,{windowStart:nextStart,windowEnd:nextEnd,checkedAt:nextEnd});
assert.equal(crossEdition.cross_edition_duplicate_count,1,"前72時間に掲載した同じ発表を別媒体の記事でも検知する");
assert.equal(crossEdition.carried_forward,true,"新しい事実のない同一ニュースでトップを差し替えない");
assert.deepEqual(crossEdition.article_ids,["gemini-rich"],"重複記事をトップ枠へ再掲載しない");

const materiallyNew={...nextGemini,article_id:"gemini-general-release",event_stage:"expanded",relation_type:"follow_up",previous_article_id:"gemini-rich",title:"Google、Gemini 3.8 Flashを一般提供へ拡大"};
const progressedEdition=buildHomeEdition([priorGemini,materiallyNew],priorGeminiEdition,{windowStart:nextStart,windowEnd:nextEnd,checkedAt:nextEnd});
assert.deepEqual(progressedEdition.article_ids,["gemini-general-release"],"正式提供など実質的に進んだ続報は新しいニュースとして残す");
assert.equal(progressedEdition.update_health,"HEALTHY","内容が変わった更新回は正常と記録する");

const staleOnce=buildHomeEdition([priorGemini],priorGeminiEdition,{windowStart:end,windowEnd:end+12*3600000,checkedAt:end+12*3600000});
const staleTwice=buildHomeEdition([priorGemini],staleOnce,{windowStart:end+12*3600000,windowEnd:end+25*3600000,checkedAt:end+25*3600000});
assert.equal(staleTwice.update_health,"DEGRADED","24時間不変または候補0件の連続を異常として見える化する");
assert.ok(staleTwice.update_health_reasons.length>=1,"更新停止の理由を監査できる");

const unsafeEdition={...firstEdition,article_ids:["gemini-rich","gemini-copy","runway-tool"],scores:{}};
const guarded=applyHomeEdition(distinctPool,unsafeEdition).filter(item=>item.home_top_rank).sort((a,b)=>a.home_top_rank-b.home_top_rank);
assert.deepEqual(guarded.map(item=>item.article_id),["gemini-rich","runway-tool"],"公開直前にも同じ出来事の2件目を落とす");

const workflow=fs.readFileSync(".github/workflows/update.yml","utf8");
const crons=[...workflow.matchAll(/cron:\s*["']([^"']+)["']/g)].map(match=>match[1]);
assert.deepEqual(crons,["17 22 * * *","17 4 * * *","17 10 * * *"],"定期更新は日本時間の朝・昼・夜の3回だけ");
const validationIndex=workflow.indexOf("- name: validate published articles");
const finalizeIndex=workflow.indexOf("node scripts/finalize-home-edition.mjs",validationIndex);
const buildArticlesIndex=workflow.indexOf("node scripts/build-public-articles.mjs",validationIndex);
assert.ok(validationIndex>=0&&finalizeIndex>validationIndex&&buildArticlesIndex>finalizeIndex,"記事検証後にトップ選定を作り直してから公開ページを生成する");

const html=fs.readFileSync("index.html","utf8");
assert.match(html,/function homeTopUpdates\(\)/,"ホーム専用の選定を使う");
assert.match(html,/const list=homeTopUpdates\(\)/,"ホームは選定済みトップ記事だけを描画する");
const renderHomeSource=html.slice(html.indexOf("function renderHome(v)"),html.indexOf("function byPub(a,b)"));
const feedRenderIndex=renderHomeSource.indexOf("feedList.forEach");
const secondaryRenderIndex=renderHomeSource.indexOf("html+=homeSecondaryHtml",feedRenderIndex);
assert.ok(feedRenderIndex>=0&&secondaryRenderIndex>feedRenderIndex,"トップ5の記事カードを統計・アーカイブ・公式SNSより先に描画する");
assert.match(renderHomeSource,/const homeSecondaryHtml=`<section class="home-secondary"/,"記事以外の案内を後半ブロックとして固定する");
assert.match(html,/const allArticles=getUpdates\(\)/,"分類・検索はテーマ設定前の全記事を使う");
assert.match(html,/\.archive-intro \+ \.filterbar\{display:grid;grid-template-columns:1fr\}/,"スマホの分類・検索を1列で操作できる");
const navSource=html.slice(html.indexOf("const NAV = ["),html.indexOf("let route ="));
assert.doesNotMatch(navSource,/id:'updates'/,"全記事と分類の重複ナビを残さない");
assert.match(navSource,/id:'categories',label:'記事を探す'/,"分類・検索を記事探索の正本にする");
assert.match(html,/function canonicalRouteName\(name\)\{ return name==='updates'\?'categories':name; \}/,"旧全記事URLは分類・検索へ互換転送する");
assert.doesNotMatch(html,/go\('updates'\)/,"画面内導線は旧全記事ルートを使わない");
assert.match(html,/\.bottom-nav\{[^}]*grid-template-columns:repeat\(4,1fr\)/,"スマホナビは統合後の4項目で均等表示する");
assert.match(html,/function renderCategories\(v\)\{\s*renderUpdates\(v\);\s*\}/,"分類ページへ検索と全記事一覧を統合する");
assert.match(html,/const categoryTiles=`<section class="category-browser"/,"分類ページに件数付きカテゴリ選択を置く");
assert.match(html,/function isArticleRead\(u\)/,"読了状態を保存・活用ステータスと分けて判定する");
assert.match(html,/function setReadProof\(id,persist=true\)/,"記事を消さず読了時刻を保存する");
assert.match(html,/function readProofBadge\(u\).*読了済み/,"読んだ証をカードへ表示する");
assert.match(html,/if\(!isArticleRead\(u\)\)\{ setReadProof\(u\.id\); \}/,"記事を開いた時に読了の印を付ける");
assert.match(html,/setStatus\(id,saved\?\(isArticleRead\(u\)\?'read':'unread'\):'try_later'\)/,"後で見るの解除で読了記録を失わない");
assert.match(html,/function renderTryList\(v\)\{[\s\S]*?const ups=getUpdates\(\)/,"テーマ外の保存記事も後で見るから消さない");
assert.doesNotMatch(html,/3時間ごと|プラン別の月間枠/,"廃止済みの更新頻度・会員向け文言を残さない");

const update=fs.readFileSync("update.js","utf8");
assert.match(update,/fetched_at:editionWindowEnd/,"この回で発見した記事を次回へ誤送しない");
assert.match(update,/const editionPicks=.*previousEdition\.article_ids/s,"直前のトップ5を公開上限より先に保持する");
assert.match(update,/const baseFinal=\[\.\.\.editionPicks,\.\.\.featuredPicks,\.\.\.freshPicks,\.\.\.restPicks\]/,"トップ5保持枠を公開データへ含める");

const data=JSON.parse(fs.readFileSync("data.json","utf8"));
const publicTop=data.filter(item=>Number(item.home_top_rank)>0).sort((a,b)=>a.home_top_rank-b.home_top_rank);
assert.ok(publicTop.length>=1&&publicTop.length<=5,"公開データのホーム指定は1〜5件");
assert.deepEqual(publicTop.map(item=>item.home_top_rank),Array.from({length:publicTop.length},(_,index)=>index+1),"公開順位は1から連続する");
for(const item of publicTop){
  assert.ok(item.home_selected_at&&item.home_window_start&&item.home_window_end,"選定記事に更新時刻と対象期間がある");
  assert.ok(Number.isFinite(Number(item.home_top_score)),"選定記事に審査点がある");
}
for(let left=0;left<publicTop.length;left++){
  for(let right=left+1;right<publicTop.length;right++){
    assert.equal(sameEditionStory(publicTop[left],publicTop[right]),false,`公開トップ5の${left+1}位と${right+1}位は別の出来事`);
  }
}

const edition=JSON.parse(fs.readFileSync("home-edition.json","utf8"));
assert.deepEqual(edition.article_ids,publicTop.map(item=>item.article_id),"選定正本と公開データのID順が一致する");
assert.equal(edition.selection_version,"cross-edition-novelty-v3","過去72時間の重複統合とツール進化枠を使う選定版である");
assert.equal(edition.distinct_candidate_count,edition.candidate_count-edition.duplicate_candidate_count,"候補URL数と異なる出来事件数を監査できる");
assert.equal(edition.novel_candidate_count,edition.distinct_candidate_count-edition.cross_edition_duplicate_count,"過去回との重複を除いた本当の新着件数を監査できる");
assert.ok(Array.isArray(edition.recent_story_history),"過去72時間の掲載履歴を次回の重複判定へ引き継ぐ");
assert.ok(["HEALTHY","DEGRADED"].includes(edition.update_health),"更新停止を検知できる健康状態を公開する");
console.log("Edition publishing tests passed.");
