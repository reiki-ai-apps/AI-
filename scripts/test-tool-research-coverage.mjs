import fs from "node:fs";
import vm from "node:vm";

const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const update=fs.readFileSync(new URL("../update.js",import.meta.url),"utf8");

function constArray(source,name){
  const match=source.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\[[\\s\\S]*?\\]);`));
  if(!match)throw new Error(`${name} was not found`);
  return vm.runInNewContext(match[1]);
}

const uiNames=constArray(html,"FEATURED_AI_TOOL_NAMES");
const researchNames=constArray(update,"FEATURED_RESEARCH_TOOL_NAMES");
const aliases={
  "OpenAI / ChatGPT":"ChatGPT / OpenAI",
  "Anthropic / Claude":"Claude / Claude Code",
  "Google Gemini":"Gemini"
};
const normalizedUi=uiNames.map(name=>aliases[name]||name);

if(normalizedUi.length!==23)throw new Error(`featured UI list changed unexpectedly: ${normalizedUi.length}`);
const missingResearch=normalizedUi.filter(name=>!researchNames.includes(name));
const orphanResearch=researchNames.filter(name=>!normalizedUi.includes(name));
if(missingResearch.length||orphanResearch.length){
  throw new Error(`featured/research mismatch; missing=${missingResearch.join(",")}; orphan=${orphanResearch.join(",")}`);
}

const toolsBlock=update.slice(update.indexOf("const TOOLS = ["),update.indexOf("const PER_TOOL"));
for(const name of researchNames){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  if(!new RegExp(`name:\\s*["']${escaped}["']`).test(toolsBlock))throw new Error(`TOOLS is missing ${name}`);
  const quotedKey=new RegExp(`["']${escaped}["']:\\s*\\[`);
  const bareKey=/^[A-Za-z_$][\w$]*$/.test(name)?new RegExp(`\\b${escaped}:\\s*\\[`):null;
  if(!quotedKey.test(update)&&!(bareKey&&bareKey.test(update)))throw new Error(`official update page is missing for ${name}`);
}

for(const marker of ["FEATURED_RESEARCH_SET.has(item.tool)","for(const toolName of FEATURED_RESEARCH_TOOL_NAMES)","const featuredPicks=[]","parseOfficialUpdatePage"]){
  if(!update.includes(marker))throw new Error(`research coverage safeguard missing: ${marker}`);
}

console.log(`Tool research coverage passed (${researchNames.length} featured tools).`);
