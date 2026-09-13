import fs from "node:fs";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const {buildHomeEdition,applyHomeEdition,firstSeenTime}=require("./home-edition.cjs");
const data=JSON.parse(fs.readFileSync("data.json","utf8"));
let previous={};
try{previous=JSON.parse(fs.readFileSync("home-edition.json","utf8"));}catch(_error){}

let edition;
if(previous.last_window_end){
  edition=buildHomeEdition(data,previous,{windowEnd:previous.last_window_end,windowStart:previous.window_start,checkedAt:previous.last_checked_at});
}else{
  const newest=Math.max(...data.map(firstSeenTime).filter(Boolean));
  const displayEnd=newest||Date.now();
  edition=buildHomeEdition(data,{}, {windowStart:displayEnd-24*3600000,windowEnd:displayEnd,checkedAt:new Date().toISOString()});
  // 初回公開後に同じ過去記事を再選定しないよう、次回の開始点だけは現在時刻へ進める。
  edition.last_window_end=new Date().toISOString();
}

fs.writeFileSync("data.json",JSON.stringify(applyHomeEdition(data,edition),null,2)+"\n");
fs.writeFileSync("home-edition.json",JSON.stringify(edition,null,2)+"\n");
const outcome=edition.new_selected_count>0
  ?`新着 ${edition.new_selected_count}件を掲載・継続 ${edition.continued_selected_count}件`
  :`新着掲載0件・前回の重要記事 ${edition.continued_selected_count}件を継続表示（新規更新ではありません）`;
console.log(`Home edition: ${outcome}`);
if(edition.new_selected_count===0)console.log(`::warning::${outcome}`);
if(process.env.GITHUB_STEP_SUMMARY){
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\n### 記事の掲載結果\n\n${outcome}\n\n取得確認: ${edition.last_checked_at}\n`);
}
