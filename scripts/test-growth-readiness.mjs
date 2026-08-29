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
  'property="og:title"','name="twitter:card"','"@type":"WebSite"','function shareArticle','一般利用者向けの登録・ログイン機能はありません',
  '変化と仕事への影響を見る','テーマ設定に関係なく重要度で選定','function trackAppEvent',
  '興味のある情報テーマを好きなだけ選んでください','AI要約の根拠になった元の記事を、登録なしで確認できます','function renderOperator',
  "p_event_id:APP_OPEN_EVENT_ID","data-operator-account-daily-opens",
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
if(/signUpMember|renderAccount|go\('account'\)|data-operator-users|syncMemberAppStateFromCloud/.test(index))failures.push('廃止した会員制度の画面または処理が残っています');

for(const text of ['create table if not exists public.app_open_events','function public.record_app_open','daily_opens','Asia/Tokyo','alter table public.app_open_events enable row level security','revoke all on table public.app_open_events from anon, authenticated'])requireText(schema,text);
for(const text of ['node scripts/build-public-articles.mjs','articles sitemap.xml robots.txt'])requireText(workflow,text);

const ids=data.map(item=>String(item.article_id||item.id||'')).filter(id=>/^[A-Za-z0-9_-]{8,100}$/.test(id));
const itemsById=new Map(data.map(item=>[String(item.article_id||item.id||''),item]));
for(const [index,item] of data.entries()){
  const detail=String(item.detail||"").trim();
  const compactLength=detail.replace(/\s+/g,"").length;
  const paragraphs=detail.split(/\n+/).map(value=>value.trim()).filter(Boolean);
  const sentences=(detail.match(/[。！？!?]/g)||[]).length;
  const longestSentence=detail.split(/(?<=[。！？!?])/).reduce((max,value)=>Math.max(max,value.replace(/\s+/g,"").length),0);
  if(compactLength<170||compactLength>310||paragraphs.length<2||paragraphs.length>3||sentences<5||sentences>7||longestSentence>85){
    failures.push(`${index+1}件目のやさしい解説が高校生向け基準未達です: ${item.article_id||item.title}`);
  }
  for(const [term,meaning] of [["GPU","半導体"],["AIエージェント","作業も順番"],["マルチモーダル","文章だけでなく"],["API","窓口"]]){
    if(detail.includes(term)&&!detail.includes(meaning))failures.push(`${index+1}件目の専門語「${term}」に説明がありません: ${item.article_id||item.title}`);
  }
  if(/\bM&A\b|セキュリティリスク|業務プロセス|相互運用性|知識労働|AI依存傾向|注意喚起|競争構図|導入先選定/.test(detail)){
    failures.push(`${index+1}件目のやさしい解説に言い換えていない業界語があります: ${item.article_id||item.title}`);
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
  if(!page.includes("</p><p>"))failures.push(`やさしい解説の2段落が保持されていません: ${id}`);
  if(!page.includes('class="article-image"')||!page.includes('class="related"'))failures.push(`記事画像または内部リンクがありません: ${id}`);
  if(page.includes('#update-detail/'))failures.push(`保存期間後に切れる記事詳細リンクがあります: ${id}`);
}
if(index.includes('3分'))failures.push('意味の不明確な3分訴求がアプリ画面に残っています');
if(read("scripts/build-public-articles.mjs").includes('3分'))failures.push('意味の不明確な3分訴求が記事生成処理に残っています');
requireText(read("robots.txt"),'Sitemap: https://reiki-ai-apps.github.io/AI-/sitemap.xml');
requireText(read("sitemap.xml"),'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

if(failures.length){console.error(failures.join("\n"));process.exit(1);}
console.log(`Growth readiness OK: ${ids.length} public article pages, SEO/share/free-access/privacy checks passed.`);
