import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const {candidateStatus,selectTopArticles,buildHomeEdition,applyHomeEdition}=require("./home-edition.cjs");

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

const firstEdition=buildHomeEdition(candidates,{}, {windowStart:start,windowEnd:end,checkedAt:end});
const flagged=applyHomeEdition(candidates,firstEdition).filter(item=>item.home_top_rank);
assert.deepEqual(flagged.map(item=>item.home_top_rank).sort((a,b)=>a-b),[1,2,3,4,5],"1位の大型記事を含む合計5件に順位を付ける");
const carried=buildHomeEdition(candidates,firstEdition,{windowStart:end,windowEnd:end+3600000,checkedAt:end+3600000});
assert.equal(carried.carried_forward,true,"新着0件なら直前のトップ5を保持する");
assert.deepEqual(carried.article_ids,firstEdition.article_ids,"新着0件で表示記事を勝手に差し替えない");

const workflow=fs.readFileSync(".github/workflows/update.yml","utf8");
const crons=[...workflow.matchAll(/cron:\s*["']([^"']+)["']/g)].map(match=>match[1]);
assert.deepEqual(crons,["17 22 * * *","17 4 * * *","17 10 * * *"],"定期更新は日本時間の朝・昼・夜の3回だけ");

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

const edition=JSON.parse(fs.readFileSync("home-edition.json","utf8"));
assert.deepEqual(edition.article_ids,publicTop.map(item=>item.article_id),"選定正本と公開データのID順が一致する");
console.log("Edition publishing tests passed.");
