import fs from "node:fs";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const {upgradeFriendlyExplanationItem,hasDeepFriendlyExplanation}=require("./friendly-explanation.cjs");
const file=new URL("../data.json",import.meta.url);
const items=JSON.parse(fs.readFileSync(file,"utf8"));
if(!Array.isArray(items))throw new Error("data.json must be an array");

let upgraded=0;
const output=items.map(item=>{
  const next=upgradeFriendlyExplanationItem(item);
  if(next!==item)upgraded++;
  if(!hasDeepFriendlyExplanation(next.detail))throw new Error(`student-friendly explanation remains incomplete: ${next.article_id||next.title}`);
  return next;
});
fs.writeFileSync(file,JSON.stringify(output,null,2)+"\n","utf8");
console.log(`Student-friendly explanations ready: ${output.length} articles (${upgraded} safely simplified)`);
