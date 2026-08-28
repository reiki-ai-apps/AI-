import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const index=read("index.html");
const updater=read("update.js");
const workflow=read(".github/workflows/update.yml");
const failures=[];
const expect=(condition,label)=>{if(!condition)failures.push(label);};
const section=(start,end)=>index.match(new RegExp(`${start}[\\s\\S]*?${end}`))?.[0]||"";

const nav=section("const NAV = \\[","let route");
const pageMeta=section("const PAGE_META = \\{","let _lastRenderedRoute");
const dispatch=section("function render\\(\\)\\{","/\\* ---------- helpers");
const operator=section("function renderOperator\\(v\\)\\{","function exportUpdatesCsv");
const support=section("function renderSupport\\(v\\)\\{","function legalShell");

for(const [pattern,label] of [
  [/operator:\['運営者'/,"operator route exists outside public navigation"],
  [/function signInOperator\(/,"operator-only sign-in action exists"],
  [/function signOutOperator\(/,"operator-only sign-out action exists"],
  [/一般利用者向けの登録・ログイン機能はありません/,"operator page explains the registration-free design"],
  [/設定・保存・閲覧履歴は、この端末のブラウザー内に保存されます/,"local storage behavior is explained"],
  [/登録やログインは不要です/,"support is registration-free"],
  [/function submitPublicReview\(/,"public reviews remain available"],
  [/function openSourceArticle\(/,"source articles remain available"],
  [/function renderTools\(/,"feed settings remain available"],
])expect(pattern.test(index),label);

expect(!/id:'account'|id:'pricing'/.test(nav),"public navigation contains no account or pricing entry");
expect(!/account:\[|pricing:\[/.test(pageMeta),"public routes contain no account or pricing page");
expect(/operator:renderOperator/.test(dispatch),"router dispatches the isolated operator page");
expect(!/account:renderAccount|pricing:renderPricing/.test(dispatch),"router cannot dispatch retired member pages");
expect(/signInOperator\(\)/.test(operator)&&!/signUp/.test(operator),"operator page offers sign-in only, never sign-up");
expect(!/memberState\.user/.test(support),"support is not gated by authentication");

for(const [pattern,label] of [
  [/function signUpMember|\.auth\.signUp\(/,"public sign-up code is absent"],
  [/function renderAccount|function renderPricing/,"member and pricing pages are absent"],
  [/go\('account'\)|go\('pricing'\)/,"retired member routes are not linked"],
  [/無料登録|ログイン・会員情報|会員情報|登録アカウント数/,"retired member wording is absent"],
  [/data-operator-users|data-operator-account-users|registeredUsers/,"registration totals are absent"],
  [/syncMemberAppStateFromCloud|loadMemberAppState|saveMemberAppState|from\('user_states'\)/,"account cloud sync code is absent"],
  [/create-portal-session|beginCheckout|confirmSubscriptionAfterPayment|openBillingManagement/,"billing code is absent"],
])expect(!pattern.test(index),label);

expect(!/signInMember|authConsent|signup_start|無料登録/.test(updater),"automated updates cannot restore member UI");
expect(workflow.includes("node scripts/test-no-membership.mjs"),"scheduled updates enforce the no-membership contract");

if(failures.length){console.error(failures.join("\n"));process.exit(1);}
console.log("No-membership contract passed.");
