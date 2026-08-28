import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const index=read("index.html");
const schema=read("supabase/schema.sql");
const migration=read("supabase/free-access-daily-opens-2026-08-27.sql");
const tracker=read("assets/visitor-tracker.js");
const workflow=read(".github/workflows/update.yml");
const failures=[];
const expect=(condition,label)=>{if(!condition)failures.push(label);};
const between=(start,end)=>index.match(new RegExp(`${start}[\\s\\S]*?${end}`))?.[0]||"";

for(const [pattern,label] of [
  [/const FREE_ACCESS_RULES=\{topics:Infinity,sourceViews:Infinity,retention:30,csv:true/,"all visitors receive the complete local feature set"],
  [/function effectivePlanKey\(\)\{return 'free';\}/,"all visitors use one access rule set"],
  [/一般利用者向けの登録・ログイン機能はありません/,"operator entry clearly says it is not public registration"],
  [/data-operator-visitors/,"unique visitor field exists"],
  [/data-operator-daily-opens/,"daily open field exists"],
  [/id="mobileOperatorMetrics" class="operator-metrics" hidden/,"mobile operator metrics keep a permanent mount"],
  [/isOperatorGrant\?`<section class="billing-panel"[\s\S]*?data-operator-account-daily-opens/,"operator dashboard protects its metrics"],
  [/function renderSupport[\s\S]*?https:\/\/x\.com\/KIZASHI_jp/,"support is available without an account"],
])expect(pattern.test(index),label);

for(const [pattern,label] of [
  [/data-operator-users|data-operator-account-users/,"registered account counts are absent"],
  [/signUpMember|signInMember|signOutMember|renderAccount|go\('account'\)/,"public account UI and actions are absent"],
  [/syncMemberAppStateFromCloud|loadMemberAppState|user_states/,"public cloud account sync is absent"],
  [/create-portal-session|buy\.stripe\.com|checkoutUrl:|pricingPlanAction/,"billing and checkout UI are absent"],
  [/rpc\('record_app_event'/,"retired funnel RPC cannot produce production 404s"],
])expect(!pattern.test(index),label);

const sourceOpen=between("function openSourceArticle\\(id\\)\\{","function publicArticleUrl");
expect(/window\.open\(sourceUrl,'_blank','noopener,noreferrer'\)/.test(sourceOpen),"source article opens directly and safely");
expect(!/memberState\.user|record_article_view|sourceViews|requirePlan/.test(sourceOpen),"source article opening has no login or quota gate");

const tools=between("function renderTools\\(v\\)\\{","function renderToolForm");
expect(/全機能無料/.test(tools),"settings screen states that features are free");
expect(!/effectivePlanKey|requirePlan|料金プラン/.test(tools),"settings screen has no plan gate");

for(const [body,label] of [[schema,"canonical schema"],[migration,"production migration"]]){
  for(const required of [
    "create table if not exists public.app_open_events","function public.record_app_open",
    "on conflict (event_id) do nothing","alter table public.app_open_events enable row level security",
    "revoke all on table public.app_open_events from anon, authenticated",
    "grant execute on function public.record_app_open(uuid) to anon, authenticated",
    "daily_opens","Asia/Tokyo","operator_grant"
  ])expect(body.includes(required),`${label}: ${required}`);
}

expect(/rpc\('record_app_open',\{p_event_id:APP_OPEN_EVENT_ID\}\)/.test(index),"app shell records each initial open");
expect(/APP_OPEN_MAX_ATTEMPTS=5/.test(index),"app open retries are bounded");
expect(/\/rpc\/record_app_open/.test(tracker)&&/p_event_id:OPEN_EVENT_ID/.test(tracker),"direct public articles record an open");
expect(/Promise\.allSettled\(\[register\(\),recordOpen\(\)\]\)/.test(tracker),"unique and total counters fail independently");
expect(workflow.includes("node scripts/test-free-access-daily-metrics.mjs"),"scheduled updates run this regression test");

if(failures.length){console.error(failures.join("\n"));process.exit(1);}
console.log("Registration-free access and operator metrics contract passed.");
