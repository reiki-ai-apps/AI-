import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const html=read("index.html");
const manifest=JSON.parse(read("manifest.webmanifest"));
const worker=read("sw.js");
const article=fs.readdirSync(path.join(root,"articles"),{withFileTypes:true})
  .find(entry=>entry.isDirectory());

const checks=[
  [html.includes('<html lang="ja" style="background:#f6f8fc">'),"initial canvas is light"],
  [html.includes('<meta name="theme-color" content="#ffffff" />'),"browser theme color is light"],
  [html.includes('<body class="light-media-theme">'),"light theme is explicitly scoped"],
  [html.includes("V5.2 / Light knowledge-media theme"),"light knowledge-media CSS is present"],
  [html.includes("The top signal is the sole dark focal area"),"top signal has an intentional dark restoration"],
  [html.includes(".light-media-theme .mobile-media-hub"),"mobile KIZASHI media hub has light styling"],
  [manifest.background_color==="#f6f8fc"&&manifest.theme_color==="#ffffff","PWA colors are light"],
  [worker.includes("ai-radar-v5-20260814-light-media-v1"),"service worker cache was bumped"]
];

if(!article)checks.push([false,"at least one public article exists"]);
else{
  const articleHtml=read(path.join("articles",article.name,"index.html"));
  checks.push([articleHtml.includes("color-scheme:light"),"public articles use a light reading canvas"]);
  checks.push([articleHtml.includes("background:#fff"),"public article sections use white reading surfaces"]);
  checks.push([articleHtml.includes("rgba(7,28,51,.98)"),"public article hero remains dark"]);
}

const failed=checks.filter(([ok])=>!ok);
for(const [ok,label] of checks)console.log(`${ok?"OK":"NG"} ${label}`);
if(failed.length)process.exit(1);
console.log("Light theme contract passed.");
