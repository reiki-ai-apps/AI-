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
console.log(`Home edition ready: ${edition.selected_count} selected from ${edition.candidate_count} candidates.`);
