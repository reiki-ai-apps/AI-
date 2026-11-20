import fs from "node:fs";
import {publicationTextIssues} from "./publication-quality.cjs";
import "./test-publication-quality.mjs";
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
  '詳しく読む','detail-quick-take','今回の新着${newCount?` ${newCount}件`:\'\'}を話題性・重要性で審査','前の日までに載せていない記事から選定','function trackAppEvent',
  '興味のある情報テーマを好きなだけ選んでください','AI要約の根拠になった元の記事を、登録なしで確認できます','function renderOperator',
  'id="visitorTracker"',"data-operator-account-daily-opens",
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
for(const text of ['node scripts/build-public-articles.mjs','data.json home-edition.json .story-index.json index.html articles archive topics public-article-archive.json assets/story-photos sitemap.xml robots.txt'])requireText(workflow,text);

const ids=data.map(item=>String(item.article_id||item.id||'')).filter(id=>/^[A-Za-z0-9_-]{8,100}$/.test(id));
const itemsById=new Map(data.map(item=>[String(item.article_id||item.id||''),item]));
for(const [index,item] of data.entries()){
  for(const message of publicationTextIssues(item)){
    failures.push(`${index+1}件目: ${message}: ${item.article_id||item.title}`);
  }
}
for(const id of ids){
  const item=itemsById.get(id)||{};
  const expertVideo=String(item.content_type||"").toLowerCase()==="expert_video";
  const file=path.join(root,"articles",id,"index.html");
  if(!fs.existsSync(file)){failures.push(`記事ページがありません: ${id}`);continue;}
  const page=fs.readFileSync(file,"utf8");
  if(!page.includes('application/ld+json')||!page.includes('BreadcrumbList')||!page.includes(`/articles/${encodeURIComponent(id)}/`))failures.push(`記事SEOが不完全です: ${id}`);
  if(!page.includes('assets/visitor-tracker.js'))failures.push(`記事閲覧が累計ユニーク閲覧者に反映されません: ${id}`);
  const expectedCta=expertVideo
    ?`href="https://reiki-ai-apps.github.io/AI-/">動画の内容をやさしい要約で確認</a>`
    :`href="https://reiki-ai-apps.github.io/AI-/">AI最新ニュースをやさしい要約で確認</a>`;
  const expectedHeading=expertVideo?"<h2>動画のやさしい解説</h2>":"<h2>やさしい解説</h2>";
  if(!page.includes(expectedCta))failures.push(`記事から一覧への導線がありません: ${id}`);
  if(!page.includes(expectedHeading))failures.push(`記事に内容別のやさしい解説がありません: ${id}`);
  if((page.match(/<\/p><p>/g)||[]).length<2)failures.push(`やさしい解説の3段落が保持されていません: ${id}`);
  if(!page.includes('href="https://reiki-ai-apps.github.io/AI-/archive/"'))failures.push(`記事から公開記事一覧への内部リンクがありません: ${id}`);
  if(!expertVideo&&item.editorial_image_url){
    const expected=`assets/story-photos/${id}.png`;
    if(item.editorial_image_url!==expected||!fs.existsSync(path.join(root,expected)))failures.push(`記事専用画像がありません: ${id}`);
    if(!page.includes('class="article-image"'))failures.push(`記事画像が表示されません: ${id}`);
  }
  if(!page.includes('class="article-image"')&&page.includes('話題のイメージ画像'))failures.push(`記事に無関係な代替画像があります: ${id}`);
  if(page.includes('#update-detail/'))failures.push(`保存期間後に切れる記事詳細リンクがあります: ${id}`);
}
if(index.includes('3分'))failures.push('意味の不明確な3分訴求がアプリ画面に残っています');
if(read("scripts/build-public-articles.mjs").includes('3分'))failures.push('意味の不明確な3分訴求が記事生成処理に残っています');
requireText(read("robots.txt"),'Sitemap: https://reiki-ai-apps.github.io/AI-/sitemap.xml');
requireText(read("sitemap.xml"),'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
for(const text of ['href="./topics/"','href="./archive/"'])requireText(index,text,'ホームから記事一覧への固定リンクがありません');
const archive=JSON.parse(read("public-article-archive.json"));
if(!Array.isArray(archive.items)||archive.items.length<ids.length)failures.push('公開記事アーカイブに現行記事が保存されていません');
for(const entry of archive.items){
  if(!fs.existsSync(path.join(root,"articles",entry.id,"index.html")))failures.push(`アーカイブの記事ページがありません: ${entry.id}`);
  if(!read("sitemap.xml").includes(`/articles/${entry.id}/`))failures.push(`アーカイブの記事がサイトマップにありません: ${entry.id}`);
}
const delayedArticle=data.find(item=>item.source_published_at&&item.fetched_at&&item.source_published_at.slice(0,10)!==item.fetched_at.slice(0,10)&&!item.source_updated_at);
if(delayedArticle){
  const page=read(`articles/${delayedArticle.article_id}/index.html`);
  const publishedDay=delayedArticle.source_published_at.slice(0,10);
  if(!page.includes(`"dateModified":"${delayedArticle.source_published_at}"`))failures.push('取得日時を記事の更新日時として誤表示しています');
  if(!read("sitemap.xml").includes(`<loc>https://reiki-ai-apps.github.io/AI-/articles/${delayedArticle.article_id}/</loc><lastmod>${publishedDay}</lastmod>`))failures.push('サイトマップの更新日が取得日時になっています');
}
for(const file of ["topics/index.html","archive/index.html"]){
  if(!fs.existsSync(path.join(root,file)))failures.push(`静的な記事一覧がありません: ${file}`);
}

if(failures.length){console.error(failures.join("\n"));process.exit(1);}
console.log(`Growth readiness OK: ${archive.items.length} retained public article pages, SEO/share/free-access/privacy checks passed.`);
