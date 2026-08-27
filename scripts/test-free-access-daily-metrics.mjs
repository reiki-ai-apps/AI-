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
  [/const FREE_ACCESS_RULES=\{topics:Infinity,sourceViews:Infinity,retention:30,csv:true/,"free access rules provide former top-level features"],
  [/function effectivePlanKey\(\)\{return 'free';\}/,"all visitors use the free access rule set"],
  [/サブスクなし。<br>すべての機能を無料で。/,"free-access page clearly explains the change"],
  [/好きな情報テーマを無制限に設定/,"unlimited topic settings are communicated"],
  [/情報元の記事を回数制限なく確認/,"unlimited source access is communicated"],
  [/data-operator-visitors/,"unique visitor field exists"],
  [/data-operator-daily-opens/,"daily open field exists"],
  [/data-operator-users/,"registered user field exists"],
  [/id="mobileOperatorMetrics" class="operator-metrics" hidden/,"mobile operator metrics keep a permanent mount"],
  [/isOperatorGrant\?`<section class="billing-panel"[\s\S]*?data-operator-account-daily-opens/,"account metrics are rendered only inside the operator section"],
])expect(pattern.test(index),label);

expect(!/buy\.stripe\.com|checkoutUrl:|pricingPlanAction/.test(index),"new subscription checkout links are absent");
expect(!/rpc\('record_app_event'/.test(index),"retired funnel RPC cannot keep producing production 404s");

const sourceOpen=between("function openSourceArticle\\(id\\)\\{","function publicArticleUrl");
expect(/window\.open\(sourceUrl,'_blank','noopener,noreferrer'\)/.test(sourceOpen),"source article opens directly and safely");
expect(!/memberState\.user|record_article_view|sourceViews|requirePlan/.test(sourceOpen),"source article opening has no login, plan, or quota gate");

const tools=between("function renderTools\\(v\\)\\{","function renderToolForm");
expect(/全機能無料/.test(tools),"settings screen states that features are free");
expect(!/effectivePlanKey|requirePlan|料金プラン/.test(tools),"settings screen has no plan gate");

for(const [body,label] of [[schema,"canonical schema"],[migration,"production migration"]]){
  for(const required of [
    "create table if not exists public.app_open_events",
    "function public.record_app_open",
    "on conflict (event_id) do nothing",
    "alter table public.app_open_events enable row level security",
    "revoke all on table public.app_open_events from anon, authenticated",
    "grant execute on function public.record_app_open(uuid) to anon, authenticated",
    "daily_opens",
    "Asia/Tokyo",
    "operator_grant"
  ])expect(body.includes(required),`${label}: ${required}`);
}

expect(/rpc\('record_app_open',\{p_event_id:APP_OPEN_EVENT_ID\}\)/.test(index),"app shell records each initial open");
expect(/APP_OPEN_MAX_ATTEMPTS=5/.test(index),"app open retries are bounded");
expect(/\/rpc\/record_app_open/.test(tracker)&&/p_event_id:OPEN_EVENT_ID/.test(tracker),"direct public articles record an open");
expect(/Promise\.allSettled\(\[register\(\),recordOpen\(\)\]\)/.test(tracker),"unique and total counters fail independently");
expect(workflow.includes("node scripts/test-free-access-daily-metrics.mjs"),"scheduled updates run the free-access regression test");

if(failures.length){
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Free access and daily operator metrics contract passed.");
