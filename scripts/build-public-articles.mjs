import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const data=JSON.parse(fs.readFileSync(path.join(root,"data.json"),"utf8"));
const baseUrl="https://reiki-ai-apps.github.io/AI-/";
const outRoot=path.join(root,"articles");

function esc(value){
  return String(value??"").replace(/[&<>\"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
}
function clean(value,max=220){
  return String(value??"").replace(/\s+/g," ").trim().slice(0,max);
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
  const text=clean(value,4000);
  return text?`<section><h2>${esc(label)}</h2><p>${esc(text)}</p></section>`:"";
}
function articleImage(item){
  const text=[item.title,item.easy_summary,item.impact_summary,...(item.related_categories||[])].join(" ").toLowerCase();
  const rules=[
    [/(security|vulnerability|attack|privacy|セキュリティ|脆弱|攻撃|情報漏えい)/,"ai-card-cyber.webp"],
    [/(price|cost|investment|market|stock|料金|価格|投資|市場|株式)/,"ai-card-finance.webp"],
    [/(factory|manufactur|automation|工場|製造|自動化)/,"ai-card-factory.webp"],
    [/(law|regulation|copyright|policy|法律|規制|著作権|政策)/,"ai-card-legal.webp"],
    [/(education|school|learning|教育|学校|学習)/,"ai-card-education.webp"],
    [/(video|image|music|design|creative|動画|画像|音楽|デザイン)/,"ai-card-creative.webp"],
    [/(health|medical|bio|drug|医療|健康|生命|創薬)/,"ai-card-bio.webp"],
    [/(cloud|server|datacenter|infrastructure|クラウド|サーバー|データセンター|基盤)/,"ai-card-cloud.webp"],
    [/(robot|agent|assistant|ロボット|エージェント|アシスタント)/,"ai-card-robot.webp"],
    [/(mobility|vehicle|driving|自動車|車両|モビリティ|自動運転)/,"ai-card-mobility.webp"],
  ];
  const file=(rules.find(([pattern])=>pattern.test(text))||[])[1]||"ai-radar-human-hero.webp";
  return `${baseUrl}assets/${file}`;
}
function relatedArticles(item,id,pool,limit=3){
  const categories=new Set(item.related_categories||[]);
  const entity=clean(item.primary_entity||item.tool_name||"",80).toLowerCase();
  return pool.filter(candidate=>candidate.id!==id).map(candidate=>{
    const shared=(candidate.item.related_categories||[]).filter(value=>categories.has(value)).length;
    const candidateText=[candidate.item.title,candidate.item.primary_entity,candidate.item.tool_name].join(" ").toLowerCase();
    const entityMatch=entity&&candidateText.includes(entity)?3:0;
    const date=new Date(candidate.item.source_published_at||candidate.item.published_at||candidate.item.fetched_at||0).getTime()||0;
    return {...candidate,score:shared*2+entityMatch,date};
  }).sort((a,b)=>b.score-a.score||b.date-a.date).slice(0,limit);
}
function page(item,id,related=[]){
  const canonical=`${baseUrl}articles/${encodeURIComponent(id)}/`;
  const appUrl=baseUrl;
  const title=clean(item.title,120)||"AI重要ニュース";
  const description=clean(item.easy_summary||item.raw_excerpt||item.detail,180)||"AI進化レーダーが重要度と仕事への影響を整理したAIニュースです。";
  const published=isoDate(item.source_published_at||item.published_at||item.fetched_at);
  const updated=isoDate(item.source_updated_at||item.fetched_at||item.published_at);
  const image=articleImage(item);
  const articleLd={
    "@type":"NewsArticle",
    "@id":`${canonical}#article`,
    headline:title,
    description,
    image:[image],
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
      {"@type":"ListItem",position:2,name:title,item:canonical}
    ]
  }]};
  const relatedHtml=related.length?`<section class="related"><h2>関連するAIニュース</h2><div class="related-grid">${related.map(candidate=>{
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
<meta property="og:url" content="${canonical}"><meta property="og:image" content="${image}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${image}">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g,"\\u003c")}</script>
<style>
:root{color-scheme:dark;font-family:"Noto Sans JP",system-ui,sans-serif;background:#050a14;color:#eef6ff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 85% 0,#10295a 0,transparent 30rem),#050a14}main{width:min(860px,calc(100% - 28px));margin:0 auto;padding:24px 0 60px}.brand{display:flex;align-items:center;gap:10px;color:#73e8ee;font-size:13px;font-weight:800;letter-spacing:.1em;text-decoration:none}.brand img{width:34px;height:34px;border-radius:9px}.hero{margin-top:22px;padding:clamp(22px,5vw,46px);border:1px solid #1c8ea0;border-radius:22px;background:linear-gradient(145deg,rgba(7,28,51,.97),rgba(16,19,58,.94));box-shadow:0 24px 80px #0009}.meta{color:#9fb1c6;font-size:13px}.rank{display:inline-flex;margin-right:8px;padding:4px 9px;border-radius:999px;background:#d82757;color:white;font-weight:900}.hero h1{margin:18px 0 14px;font-size:clamp(26px,5vw,44px);line-height:1.38}.lead{color:#c6d4e4;font-size:clamp(15px,2vw,18px);line-height:1.9}.article-image{display:block;width:100%;height:auto;aspect-ratio:16/9;margin:22px 0 0;border:1px solid #173d5c;border-radius:16px;object-fit:cover}.byline{margin:14px 0 0;color:#91a5bb;font-size:13px;line-height:1.7}section{margin-top:18px;padding:21px;border:1px solid #18344c;border-radius:16px;background:#081526}section h2{margin:0 0 9px;color:#72e6ec;font-size:16px}section p{margin:0;color:#c3d0df;line-height:1.9;white-space:pre-line}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}.button{display:inline-flex;min-height:48px;align-items:center;justify-content:center;padding:0 18px;border-radius:12px;background:linear-gradient(135deg,#0899bd,#6d35d8);color:white;font-weight:800;text-decoration:none}.button.secondary{border:1px solid #2a6380;background:#0b1d31}.related-grid{display:grid;gap:10px}.related-grid a{display:block;padding:12px 14px;border:1px solid #1e4967;border-radius:11px;color:#dffbff;background:#0a1b2d;text-decoration:none;line-height:1.6}.related-grid a:hover{border-color:#61dbe4;color:#fff}.note{margin-top:18px;color:#8194aa;font-size:12px;line-height:1.7}@media(max-width:520px){main{width:min(100% - 20px,860px)}.hero{border-radius:16px}.actions{display:grid}.button{width:100%}}
</style></head><body><main>
<a class="brand" href="${baseUrl}"><img src="${baseUrl}assets/ai-radar-icon-192.png" alt="">AI進化レーダー</a>
<article class="hero"><div class="meta"><span class="rank">重要度${esc(String(item.importance||"B").toUpperCase())}</span>${esc(item.source_name||"情報元確認済み")}・${esc(displayDate(item.source_published_at||item.published_at||item.fetched_at))}</div><h1>${esc(title)}</h1><p class="lead">${esc(description)}</p>
<img class="article-image" src="${image}" alt="${esc(title)}の内容を表すイメージ" width="1200" height="675">
<p class="byline">KIZASHI編集部｜公開情報を整理し、変化・仕事への影響・次の確認事項を明示しています。</p>
<div class="actions"><a class="button" href="${appUrl}">最新AIニュースを毎日3分で確認</a></div></article>
${paragraph("何が変わったか",item.change_summary||item.simple_explanation)}
${paragraph("仕事への影響",item.impact_summary)}
${paragraph("次に確認すること",item.action_suggestion)}
${relatedHtml}
<p class="note">AI進化レーダーは公開情報を整理し、重要度と影響を分かりやすく伝えます。最終判断は情報元の最新内容もご確認ください。</p>
</main></body></html>`;
}

if(path.dirname(outRoot)!==root)throw new Error("Unsafe articles output path");
if(fs.existsSync(outRoot))fs.rmSync(outRoot,{recursive:true,force:true});
fs.mkdirSync(outRoot,{recursive:true});
const valid=[];
for(const item of data){
  const id=safeId(item);
  if(id)valid.push({id,item});
}
for(const {id,item} of valid){
  const dir=path.join(outRoot,id);
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,"index.html"),page(item,id,relatedArticles(item,id,valid)),"utf8");
}

const sitemap=[
  `<?xml version="1.0" encoding="UTF-8"?>`,
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
  `  <url><loc>${baseUrl}</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
  ...valid.map(({id,item})=>{
    const lastmod=isoDate(item.source_updated_at||item.fetched_at||item.published_at).slice(0,10);
    return `  <url><loc>${baseUrl}articles/${encodeURIComponent(id)}/</loc>${lastmod?`<lastmod>${lastmod}</lastmod>`:""}<changefreq>weekly</changefreq><priority>0.8</priority></url>`;
  }),
  `</urlset>`,""
].join("\n");
fs.writeFileSync(path.join(root,"sitemap.xml"),sitemap,"utf8");
fs.writeFileSync(path.join(root,"robots.txt"),`User-agent: *\nAllow: /\nSitemap: ${baseUrl}sitemap.xml\n`,"utf8");
console.log(`Built ${valid.length} public article pages.`);
