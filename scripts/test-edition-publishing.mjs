import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const {candidateStatus,isToolEvolutionCandidate,sameEditionStory,sameEventStory,selectTopArticles,buildHomeEdition,applyHomeEdition}=require("./home-edition.cjs");

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

const oneFresh=base("one-fresh","2026-09-02T07:00:00.000Z",{
  importance:"A",title:"新しいAI業務支援機能を正式公開",primary_entity:"新企業",
  story_subject:"AI業務支援機能",event_type:"release",event_stage:"launched"
});
const filledEdition=buildHomeEdition([...candidates,oneFresh],firstEdition,{
  windowStart:end,windowEnd:end+6*3600000,checkedAt:end+6*3600000
});
assert.equal(filledEdition.new_selected_count,1,"新着件数は古い記事で水増ししない");
assert.equal(filledEdition.continued_selected_count,4,"新着が1件でも別の重要記事を4件継続掲載する");
assert.equal(filledEdition.selected_count,5,"ホームは新着が少ない回も5件を目標に満たす");
assert.equal(filledEdition.update_health,"HEALTHY","異なる記事を最低3件確保できれば更新状態は正常になる");
assert.equal(new Set(filledEdition.article_ids).size,5,"補充後も記事IDを重複させない");
const filledItems=applyHomeEdition([...candidates,oneFresh],filledEdition).filter(item=>item.home_top_rank);
assert.equal(filledItems.filter(item=>item.home_top_origin==="new").length,1,"新着記事を公開データで識別できる");
assert.equal(filledItems.filter(item=>item.home_top_origin==="same_day").length,4,"同じ日の前の版で載せた記事は「本日掲載」として新着と分けて記録する");
for(let left=0;left<filledItems.length;left++){
  for(let right=left+1;right<filledItems.length;right++){
    assert.equal(sameEditionStory(filledItems[left],filledItems[right]),false,"継続掲載を加えても同じ出来事を2枠へ入れない");
  }
}

const nextStart=end;
const nextEnd=end+6*3600000;
const priorGemini={...geminiRich,source_published_at:"2026-09-02T05:30:00.000Z",fetched_at:"2026-09-02T05:30:00.000Z"};
const nextGemini={...geminiCopy,article_id:"gemini-other-media",source_published_at:"2026-09-02T07:00:00.000Z",fetched_at:"2026-09-02T07:00:00.000Z"};
const priorGeminiEdition=buildHomeEdition([priorGemini],{}, {windowStart:start,windowEnd:end,checkedAt:end});
const crossEdition=buildHomeEdition([priorGemini,nextGemini],priorGeminiEdition,{windowStart:nextStart,windowEnd:nextEnd,checkedAt:nextEnd});
assert.equal(crossEdition.cross_edition_duplicate_count,1,"前72時間に掲載した同じ発表を別媒体の記事でも検知する");
assert.equal(crossEdition.carried_forward,true,"新しい事実のない同一ニュースでトップを差し替えない");
const noNew=buildHomeEdition(candidates,firstEdition,{windowStart:nextStart,windowEnd:nextEnd,checkedAt:nextEnd});
assert.equal(noNew.new_selected_count,0);
assert.equal(noNew.selected_count,5,"新着0件でも検証済みの重要記事5件を維持する");
assert.equal(noNew.update_health,"DEGRADED","記事数が5件でも新着0件を正常更新として扱わない");
assert.equal(noNew.edition_status,"NO_NEW_STORIES");
assert.ok(noNew.update_health_reasons.some(reason=>reason.includes("新着掲載は0件")));
const postValidation=buildHomeEdition(candidates,{...noNew,consecutive_zero_candidate_editions:0},{windowStart:nextStart,windowEnd:nextEnd,checkedAt:nextEnd});
assert.equal(postValidation.consecutive_zero_candidate_editions,1,"同じ更新回の再検証で新着が消えても候補0件を記録する");
assert.deepEqual(crossEdition.article_ids,["gemini-rich"],"重複記事をトップ枠へ再掲載しない");

const materiallyNew={...nextGemini,article_id:"gemini-general-release",event_stage:"expanded",relation_type:"follow_up",previous_article_id:"gemini-rich",title:"Google、Gemini 3.8 Flashを一般提供へ拡大"};
const progressedEdition=buildHomeEdition([priorGemini,materiallyNew],priorGeminiEdition,{windowStart:nextStart,windowEnd:nextEnd,checkedAt:nextEnd});
assert.deepEqual(progressedEdition.article_ids,["gemini-general-release"],"正式提供など実質的に進んだ続報は新しいニュースとして残す");
assert.equal(progressedEdition.update_health,"DEGRADED","検証済みの異なる記事が3件に届かなければ不足を検知する");

const staleOnce=buildHomeEdition([priorGemini],priorGeminiEdition,{windowStart:end,windowEnd:end+12*3600000,checkedAt:end+12*3600000});
const staleTwice=buildHomeEdition([priorGemini],staleOnce,{windowStart:end+12*3600000,windowEnd:end+25*3600000,checkedAt:end+25*3600000});
assert.equal(staleTwice.update_health,"DEGRADED","24時間不変または候補0件の連続を異常として見える化する");
assert.ok(staleTwice.update_health_reasons.length>=1,"更新停止の理由を監査できる");

// 2026-10-25 本人「毎日必ず内容を入れ替えて、同じ記事が続くのはやめて。絶対に崩さないで」:
// 前の日（日本時間）に載せた記事は、翌日のホームへ二度と出さない。
const dayOneEnd=Date.parse("2026-09-02T12:00:00.000Z");
const dayOne=buildHomeEdition(candidates,{}, {windowStart:start,windowEnd:dayOneEnd,checkedAt:dayOneEnd});
assert.equal(dayOne.edition_day_jst,"2026-09-02","版の日は日本時間で決める");
assert.ok(dayOne.article_ids.length>=3);
assert.ok(dayOne.article_ids.every(id=>dayOne.home_shown_days[id]==="2026-09-02"),"載せた記事に初めて載せた日を記録する");
const dayTwoEnd=Date.parse("2026-09-02T21:00:00.000Z");
const dayTwoFresh=base("day2-fresh","2026-09-02T20:00:00.000Z",{importance:"A",title:"新しい翻訳AIを公開",primary_entity:"翻訳社",story_subject:"翻訳AI",event_type:"release",event_stage:"launched"});
const dayTwo=buildHomeEdition([...candidates,dayTwoFresh],dayOne,{windowStart:dayOneEnd,windowEnd:dayTwoEnd,checkedAt:dayTwoEnd});
assert.equal(dayTwo.edition_day_jst,"2026-09-03");
assert.ok(dayTwo.article_ids.every(id=>!dayOne.article_ids.includes(id)),"前の日に載せた記事は翌日のホームへ出さない");
assert.deepEqual(dayTwo.repeated_from_previous_day_ids,[],"前の日からの持ち越しは0件");
assert.ok(dayTwo.article_ids.includes("day2-fresh"),"翌日の新着は載せる");
const dayTwoItems=applyHomeEdition([...candidates,dayTwoFresh],dayTwo).filter(item=>item.home_top_rank);
assert.ok(dayTwoItems.every(item=>["new","same_day","first_time"].includes(item.home_top_origin)),"翌日の記事は新着・本日掲載・初掲載のどれか");
assert.ok(dayTwoItems.every(item=>!dayOne.article_ids.includes(item.article_id)),"公開データにも前の日の記事は無い");
const sameDayLater=buildHomeEdition([...candidates,dayTwoFresh],dayTwo,{windowStart:dayTwoEnd,windowEnd:dayTwoEnd+6*3600000,checkedAt:dayTwoEnd+6*3600000});
assert.ok(dayTwo.article_ids.every(id=>sameDayLater.article_ids.includes(id))||sameDayLater.article_ids.length===5,"同じ日の昼・夜の版では、その日に載せた記事を残してよい");
const allShown=Object.fromEntries([...candidates,dayTwoFresh].map(item=>[item.article_id,"2026-09-02"]));
const dayThreeEnd=Date.parse("2026-09-03T21:00:00.000Z");
const nothingNew=buildHomeEdition([...candidates,dayTwoFresh],{...dayTwo,home_shown_days:allShown},{windowStart:dayTwoEnd,windowEnd:dayThreeEnd,checkedAt:dayThreeEnd});
assert.deepEqual(nothingNew.article_ids,[],"載せる記事が無い日も、前の日の記事で埋めない");
assert.equal(nothingNew.update_health,"DEGRADED","前の日と重ならない記事が足りない日は異常として知らせる");
const tampered={...dayTwo,article_ids:[dayOne.article_ids[0],...dayTwo.article_ids]};
assert.ok(!applyHomeEdition([...candidates,dayTwoFresh],tampered).some(item=>item.home_top_rank&&dayOne.article_ids.includes(item.article_id)),"公開直前にも前の日の記事を落とす");
const sameEventNextDay=base("gemini-same-event-next-day","2026-09-02T20:30:00.000Z",{...geminiCopy,article_id:"gemini-same-event-next-day",source_published_at:"2026-09-02T20:30:00.000Z",fetched_at:"2026-09-02T20:30:00.000Z"});
const geminiDayOne=buildHomeEdition([geminiRich],{}, {windowStart:start,windowEnd:dayOneEnd,checkedAt:dayOneEnd});
const geminiDayTwo=buildHomeEdition([geminiRich,sameEventNextDay],geminiDayOne,{windowStart:dayOneEnd,windowEnd:dayTwoEnd,checkedAt:dayTwoEnd});
assert.ok(!geminiDayTwo.article_ids.includes("gemini-same-event-next-day")&&!geminiDayTwo.article_ids.includes("gemini-rich"),"別の媒体でも同じ出来事の記事は翌日に繰り返さない");
const weekLaterEnd=dayOneEnd+5*24*3600000;
const sameEventWeekLater={...sameEventNextDay,article_id:"gemini-same-event-week-later",source_published_at:new Date(weekLaterEnd-3600000).toISOString(),fetched_at:new Date(weekLaterEnd-3600000).toISOString()};
const geminiWeekLater=buildHomeEdition([geminiRich,sameEventWeekLater],{...geminiDayOne,recent_story_history:[]},{windowStart:weekLaterEnd-6*3600000,windowEnd:weekLaterEnd,checkedAt:weekLaterEnd});
assert.ok(!geminiWeekLater.article_ids.includes("gemini-same-event-week-later"),"72時間を過ぎても、14日以内に載せた出来事は別の媒体の記事で繰り返さない");
assert.ok(Array.isArray(geminiDayTwo.home_shown_story_log)&&geminiDayTwo.home_shown_story_log.some(entry=>entry.article_id==="gemini-rich"),"載せた記事を14日分の記録へ残す");

// 2026-10-26: 日をまたぐ比較は「同じ出来事」だけ。同じ会社名が文中に出るだけの別の話まで外すと、ホームが0件になった（実際の記事の組で確かめる）。
const ev=(id,extra)=>base(id,"2026-10-24T08:00:00.000Z",extra);
const deepseekFundA=ev("ds-fund-a",{title:"DeepSeekが約150億ドルの大型資金調達、上海上場も視野に",primary_entity:"DeepSeek",story_subject:"DeepSeekの約150億ドル資金調達",event_type:"funding",event_stage:"announced",story_entities:["DeepSeek"]});
const deepseekFundB=ev("ds-fund-b",{title:"中国DeepSeek、2兆円超を資金調達しOpenAIなどを追い上げ",primary_entity:"DeepSeek",story_subject:"DeepSeekの大型資金調達",event_type:"funding",event_stage:"announced",story_entities:["DeepSeek","OpenAI"]});
const openaiSuit=ev("openai-suit",{title:"米8州がOpenAIを提訴、ChatGPTによる被害を主張",primary_entity:"OpenAI",story_subject:"米8州によるOpenAI提訴",event_type:"other",event_stage:"announced",story_entities:["OpenAI","ChatGPT"]});
const banPolicy=ev("ds-ban-policy",{title:"トランプ政権がDeepSeekの全面禁止方針",primary_entity:"アメリカ政府(トランプ政権)",story_subject:"DeepSeek全面禁止方針",event_type:"policy",event_stage:"announced",story_entities:["DeepSeek","トランプ政権"]});
const banDhs=ev("ds-ban-dhs",{title:"米国土安全保障省、連邦民間機関でDeepSeekの使用を禁止",primary_entity:"米国土安全保障省(DHS)",story_subject:"DeepSeek使用禁止措置",event_type:"policy",event_stage:"announced",story_entities:["DeepSeek","米国土安全保障省"]});
const claudeDuet=ev("claude-duet",{title:"Anthropic、先回り操作型AIエージェント『Claude Duet』を発表",primary_entity:"Anthropic",story_subject:"Claude Duet",event_type:"release",event_stage:"announced",story_entities:["Anthropic","Claude Duet","Claude Opus 5.5"]});
const claudeLeave=ev("claude-leave",{title:"Claude Code開発者がAnthropicを退職",primary_entity:"Anthropic",story_subject:"Claude Code開発者の退職",event_type:"other",event_stage:"announced",story_entities:["Anthropic","Claude Code","claude"]});
const dcInvest=ev("dc-invest",{title:"日本のデータセンター、8年で10兆円投資し規模4倍へ",primary_entity:"日本のデータセンター業界",story_subject:"データセンター投資の拡大",event_type:"other",event_stage:"other",story_entities:["データセンター"]});
const dcProblem=ev("dc-problem",{title:"次世代AIサーバーが置けない日本のデータセンター問題",primary_entity:"日本のデータセンター業界",story_subject:"次世代AIサーバーの設置問題",event_type:"other",event_stage:"other",story_entities:["データセンター","AIサーバー"]});
const kimiPlan=ev("kimi-plan",{title:"中国Moonshot、新モデル「Kimi K3.1 Pro」の重みを公開予定",primary_entity:"Moonshot AI",story_subject:"Kimi K3.1 Pro",event_type:"release",event_stage:"planned",story_entities:["Moonshot AI","Kimi K3.1 Pro"]});
const kimiOut=ev("kimi-out",{title:"中国Moonshot AIが新モデル「Kimi K3.1 Pro」を発表",primary_entity:"Moonshot AI",story_subject:"Kimi K3.1 Pro",event_type:"release",event_stage:"announced",story_entities:["Moonshot AI","Kimi K3.1 Pro"]});
assert.equal(sameEventStory(deepseekFundA,deepseekFundB),true,"金額の表記が違っても、同じ相手の同じ資金調達は同じ出来事");
assert.equal(sameEventStory(banPolicy,banDhs),true,"同じ相手への同じ種類の規制は、発表した機関が違っても同じ出来事");
assert.equal(sameEventStory(kimiPlan,kimiOut),true,"同じ製品の発表は、予定と発表で書き方が違っても同じ出来事");
assert.equal(sameEventStory(deepseekFundB,openaiSuit),false,"文中に同じ会社名が出るだけの別の話は、別の出来事");
assert.equal(sameEventStory(claudeDuet,claudeLeave),false,"同じ会社の新製品と人の退職は、別の出来事");
assert.equal(sameEventStory(dcInvest,dcProblem),false,"同じ分野でも、投資の話と設置できない問題は別の出来事");
const shownDayOne={home_shown_days:{"ds-fund-a":"2026-10-24","openai-suit":"2026-10-24","claude-duet":"2026-10-24","dc-invest":"2026-10-24","kimi-plan":"2026-10-24","ds-ban-policy":"2026-10-24"},
  home_shown_story_log:[deepseekFundA,openaiSuit,claudeDuet,dcInvest,kimiPlan,banPolicy].map(item=>({...item,shown_day:"2026-10-24"}))};
const nextDayEnd=Date.parse("2026-10-26T01:43:00.000Z");
const realPool=[deepseekFundA,deepseekFundB,openaiSuit,banPolicy,banDhs,claudeDuet,claudeLeave,dcInvest,dcProblem,kimiPlan,kimiOut];
const realNext=buildHomeEdition(realPool,shownDayOne,{windowStart:nextDayEnd-16*3600000,windowEnd:nextDayEnd,checkedAt:nextDayEnd});
assert.deepEqual([...realNext.article_ids].sort(),["claude-leave","dc-problem"],"前の日と同じ出来事（資金調達・規制・製品）だけを外し、同じ会社名が出るだけの別の話は載せる");
assert.deepEqual(realNext.repeated_from_previous_day_ids,[],"前の日の記事は1件も出ない");

const unsafeEdition={...firstEdition,article_ids:["gemini-rich","gemini-copy","runway-tool"],scores:{}};
const guarded=applyHomeEdition(distinctPool,unsafeEdition).filter(item=>item.home_top_rank).sort((a,b)=>a.home_top_rank-b.home_top_rank);
assert.deepEqual(guarded.map(item=>item.article_id),["gemini-rich","runway-tool"],"公開直前にも同じ出来事の2件目を落とす");

const workflow=fs.readFileSync(".github/workflows/update.yml","utf8");
const crons=[...workflow.matchAll(/cron:\s*["']([^"']+)["']/g)].map(match=>match[1]);
const videoRecoveryCron='43 21-23,0-2 * * *';
assert.deepEqual(crons.filter(x=>x!==videoRecoveryCron),["17 20 * * *","17 4 * * *","17 10 * * *"],"通常記事の定期更新は朝・昼・夜の3回だけ");
assert.ok(crons.includes(videoRecoveryCron),'動画だけの朝の再確認がある');
assert.ok(workflow.includes("AI_EXPERT_RETRY_ONLY: ${{ github.event.schedule == '"+videoRecoveryCron+"' && '1' || '0' }}"),'追加の実行は原則動画だけ');
assert.ok(workflow.includes("if [ '${{ steps.build_data.outputs.full_update }}' = 'true' ]; then node scripts/finalize-home-edition.mjs; fi"),'記事を作った回だけトップ5を確定し直す');
const runner=fs.readFileSync("scripts/run-scheduled-update.mjs","utf8");
assert.match(runner,/!articlesDueToday\(read\('home-edition\.json',\{\}\)\)/,"その日の記事の版が無ければ、動画の再確認の回でも記事を作る");
assert.match(runner,/full_update=/,"記事を作ったかを後の手順へ渡す");
const validationIndex=workflow.indexOf("- name: validate published articles");
const finalizeIndex=workflow.indexOf("node scripts/finalize-home-edition.mjs",validationIndex);
const buildArticlesIndex=workflow.indexOf("node scripts/build-public-articles.mjs",validationIndex);
assert.ok(validationIndex>=0&&finalizeIndex>validationIndex&&buildArticlesIndex>finalizeIndex,"記事検証後にトップ選定を作り直してから公開ページを生成する");

const html=fs.readFileSync("index.html","utf8");
assert.ok(html.includes('newCount===0?')&&html.includes('今回の更新で新しい記事はありません。今日まだ載せていない記事だけを表示しています（前の日の記事は出しません）。'),"新着0件を読者へ明示する");
assert.match(html,/function homeTopUpdates\(\)/,"ホーム専用の選定を使う");
assert.match(html,/const list=homeTopUpdates\(\)/,"ホームは選定済みトップ記事だけを描画する");
assert.match(html,/function homeOriginBadge\(u\)/,"ホーム記事を新着と継続掲載に分けて表示する");
assert.match(html,/注目ニュース \$\{list\.length\}件・新着 \$\{newCount\}件/,"合計件数と本当の新着件数を分けて表示する");
const renderHomeSource=html.slice(html.indexOf("function renderHome(v)"),html.indexOf("function byPub(a,b)"));
const feedRenderIndex=renderHomeSource.indexOf("feedList.forEach");
const expertRenderIndex=renderHomeSource.indexOf("html+=expertVideoHtml+homeSecondaryHtml+todayOneHtml",feedRenderIndex);
const secondaryRenderIndex=expertRenderIndex;
assert.ok(feedRenderIndex>=0&&secondaryRenderIndex>feedRenderIndex,"トップ5の記事カードを統計・アーカイブ・公式SNSより先に描画する");
assert.ok(expertRenderIndex>feedRenderIndex,"専門家動画は記事トップ5の後に描画する");
assert.match(renderHomeSource,/let html = `<section class="radar-overview/,"ホームはニュースの見出しから始める");
assert.match(renderHomeSource,/html\+=expertVideoHtml\+homeSecondaryHtml\+todayOneHtml/,"今日試せる1つは動画と補助案内の後に置く");
assert.match(renderHomeSource,/emptyState\([^\n]+\+expertVideoHtml\+homeSecondaryHtml\+todayOneHtml/,"トップ記事がない時も今日試せる1つは最後に置く");
assert.match(renderHomeSource,/いま注目のAIニュース · 新着\$\{newCount\}件 · 更新確認 \$\{latest\}/,"見出しに新着件数と最終確認時刻を示す");
assert.match(renderHomeSource,/const homeSecondaryHtml=`<section class="home-secondary"/,"記事以外の案内を後半ブロックとして固定する");
assert.match(renderHomeSource,/home-review-link" onclick="go\('reviews'\)"/,"ホーム後半に控えめなレビュー案内を置く");
assert.ok(renderHomeSource.indexOf('home-review-link')>renderHomeSource.indexOf('const homeSecondaryHtml='),"レビュー案内は記事より後の補助ブロック内に置く");
assert.match(html,/const allArticles=getUpdates\(\)/,"分類・検索はテーマ設定前の全記事を使う");
assert.match(html,/\.archive-intro \+ \.filterbar\{display:grid;grid-template-columns:1fr\}/,"スマホの分類・検索を1列で操作できる");
const navSource=html.slice(html.indexOf("const NAV = ["),html.indexOf("let route ="));
assert.doesNotMatch(navSource,/id:'updates'/,"全記事と分類の重複ナビを残さない");
assert.match(navSource,/id:'categories',label:'記事を探す'/,"分類・検索を記事探索の正本にする");
assert.match(html,/function canonicalRouteName\(name\)\{ return name==='updates'\?'categories':name; \}/,"旧全記事URLは分類・検索へ互換転送する");
assert.doesNotMatch(html,/go\('updates'\)/,"画面内導線は旧全記事ルートを使わない");
assert.match(html,/\.bottom-nav\{[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/,"スマホナビはレビューを含む5項目で均等表示する");
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
assert.match(update,/const baseFinal=\[\.\.\.editionPicks,\.\.\.expertPicks,\.\.\.featuredPicks,\.\.\.freshPicks,\.\.\.restPicks\]/,"トップ5保持枠と独立した専門家動画枠を公開データへ含める");

const data=JSON.parse(fs.readFileSync("data.json","utf8"));
const publicTop=data.filter(item=>Number(item.home_top_rank)>0).sort((a,b)=>a.home_top_rank-b.home_top_rank);
assert.ok(publicTop.length<=5,"公開データのホーム指定は最大5件");
{
  const current=JSON.parse(fs.readFileSync("home-edition.json","utf8"));
  if(publicTop.length<3)assert.ok(current.update_health==="DEGRADED"&&current.update_health_reasons.some(reason=>reason.includes("前の日と重ならない")),"前の日の記事を出さないため3件未満になった日は、異常として知らせる（前の日の記事で埋めない）");
}
assert.deepEqual(publicTop.map(item=>item.home_top_rank),Array.from({length:publicTop.length},(_,index)=>index+1),"公開順位は1から連続する");
for(const item of publicTop){
  assert.ok(item.home_selected_at&&item.home_window_start&&item.home_window_end,"選定記事に更新時刻と対象期間がある");
  assert.ok(Number.isFinite(Number(item.home_top_score)),"選定記事に審査点がある");
  assert.ok(["new","same_day","first_time"].includes(item.home_top_origin),"選定記事は新着・本日掲載・初掲載のどれかで、前の日からの継続は無い");
}
for(let left=0;left<publicTop.length;left++){
  for(let right=left+1;right<publicTop.length;right++){
    assert.equal(sameEditionStory(publicTop[left],publicTop[right]),false,`公開トップ5の${left+1}位と${right+1}位は別の出来事`);
  }
}

const edition=JSON.parse(fs.readFileSync("home-edition.json","utf8"));
assert.deepEqual(edition.article_ids,publicTop.map(item=>item.article_id),"選定正本と公開データのID順が一致する");
assert.equal(edition.selection_version,"home-daily-unique-v6-article-only","前の日の記事を二度と載せず、最低3件・目標5件と過去72時間の重複統合を使い、記事だけを選ぶ版である");
assert.deepEqual(edition.repeated_from_previous_day_ids||[],[],"公開中のホームに前の日から持ち越した記事は無い");
assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(edition.edition_day_jst||""),"選定正本に版の日（日本時間）がある");
for(const item of publicTop){
  const day=(edition.home_shown_days||{})[item.article_id];
  assert.equal(day,edition.edition_day_jst,`公開中のホームの記事（${item.article_id}）は、この版の日に初めて載った記事だけ`);
}
assert.equal(edition.distinct_candidate_count,edition.candidate_count-edition.duplicate_candidate_count,"候補URL数と異なる出来事件数を監査できる");
assert.equal(edition.novel_candidate_count,edition.distinct_candidate_count-edition.cross_edition_duplicate_count,"過去回との重複を除いた本当の新着件数を監査できる");
assert.ok(Array.isArray(edition.recent_story_history),"過去72時間の掲載履歴を次回の重複判定へ引き継ぐ");
assert.ok(["HEALTHY","DEGRADED"].includes(edition.update_health),"更新停止を検知できる健康状態を公開する");
assert.equal(edition.selected_count,edition.new_selected_count+edition.continued_selected_count,"ホーム合計を新着と継続掲載へ分解できる");
assert.equal(edition.target_selected_count,5,"通常はトップ5を目標にする");
assert.equal(edition.minimum_selected_count,3,"ホーム最低3件を選定データへ固定する");
console.log("Edition publishing tests passed.");
