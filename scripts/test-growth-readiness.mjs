import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const index=read("index.html");
const schema=read("supabase/schema.sql");
const workflow=read(".github/workflows/update.yml");
const data=JSON.parse(read("data.json"));
const failures=[];
const requireText=(body,text,label)=>{if(!body.includes(text))failures.push(label||`missing: ${text}`);};

for(const text of [
  '<link rel="canonical" href="https://reiki-ai-apps.github.io/AI-/"',
  'property="og:title"','name="twitter:card"','"@type":"WebSite"','function shareArticle','無料登録はカード情報不要',
  '変化と仕事への影響を見る','重要トップニュースはテーマ外でも表示','function trackAppEvent',
  'サブスクなし。','好きな情報テーマを無制限に設定','情報元の記事を回数制限なく確認',
  "trackAppEvent('signup_start'","p_event_id:APP_OPEN_EVENT_ID","data-operator-account-daily-opens",
  "String(u.article_id||'')===key",'href="${esc(publicArticleUrl(u))}"'
])requireText(index,text);
for(const text of [
  'function patchPublishedArticleFields(target,it,tool)',
  'easy_summary:String(it.detail||\'\')',
  'if(current){if(patchPublishedArticleFields(current,it,tool))',
  '記事の解説と更新情報を更新しました'
])requireText(index,text);
if(index.includes('重要ニュース通知（提供予定）'))failures.push('未提供機能を料金プランに表示しています');
if(index.includes('複数事業やチームで'))failures.push('未提供のチーム機能を料金説明に含めています');

for(const text of ['create table if not exists public.app_open_events','function public.record_app_open','daily_opens','Asia/Tokyo','alter table public.app_open_events enable row level security','revoke all on table public.app_open_events from anon, authenticated'])requireText(schema,text);
for(const text of ['node scripts/build-public-articles.mjs','articles sitemap.xml robots.txt'])requireText(workflow,text);

const ids=data.map(item=>String(item.article_id||item.id||'')).filter(id=>/^[A-Za-z0-9_-]{8,100}$/.test(id));
const itemsById=new Map(data.map(item=>[String(item.article_id||item.id||''),item]));
for(const [index,item] of data.entries()){
  const detail=String(item.detail||"").trim();
  const compactLength=detail.replace(/\s+/g,"").length;
  const paragraphs=detail.split(/\n+/).map(value=>value.trim()).filter(Boolean);
  const sentences=(detail.match(/[。！？!?]/g)||[]).length;
  if(compactLength<420||compactLength>720||paragraphs.length<3||sentences<7){
    failures.push(`${index+1}件目のやさしい解説が深掘り基準未達です: ${item.article_id||item.title}`);
  }
}
for(const id of ids){
  const item=itemsById.get(id)||{};
  const file=path.join(root,"articles",id,"index.html");
  if(!fs.existsSync(file)){failures.push(`記事ページがありません: ${id}`);continue;}
  const page=fs.readFileSync(file,"utf8");
  if(!page.includes('application/ld+json')||!page.includes('BreadcrumbList')||!page.includes(`/articles/${encodeURIComponent(id)}/`))failures.push(`記事SEOが不完全です: ${id}`);
  if(!page.includes('assets/visitor-tracker.js'))failures.push(`記事閲覧が累計ユニーク閲覧者に反映されません: ${id}`);
  if(!page.includes(`href="https://reiki-ai-apps.github.io/AI-/">AI最新ニュースをやさしい要約で確認</a>`))failures.push(`記事から最新ニュースへの導線がありません: ${id}`);
  if(!page.includes("<h2>やさしい解説</h2>"))failures.push(`記事にやさしい解説がありません: ${id}`);
  if(!page.includes("</p><p>"))failures.push(`やさしい解説の3段落が保持されていません: ${id}`);
  if(!page.includes('class="article-image"')||!page.includes('class="related"'))failures.push(`記事画像または内部リンクがありません: ${id}`);
  if(page.includes('#update-detail/'))failures.push(`保存期間後に切れる記事詳細リンクがあります: ${id}`);
}
if(index.includes('3分'))failures.push('意味の不明確な3分訴求がアプリ画面に残っています');
if(read("scripts/build-public-articles.mjs").includes('3分'))failures.push('意味の不明確な3分訴求が記事生成処理に残っています');
requireText(read("robots.txt"),'Sitemap: https://reiki-ai-apps.github.io/AI-/sitemap.xml');
requireText(read("sitemap.xml"),'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

if(failures.length){console.error(failures.join("\n"));process.exit(1);}
console.log(`Growth readiness OK: ${ids.length} public article pages, SEO/share/free-access/privacy checks passed.`);
