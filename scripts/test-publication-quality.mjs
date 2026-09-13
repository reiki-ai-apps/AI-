import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {createRequire} from "node:module";
import {friendlyExplanationIssues,termExplanationIssues,publicationTextIssues} from "./publication-quality.cjs";
const require=createRequire(new URL("../update.js",import.meta.url));
const friendly=require("./scripts/friendly-explanation.cjs");
// Regression fixture: this valid paraphrase was previously rejected only by the release gate.
const detail=[
"Metaが新しいパーソナルAIエージェント「Muse」を発表した。パーソナルAIエージェントとは、利用者の代わりに作業を進める、自律的に動くAIアシスタントのことだ。これまでのAIアシスタントは質問に答えるだけのことが多かったが、Museは指示を受けてメール送信や旅行予約といった実際の作業を自分で進める点が新しい。",
"記事によれば、利用者がゴールをAIに伝えると、AI自身がその達成に必要な複数の作業を自律的にこなす設計になっている。具体的にはメールの送信や旅行の予約といった日常的なタスクをAIが代行する。これはAIが単なる会話相手から、実際に行動して結果を出す「エージェント」へと役割を広げる動きの一例といえる。",
"利用者は今後、日常的な事務作業をAIに任せられる可能性が広がる。ただし、AIが自律的にメール送信や予約を行うことに伴う誤操作やプライバシーへの配慮など、具体的な安全対策や提供時期は記事内で明らかにされていない。"
].join("\n\n");
assert.deepEqual(friendlyExplanationIssues(detail),[]);
assert.ok(friendly.hasDeepFriendlyExplanation(detail));
for(const text of [
  "AIエージェントは、答えるだけでなく、調べる・入力するなどの作業も順番に進めるAIです。",
  "AIエージェントとは、利用者の代わりに作業を進めるAIです。",
  "GPUは画像を処理するチップです。",
  "APIはアプリ同士をつなぐ仕組みです。",
  "マルチモーダルとは文章と画像や音声をまとめて扱うことです。"
])assert.deepEqual(termExplanationIssues(text),[],text);
for(const text of [
  "AIエージェントを公開しました。",
  "GPUを公開しました。\n\n他社が半導体を販売しました。",
  "APIを発表しました。\n\n会社の窓口が移転しました。"
])assert.ok(termExplanationIssues(text).length,text);
assert.ok(friendlyExplanationIssues("短い解説です。").length);
const source=fs.readFileSync(new URL("../update.js",import.meta.url),"utf8");
const context={require,console,process,setTimeout,clearTimeout,URL,AbortController,fetch};
vm.createContext(context);
vm.runInContext(source.slice(0,source.indexOf("(async () => {")),context);
const item={title:"テスト用の記事タイトル",raw_excerpt:"利用者が目的を伝えると、メール送信や旅行予約などの複数の作業をAIへ任せる設計です。",
 detail,change_summary:"作業を任せられます。",impact_summary:"事務の手間に影響します。",
 action_suggestion:"利用条件を情報元で確認します。",importance:"A",related_categories:["AIツール・モデル"],
 structured_complete:true,enrichment_version:vm.runInContext("PROMPT_VERSION",context)};
assert.deepEqual(publicationTextIssues(item),[]);
assert.equal(context.isCompleteEnrichedItem(item),true,"generation must accept the same explained article as release");
assert.equal(context.isCompleteEnrichedItem({...item,raw_excerpt:item.title}),false,"title echoes must be rejected before release");
assert.ok(publicationTextIssues({...item,raw_excerpt:item.title}).length);
const workflow=fs.readFileSync(new URL("../.github/workflows/update.yml",import.meta.url),"utf8").replace(/\r\n?/g,"\n");
assert.ok(workflow.includes('for (const message of publicationTextIssues(item))'));
assert.ok(!workflow.includes('["AIエージェント", "作業も順番"]'),"release must not keep an independent literal definition gate");
const gate=workflow.split("- name: validate published articles")[1].split("node - <<'NODE'\n")[1].split("\n          NODE")[0].split("\n").map(line=>line.replace(/^          /,"")).join("\n");
const published=JSON.parse(fs.readFileSync(new URL("../data.json",import.meta.url),"utf8"));
const sample=published.find(article=>article.content_type!=="expert_video");
let gated=Array.from({length:9},(_,i)=>({...sample,article_id:"quality-test-"+i,...item}));
let dropped=false;
const gateContext={
 require:name=>name==="fs"?{readFileSync:()=>JSON.stringify(gated),writeFileSync:(_path,text)=>{gated=JSON.parse(text);dropped=true;}}:require(name),
 console:{log(){},error(){}},process:{exit:code=>{throw new Error("release gate failed: "+code);}}
};
vm.runInNewContext(gate,gateContext);
assert.equal(dropped,false,"the actual workflow must retain the accepted paraphrase");
gated[0]={...gated[0],raw_excerpt:gated[0].title};
vm.runInNewContext(gate,{...gateContext});
assert.equal(gated.length,8,"the actual workflow must still remove title echoes");
console.log("Publication quality OK: shared gates, actual release validation, valid paraphrases and missing-definition rejection.");
