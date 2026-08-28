import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const luminance=hex=>{
  const rgb=hex.replace("#","").match(/../g).map(value=>parseInt(value,16)/255)
    .map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
  return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
};
const contrast=(foreground,background)=>{
  const values=[luminance(foreground),luminance(background)].sort((a,b)=>b-a);
  return (values[0]+.05)/(values[1]+.05);
};
const html=read("index.html");
const manifest=JSON.parse(read("manifest.webmanifest"));
const worker=read("sw.js");
const article=fs.readdirSync(path.join(root,"articles"),{withFileTypes:true}).find(entry=>entry.isDirectory());

const checks=[
  [html.includes('<html lang="ja" style="background:#070b14">'),"initial canvas is dark"],
  [html.includes('<meta name="theme-color" content="#070b14" />'),"browser theme color is dark"],
  [html.includes('<body>')&&!html.includes('<body class="light-media-theme">'),"light theme override is disabled"],
  [html.includes("#030611!important"),"original deep navy app background is present"],
  [html.includes("background:var(--brand-grad)!important"),"original gradient primary buttons are present"],
  [html.includes("background:rgba(3,6,17,.97)"),"mobile operator bar matches the dark canvas"],
  [contrast("#e9edff","#070b16")>=7,"primary text has strong contrast on the dark background"],
  [contrast("#aab4dc","#070b16")>=4.5,"secondary text remains readable on the dark background"],
  [manifest.background_color==="#070b14"&&manifest.theme_color==="#070b14","PWA colors are dark"],
  [worker.includes("ai-radar-v5-20260829-no-membership-v17"),"service worker cache was bumped"]
];

if(!article)checks.push([false,"at least one public article exists"]);
else{
  const articleHtml=read(path.join("articles",article.name,"index.html"));
  checks.push([articleHtml.includes("color-scheme:dark"),"public articles use a dark reading canvas"]);
  checks.push([articleHtml.includes("background:#081526"),"public article sections use dark surfaces"]);
  checks.push([articleHtml.includes("background:#0b1d31"),"secondary article buttons use the original dark surface"]);
}

const failed=checks.filter(([ok])=>!ok);
for(const [ok,label] of checks)console.log(`${ok?"OK":"NG"} ${label}`);
if(failed.length)process.exit(1);
console.log("Dark theme contract passed.");
