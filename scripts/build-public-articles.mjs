import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {sourceImage,editorialImage,commonsImage,articleVisual}=require('./source-image.cjs');
const {mergePublicArchive}=require('./public-archive.cjs');
const {isToolEvolutionCandidate}=require('./home-edition.cjs');

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const data=JSON.parse(fs.readFileSync(path.join(root,"data.json"),"utf8"));
const baseUrl="https://reiki-ai-apps.github.io/AI-/";
const outRoot=path.join(root,"articles");
const archiveRoot=path.join(root,"archive");
const topicsRoot=path.join(root,"topics");
const manifestPath=path.join(root,"public-article-archive.json");

function esc(value){
  return String(value??"").replace(/[&<>\"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
}
function clean(value,max=220){
  return String(value??"").replace(/\s+/g," ").trim().slice(0,max);
}
function searchDescription(item,expertVideo){
  const text=clean([item.change_summary,item.impact_summary].filter(Boolean).join(" ")||item.easy_summary||item.raw_excerpt||item.detail,400);
  if(!text)return expertVideo?"AI進化レーダーが動画で学べることと背景を整理した解説です。":"AI進化レーダーが重要度と仕事への影響を整理したAIニュースです。";
  if(text.length<=180)return text;
  const sentenceEnd=text.lastIndexOf("。",180);
  return sentenceEnd>=60?text.slice(0,sentenceEnd+1):text.slice(0,179)+"…";
}
function safeHttpUrl(value){
  try{
    const url=new URL(String(value||""));
    return ["http:","https:"].includes(url.protocol)?url.toString():"";
  }catch(_error){return "";}
}
function safeId(item){
  const value=String(item.article_id||item.id||"").trim();
  return /^[A-Za-z0-9_-]{8,100}$/.test(value)?value:"";
}
function isoDate(value){
  const date=new Date(value||"");
  return Number.isFinite(date.getTime())?date.toISOString():"";
}
function displayDate(value){
  const date=new Date(value||"");
  return Number.isFinite(date.getTime())?new Intl.DateTimeFormat("ja-JP",{dateStyle:"long",timeStyle:"short",timeZone:"Asia/Tokyo"}).format(date):"掲載日確認中";
}
function paragraph(label,value){
  const text=String(value??"").replace(/\r\n?/g,"\n").trim().slice(0,4000);
  const parts=text.split(/\n{2,}/).map(part=>clean(part,4000)).filter(Boolean);
  return parts.length?`<section><h2>${esc(label)}</h2>${parts.map(part=>`<p>${esc(part)}</p>`).join("")}</section>`:"";
}
const TOPICS=[
  {slug:"ai-tools",title:"生成AI・AIツールの新機能と使い方",description:"ChatGPT、Claude、Geminiなど生成AIツールの新機能、更新、具体的な使い方を確認できる記事をまとめました。",intro:"何が新しくなり、どんな場面で役立つのかを、情報元を示した記事から確認できます。",match:entry=>entry.categories.includes("AIツール・モデル")&&entry.tool_evolution===true},
  {slug:"image-video-ai",title:"画像生成AI・動画生成AIの最新情報",description:"画像生成AI、動画生成AI、Canvaなどの編集ツールの新機能と利用条件を確認できる記事をまとめました。",intro:"画像や動画の作り方がどう変わったか、使える条件や注意点も含めて比較できます。",match:entry=>entry.categories.includes("画像・動画生成")},
  {slug:"ai-safety",title:"生成AIの安全性・規制・著作権ニュース",description:"生成AIの安全性、情報漏えい、規制、著作権に関する動きを、仕事で使う人向けに整理した記事をまとめました。",intro:"新しいルールやリスクを、確定した事実と検討中の内容を分けて確認できます。",match:entry=>entry.categories.some(category=>["セキュリティ","規制・法務"].includes(category))}
];
function archiveEntry(item,id){
  return {
    id,title:clean(item.title,120),description:searchDescription(item,String(item.content_type||"")==="expert_video"),
    published:isoDate(item.source_published_at||item.published_at||item.fetched_at),
    lastmod:isoDate(item.source_updated_at||item.source_published_at||item.published_at),
    categories:(item.related_categories||[]).map(value=>clean(value,50)).slice(0,3),
    event_type:clean(item.event_type,30),tool_evolution:isToolEvolutionCandidate(item),content_type:clean(item.content_type,30),source_url:safeHttpUrl(item.source_url)
  };
}
function pageUrl(id){return `${baseUrl}articles/${encodeURIComponent(id)}/`;}
function seoShell({title,description,canonical,body}){
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | AI進化レーダー</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${canonical}"><meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${canonical}"><style>:root{color-scheme:dark;font-family:system-ui,"Noto Sans JP",sans-serif;background:#050a14;color:#eef6ff}*{box-sizing:border-box}body{margin:0;background:#050a14}main{max-width:900px;margin:auto;padding:22px 16px 80px}a{color:#85e7eb}h1{font-size:clamp(26px,5vw,40px);line-height:1.4}p{line-height:1.8;color:#bed0df}.links{display:grid;gap:10px;margin-top:25px}.links a{display:block;padding:14px 16px;border:1px solid #255065;border-radius:12px;background:#0b1b2c;text-decoration:none}.links strong{display:block;color:#e9faff}.links span{display:block;margin-top:6px;font-size:13px;color:#a8bdcc;line-height:1.6}.crumb{font-size:14px;margin-bottom:26px}.date{font-size:12px;color:#a8bdcc}.intro{padding:18px;border-left:3px solid #66dce5;background:#0b1b2c;border-radius:0 10px 10px 0}</style></head><body><main>${body}</main></body></html>`;
}
function relatedArticles(item,id,pool,limit=3){
  const categories=new Set(item.related_categories||[]);
  const entity=clean(item.primary_entity||"",80).toLowerCase();
  return pool.filter(candidate=>candidate.id!==id).map(candidate=>{
    const shared=(candidate.item.related_categories||[]).filter(value=>categories.has(value));
    const specific=shared.filter(value=>!["AIツール・モデル","企業・株式","その他","政策・行政","規制・法務"].includes(value));
    const sameEntity=entity&&entity===clean(candidate.item.primary_entity||"",80).toLowerCase();
    const sameEvent=String(item.event_type||"")===String(candidate.item.event_type||"");
    const date=new Date(candidate.item.source_published_at||candidate.item.published_at||candidate.item.fetched_at||0).getTime()||0;
    const score=(sameEntity?6:0)+specific.length*3+(sameEvent&&shared.length?2:0);
    return {...candidate,score,date};
  }).filter(candidate=>candidate.score>=3).sort((a,b)=>b.score-a.score||b.date-a.date).slice(0,limit);
}
function page(item,id,related=[],peers=[],topic=null){
  const expertVideo=String(item.content_type||"").toLowerCase()==="expert_video";
  const sourceUrl=safeHttpUrl(item.source_url);
  const canonical=`${baseUrl}articles/${encodeURIComponent(id)}/`;
  const appUrl=baseUrl;
  const title=clean(item.title,120)||"AI重要ニュース";
  const description=searchDescription(item,expertVideo);
  const published=isoDate(item.source_published_at||item.published_at||item.fetched_at);
  const updated=isoDate(item.source_updated_at||item.source_published_at||item.published_at);
  const image=sourceImage(item,peers)||editorialImage(item)||commonsImage(item,peers)?.url||'';
  const visual=articleVisual(item,peers);
  const articleLd={
    "@type":expertVideo?"Article":"NewsArticle",
    "@id":`${canonical}#article`,
    headline:title,
    about:expertVideo&&item.expert_name?{"@type":"Person",name:clean(item.expert_name,80)}:undefined,
    description,
    image:image?[image]:undefined,
    datePublished:published||undefined,
    dateModified:updated||published||undefined,
    mainEntityOfPage:canonical,
    author:{"@type":"Organization",name:"KIZASHI",url:baseUrl},
    publisher:{"@type":"Organization",name:"KIZASHI",url:baseUrl,logo:{"@type":"ImageObject",url:`${baseUrl}assets/ai-radar-icon-512.png`}}
  };
  Object.keys(articleLd).forEach(key=>articleLd[key]===undefined&&delete articleLd[key]);
  const jsonLd={"@context":"https://schema.org","@graph":[articleLd,{
    "@type":"BreadcrumbList",
    itemListElement:[
      {"@type":"ListItem",position:1,name:"AI進化レーダー",item:baseUrl},
      ...(topic?[{"@type":"ListItem",position:2,name:topic.title,item:`${baseUrl}topics/${topic.slug}/`}]:[]),
      {"@type":"ListItem",position:topic?3:2,name:title,item:canonical}
    ]
  }]};
  const relatedHeading=expertVideo?"関連するAIニュース・専門家解説":"関連するAIニュース";
  const relatedHtml=related.length?`<section class="related"><h2>${relatedHeading}</h2><div class="related-grid">${related.map(candidate=>{
    const candidateTitle=clean(candidate.item.title,120)||"AI重要ニュース";
    const candidateUrl=`${baseUrl}articles/${encodeURIComponent(candidate.id)}/`;
    return `<a href="${candidateUrl}">${esc(candidateTitle)}</a>`;
  }).join("")}</div></section>`:"";
  return `<!doctype html>
<html lang="ja"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#070b14">
<title>${esc(title)} | AI進化レーダー</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="article"><meta property="og:site_name" content="AI進化レーダー">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">${published?`<meta property="article:published_time" content="${published}">`:''}${image?`<meta property="og:image" content="${esc(image)}">`:''}
<meta name="twitter:card" content="${image?'summary_large_image':'summary'}"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">${image?`<meta name="twitter:image" content="${esc(image)}">`:''}
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g,"\\u003c")}</script>
<script defer src="${baseUrl}assets/visitor-tracker.js"></script>
<style>
:root{color-scheme:dark;font-family:"Noto Sans JP",system-ui,sans-serif;background:#050a14;color:#eef6ff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 85% 0,#10295a 0,transparent 30rem),#050a14}main{width:min(860px,calc(100% - 28px));margin:0 auto;padding:24px 0 60px}.brand{display:flex;align-items:center;gap:10px;color:#73e8ee;font-size:13px;font-weight:800;letter-spacing:.1em;text-decoration:none}.brand img{width:34px;height:34px;border-radius:9px}.hero{margin-top:22px;padding:clamp(22px,5vw,46px);border:1px solid #1c8ea0;border-radius:22px;background:linear-gradient(145deg,rgba(7,28,51,.97),rgba(16,19,58,.94));box-shadow:0 24px 80px #0009}.meta{color:#9fb1c6;font-size:13px}.rank{display:inline-flex;margin-right:8px;padding:4px 9px;border-radius:999px;background:#d82757;color:white;font-weight:900}.hero h1{margin:18px 0 14px;font-size:clamp(26px,5vw,44px);line-height:1.38}.lead{color:#c6d4e4;font-size:clamp(15px,2vw,18px);line-height:1.9}.article-image{display:block;width:100%;height:auto;aspect-ratio:16/9;border:1px solid #173d5c;border-radius:16px;object-fit:cover}.article-visual{margin:22px 0 0}.article-visual figcaption{margin-top:6px;color:#9fb1c6;font-size:12px}.article-visual.is-brand .article-image{object-fit:contain;padding:9%;background:linear-gradient(135deg,#111b29,#172b3a)}.byline{margin:14px 0 0;color:#91a5bb;font-size:13px;line-height:1.7}section{margin-top:18px;padding:21px;border:1px solid #18344c;border-radius:16px;background:#081526}section h2{margin:0 0 9px;color:#72e6ec;font-size:16px}section p{margin:0;color:#c3d0df;line-height:1.9;white-space:pre-line}section p+p{margin-top:1em}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}.button{display:inline-flex;min-height:48px;align-items:center;justify-content:center;padding:0 18px;border-radius:12px;background:linear-gradient(135deg,#0899bd,#6d35d8);color:white;font-weight:800;text-decoration:none}.button.secondary{border:1px solid #2a6380;background:#0b1d31}.related-grid{display:grid;gap:10px}.related-grid a{display:block;padding:12px 14px;border:1px solid #1e4967;border-radius:11px;color:#dffbff;background:#0a1b2d;text-decoration:none;line-height:1.6}.related-grid a:hover{border-color:#61dbe4;color:#fff}.note{margin-top:18px;color:#8194aa;font-size:12px;line-height:1.7}@media(max-width:520px){main{width:min(100% - 20px,860px)}.hero{border-radius:16px}.actions{display:grid}.button{width:100%}}
</style><style>.article-visual figcaption a{color:#9fdfea}</style></head><body><main>
<a class="brand" href="${baseUrl}"><img src="${baseUrl}assets/ai-radar-icon-192.png" alt="">AI進化レーダー</a>
<article class="hero"><div class="meta"><span class="rank">${expertVideo?'AI学習動画':'重要度'+esc(String(item.importance||"B").toUpperCase())}</span>${expertVideo&&item.expert_name?`${esc(item.expert_name)}・${esc(item.expert_role||'AIの専門家')}｜`:''}${esc(item.source_name||"情報元確認済み")}・${esc(displayDate(item.source_published_at||item.published_at||item.fetched_at))}</div><h1>${esc(title)}</h1><p class="lead">${esc(description)}</p>
${visual?`<figure class="article-visual${visual.kind==='brand'?' is-brand':''}"><img class="article-image" src="${esc(visual.url)}" alt="${esc(visual.alt||visual.label)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.remove()"><figcaption>${esc(visual.label)}${visual.kind==='photo'?` · 写真: <a href="${esc(visual.creditUrl)}" target="_blank" rel="noopener noreferrer">${esc(visual.credit)}</a>${visual.licenseUrl?`（<a href="${esc(visual.licenseUrl)}" target="_blank" rel="noopener noreferrer">利用条件</a>）`:''} · 画面上でトリミング表示`:''}</figcaption></figure>`:''}
<p class="byline">KIZASHI編集部｜${expertVideo?'発言者の見解と確認済み事実を分け、主張・理由・影響・未確定点を整理しています。':'公開情報を整理し、変化・仕事への影響・次の確認事項を明示しています。'}</p>
<div class="actions"><a class="button" href="${appUrl}">${expertVideo?'動画の内容をやさしい要約で確認':'AI最新ニュースをやさしい要約で確認'}</a>${sourceUrl?`<a class="button secondary" href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">${expertVideo?'元の動画・講演を見る':'情報元の記事を確認'}</a>`:''}</div></article>
${paragraph(expertVideo?"動画のやさしい解説":"やさしい解説",item.detail||item.easy_summary)}${safeHttpUrl(item.context_source_url)?`\n<section><h2>解説の確認元</h2><p>${esc(item.context_source_note||'')}</p><a class="button secondary" href="${esc(safeHttpUrl(item.context_source_url))}" target="_blank" rel="noopener noreferrer">${esc(item.context_source_name||'補足資料を読む')}</a></section>`:''}
${paragraph(expertVideo?"この動画で学べること":"何が変わったか",item.change_summary||item.simple_explanation)}
${paragraph("仕事への影響",item.impact_summary)}
${paragraph(expertVideo?"次に確かめること":"次に確認すること",item.action_suggestion)}
${topic?`<section><h2>この話題をもっと読む</h2><p><a href="${baseUrl}topics/${topic.slug}/">${esc(topic.title)}の記事一覧</a></p></section>`:''}
${relatedHtml}
<p class="note"><a href="${baseUrl}archive/">公開記事を月別に探す</a></p>
<p class="note">AI進化レーダーは公開情報を整理し、重要度と影響を分かりやすく伝えます。${expertVideo?'専門家の予測や評価は発言者本人の見解です。':''}最終判断は情報元の最新内容もご確認ください。</p>
</main></body></html>`;
}

if(path.dirname(outRoot)!==root)throw new Error("Unsafe articles output path");
fs.mkdirSync(outRoot,{recursive:true});
const valid=[];
for(const item of data){
  const id=safeId(item);
  if(id)valid.push({id,item});
}
let previousArchive=[];
try{
  const stored=JSON.parse(fs.readFileSync(manifestPath,"utf8"));
  if(Array.isArray(stored.items))previousArchive=stored.items;
}catch(_missingOrInvalidManifest){}
const currentEntries=valid.map(({id,item})=>archiveEntry(item,id));
const archive=mergePublicArchive(currentEntries,previousArchive,id=>fs.existsSync(path.join(outRoot,id,"index.html")));
const archiveById=new Map(archive.map(entry=>[entry.id,entry]));
const activeTopics=TOPICS.map(topic=>({...topic,items:archive.filter(topic.match)})).filter(topic=>topic.items.length>=3);
const sourceImagePeers=valid.map(entry=>entry.item);
for(const {id,item} of valid){
  const dir=path.join(outRoot,id);
  fs.mkdirSync(dir,{recursive:true});
  const entry=archiveById.get(id);
  const topic=activeTopics.find(candidate=>candidate.match(entry));
  fs.writeFileSync(path.join(dir,"index.html"),page(item,id,relatedArticles(item,id,valid),sourceImagePeers,topic),"utf8");
}
fs.writeFileSync(manifestPath,JSON.stringify({version:1,items:archive},null,2)+"\n","utf8");

fs.mkdirSync(topicsRoot,{recursive:true});
const topicIndexUrl=`${baseUrl}topics/`;
const topicIndexBody=`<nav class="crumb"><a href="${baseUrl}">ホーム</a> › テーマ別の記事</nav><h1>生成AIニュースをテーマから探す</h1><p class="intro">AIツールの新機能、画像・動画生成AI、安全性など、知りたい話題から記事を探せます。記事ごとに情報元と公開日を確認できます。</p><div class="links">${activeTopics.map(topic=>`<a href="${baseUrl}topics/${topic.slug}/"><strong>${esc(topic.title)}</strong><span>${esc(topic.description)}（${topic.items.length}件）</span></a>`).join("")}</div><p><a href="${baseUrl}archive/">公開記事を月別に探す</a></p>`;
fs.writeFileSync(path.join(topicsRoot,"index.html"),seoShell({title:"生成AIニュースをテーマ別に探す",description:"AIツールの新機能、画像・動画生成AI、安全性のニュースをテーマ別に探せます。情報元と公開日を確認できるKIZASHIの記事一覧です。",canonical:topicIndexUrl,body:topicIndexBody}),"utf8");
for(const topic of activeTopics){
  const dir=path.join(topicsRoot,topic.slug);
  fs.mkdirSync(dir,{recursive:true});
  const url=`${baseUrl}topics/${topic.slug}/`;
  const links=topic.items.slice(0,30).map(entry=>`<a href="${pageUrl(entry.id)}"><strong>${esc(entry.title)}</strong><span>${esc(entry.description)} · ${esc(entry.published.slice(0,10))}</span></a>`).join("");
  const body=`<nav class="crumb"><a href="${baseUrl}">ホーム</a> › <a href="${topicIndexUrl}">テーマ別</a> › ${esc(topic.title)}</nav><h1>${esc(topic.title)}</h1><p class="intro">${esc(topic.intro)}</p><div class="links">${links}</div><p><a href="${baseUrl}archive/">すべての公開記事を月別に探す</a></p>`;
  fs.writeFileSync(path.join(dir,"index.html"),seoShell({title:topic.title,description:topic.description,canonical:url,body}),"utf8");
}

fs.mkdirSync(archiveRoot,{recursive:true});
const byMonth=new Map();
for(const entry of archive){
  const month=/^\d{4}-\d{2}/.test(entry.published)?entry.published.slice(0,7):"date-unknown";
  if(!byMonth.has(month))byMonth.set(month,[]);
  byMonth.get(month).push(entry);
}
const monthPages=[...byMonth.entries()].sort((a,b)=>b[0].localeCompare(a[0]));
const archiveIndexBody=`<nav class="crumb"><a href="${baseUrl}">ホーム</a> › 公開記事</nav><h1>AIニュースの公開記事</h1><p class="intro">公開済みの記事を月別に探せます。過去の記事は掲載当時の情報です。利用条件や制度は必ず情報元の最新内容をご確認ください。</p><div class="links">${monthPages.map(([month,entries])=>`<a href="${baseUrl}archive/${month}/"><strong>${esc(month)}の記事</strong><span>${entries.length}件の公開記事</span></a>`).join("")}</div><p><a href="${topicIndexUrl}">テーマ別の記事へ</a></p>`;
fs.writeFileSync(path.join(archiveRoot,"index.html"),seoShell({title:"AIニュースの公開記事を月別に探す",description:"KIZASHIのAIニュース記事を月別に探せます。記事ごとに公開日と情報元を確認できます。",canonical:`${baseUrl}archive/`,body:archiveIndexBody}),"utf8");
for(const [month,entries] of monthPages){
  const dir=path.join(archiveRoot,month);
  fs.mkdirSync(dir,{recursive:true});
  const url=`${baseUrl}archive/${month}/`;
  const links=entries.map(entry=>`<a href="${pageUrl(entry.id)}"><strong>${esc(entry.title)}</strong><span class="date">${esc(entry.published.slice(0,10))}${entry.content_type==="expert_video"?" · AI学習動画":""}</span></a>`).join("");
  const body=`<nav class="crumb"><a href="${baseUrl}">ホーム</a> › <a href="${baseUrl}archive/">公開記事</a> › ${esc(month)}</nav><h1>${esc(month)}のAIニュース</h1><p class="intro">${entries.length}件の記事を掲載しています。公開当時の情報のため、現在の利用条件や制度は情報元で再確認してください。</p><div class="links">${links}</div><p><a href="${topicIndexUrl}">テーマ別に探す</a></p>`;
  fs.writeFileSync(path.join(dir,"index.html"),seoShell({title:`${month}のAIニュース`,description:`${month}に公開したAIニュース・AI学習動画の記事一覧。記事の情報元と公開日を確認できます。`,canonical:url,body}),"utf8");
}

let homeLastmod="";
try{const edition=JSON.parse(fs.readFileSync(path.join(root,"home-edition.json"),"utf8"));homeLastmod=isoDate(edition.home_content_changed_at||edition.last_published_at).slice(0,10);}catch(_missingEdition){}
const sitemap=[
  `<?xml version="1.0" encoding="UTF-8"?>`,
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
  `  <url><loc>${baseUrl}</loc>${homeLastmod?`<lastmod>${homeLastmod}</lastmod>`:""}</url>`,
  `  <url><loc>${topicIndexUrl}</loc></url>`,
  ...activeTopics.map(topic=>`  <url><loc>${baseUrl}topics/${topic.slug}/</loc></url>`),
  `  <url><loc>${baseUrl}archive/</loc></url>`,
  ...monthPages.map(([month])=>`  <url><loc>${baseUrl}archive/${month}/</loc></url>`),
  ...archive.map(entry=>`  <url><loc>${pageUrl(entry.id)}</loc>${entry.lastmod?`<lastmod>${entry.lastmod.slice(0,10)}</lastmod>`:""}</url>`),
  `</urlset>`,""
].join("\n");
fs.writeFileSync(path.join(root,"sitemap.xml"),sitemap,"utf8");
fs.writeFileSync(path.join(root,"robots.txt"),`User-agent: *\nAllow: /\nSitemap: ${baseUrl}sitemap.xml\n`,"utf8");
console.log(`Built ${valid.length} current article pages; kept ${archive.length} published article URLs and ${activeTopics.length} topic hubs.`);
