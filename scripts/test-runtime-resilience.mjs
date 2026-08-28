import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const index=fs.readFileSync(path.join(root,"index.html"),"utf8");
const workflow=fs.readFileSync(path.join(root,".github","workflows","update.yml"),"utf8");
const failures=[];
const expect=(condition,label)=>{if(!condition)failures.push(label);};
const section=(start,end)=>index.match(new RegExp(`${start}[\\s\\S]*?${end}`))?.[0]||"";

for(const match of index.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){
  const openingTag=match[0].slice(0,match[0].indexOf(">")+1);
  if(match[1].trim()&&!/type=["']application\/ld\+json["']/i.test(openingTag)){
    try{Function(match[1]);}catch(error){failures.push(`inline application script parses: ${error.message}`);}
  }
}

const metricsValidator=section("function validOperatorMetrics\\(data\\)\\{","async function loadOperatorMetrics");
expect(Boolean(metricsValidator),"operator metrics validator exists");
if(metricsValidator){
  const source=metricsValidator.replace(/async function loadOperatorMetrics[\s\S]*$/,'');
  const validate=Function(`${source}; return validOperatorMetrics;`)();
  expect(validate({unique_visitors:34})?.dailyOpens===null,"missing daily count keeps unique count visible");
  expect(validate({unique_visitors:34,daily_opens:56})?.dailyOpens===56,"daily open count is accepted");
  expect(validate({unique_visitors:"bad",daily_opens:56})===null,"invalid unique count is rejected");
  expect(validate({unique_visitors:34,daily_opens:"bad"})===null,"invalid daily count is rejected");
  expect(!("registeredUsers" in validate({unique_visitors:34,daily_opens:56})),"retired registration count is not modeled");
}

const operatorAccess=section("async function loadOperatorAccess\\(\\)\\{","function validOperatorMetrics");
for(const [needle,label] of [
  ["cachedOperatorAccessForUser(memberState.user?.id)","verified operator access has a local continuity fallback"],
  ["for(const delay of [0,500,1400])","operator access uses bounded retries"],
  ["return isOperator?{access_source:'operator_grant'}:{access_source:'none'}","verified non-operator access is distinguished from a network failure"]
])expect(operatorAccess.includes(needle),label);

const operatorState=section("async function refreshOperatorState\\(session\\)\\{","function queueOperatorRefresh");
for(const [needle,label] of [
  ["const previousAccess=sameUser?memberState.subscription:cachedOperatorAccessForUser(nextUserId)","same operator access survives token refresh"],
  ["const previousMetrics=sameUser?memberState.operatorMetrics:null","verified counts survive token refresh"],
  ["memberState.subscription=access?.access_source==='operator_grant'?access:null","only verified operator grants become active"],
  ["memberClient.auth.signOut({scope:'local'})","retired public sessions are signed out locally"]
])expect(operatorState.includes(needle),label);

const metricsRefresh=section("async function refreshOperatorMetrics\\(\\)\\{","function startOperatorMetricsRefresh");
for(const [needle,label] of [
  ["for(const delay of [0,700,1800])","operator metrics use bounded retries"],
  ["memberState.operatorMetricsStatus=memberState.operatorMetrics?'stale':'error'","temporary failure preserves the last verified counts"],
  ["memberState.operatorMetricsUpdatedAt=new Date().toISOString()","successful refresh records its verification time"]
])expect(metricsRefresh.includes(needle),label);
expect(!/catch\(error\)\{[\s\S]*?memberState\.operatorMetrics=null/.test(metricsRefresh),"metrics catch path never deletes verified counts");

for(const [needle,label] of [
  ["data-operator-visitors","desktop and mobile badge keeps unique visitors"],
  ["data-operator-daily-opens","desktop and mobile badge keeps daily opens"],
  ["id=\"operatorMetrics\" class=\"operator-metrics\" hidden","desktop operator badge has a permanent mount"],
  ["id=\"mobileOperatorMetricsSlot\" class=\"mobile-operator-metrics-slot\" hidden","mobile has a permanent operator mount"],
  ["id=\"mobileOperatorMetrics\" class=\"operator-metrics\" hidden","mobile badge cannot be deleted by route redraw"],
  [".operator-metrics[hidden],.mobile-operator-metrics-slot[hidden]{display:none!important}","operator badges stay hidden for ordinary visitors"],
  [".mobile-operator-metrics-slot .operator-metrics","mobile badge has an explicit visible layout"],
  [".mobile-operator-metrics-slot[hidden]{display:none!important}","mobile mount is hidden for ordinary visitors"],
  ["if(!isOperator){desktopBadge.replaceChildren();mobileBadge.replaceChildren();return;}","ordinary visitors cannot retain operator counts"],
  ["operatorAccessRefreshTimer=window.setInterval(refreshOperatorAccess,90000)","operator access is periodically rechecked"],
  ["window.addEventListener('focus',()=>{if(memberState.user)refreshOperatorAccess();})","phone resume rechecks operator access"],
  ["if(memberState.user)refreshOperatorAccess();","network recovery rechecks operator access"],
  ["memberState.subscription?.access_source||''","operator access changes invalidate the render signature"],
  ["data-operator-account-visitors","operator page keeps unique visitors"],
  ["data-operator-account-daily-opens","operator page keeps daily opens"],
  [".operator-metrics-status.is-stale","stale values are visibly distinguished"],
  ["function trackAppEvent(){return Promise.resolve(false);}","retired funnel analytics stay disabled"],
  ["VISITOR_REGISTRATION_MAX_ATTEMPTS=5","visitor registration retry count is bounded"],
  ["recordAppOpen();","initial app opens are recorded"],
  ["p_event_id:APP_OPEN_EVENT_ID","open retries use one idempotent event id"]
])expect(index.includes(needle),label);

expect(!/data-operator-users|data-operator-account-users|registeredUsers/.test(index),"registration count cannot return to operator UI");
expect(!/syncMemberAppStateFromCloud|loadMemberAppState|saveMemberAppState/.test(index),"retired account cloud sync is absent");

const metricRenderer=section("function renderOperatorMetrics\\(\\)\\{","function stopOperatorMetricsRefresh");
expect(!metricRenderer.includes(".remove()"),"operator metric mount points are never deleted during redraws");

const authInit=section("async function initOperatorAuth\\(\\)\\{","async function loadPublishedReviews");
expect(authInit.includes("if(event==='INITIAL_SESSION'&&nextUserId===lastAuthUserId)return"),"only the duplicate initial session is skipped");
expect(authInit.indexOf("memberClient.auth.onAuthStateChange")<authInit.indexOf("await queueOperatorRefresh(data.session)"),"auth listener is installed before initial operator loading");
expect(workflow.includes("node scripts/test-runtime-resilience.mjs"),"scheduled updates run the stability regression test");

if(failures.length){console.error(failures.join("\n"));process.exit(1);}
console.log("Runtime resilience contract passed.");
