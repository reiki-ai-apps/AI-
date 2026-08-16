import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const index=fs.readFileSync(path.join(root,"index.html"),"utf8");
const workflow=fs.readFileSync(path.join(root,".github","workflows","update.yml"),"utf8");
const failures=[];
const expect=(condition,label)=>{if(!condition)failures.push(label);};
const section=(start,end)=>{
  const match=index.match(new RegExp(`${start}[\\s\\S]*?${end}`));
  return match?.[0]||"";
};

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
  const validOperatorMetrics=Function(`${source}; return validOperatorMetrics;`)();
  expect(validOperatorMetrics({registered_users:12,unique_visitors:34})?.registeredUsers===12,"legacy production metrics response remains supported");
  expect(validOperatorMetrics({registered_users:12,unique_visitors:34})?.funnel7d===null,"missing optional funnel does not hide counts");
  expect(validOperatorMetrics({registered_users:"bad",unique_visitors:34})===null,"invalid metrics are rejected");
}

const memberRefresh=section("async function refreshMemberState\\(session\\)\\{","function queueMemberRefresh");
for(const [needle,label] of [
  ["const previousSubscription=sameUser?memberState.subscription:cachedMembershipForUser(nextUserId)","same-account operator grant survives auth refresh"],
  ["const previousMetrics=sameUser?memberState.operatorMetrics:null","same-account verified counts survive auth refresh"],
  ["await Promise.allSettled([","membership, cloud sync, and reviews are failure-isolated"],
  ["cacheMembershipForUser(memberState.user.id,membership.value)","verified membership is cached per authenticated account"]
])expect(memberRefresh.includes(needle),label);

const metricsRefresh=section("async function refreshOperatorMetrics\\(\\)\\{","function startOperatorMetricsRefresh");
for(const [needle,label] of [
  ["for(const delay of [0,700,1800])","operator metrics use bounded retries"],
  ["memberState.operatorMetricsStatus=memberState.operatorMetrics?'stale':'error'","temporary failure preserves the last verified counts"],
  ["memberState.operatorMetricsUpdatedAt=new Date().toISOString()","successful refresh records its verification time"]
])expect(metricsRefresh.includes(needle),label);
expect(!/catch\(error\)\{[\s\S]*?memberState\.operatorMetrics=null/.test(metricsRefresh),"metrics catch path never deletes verified counts");
if(metricsRefresh){
  const source=metricsRefresh.replace(/function startOperatorMetricsRefresh[\s\S]*$/,'');
  const buildRefresh=Function("memberState","memberClient","loadOperatorMetrics","waitMs","renderOperatorMetrics","stopOperatorMetricsRefresh",`let operatorMetricsRefreshInFlight=null;${source};return refreshOperatorMetrics;`);
  const verified={registeredUsers:12,uniqueVisitors:34,funnel7d:null};
  const verifiedAt="2026-08-15T00:00:00.000Z";
  const state={user:{id:"operator"},subscription:{access_source:"operator_grant"},operatorMetrics:verified,operatorMetricsStatus:"live",operatorMetricsUpdatedAt:verifiedAt,operatorMetricsError:""};
  const refresh=buildRefresh(state,{},async()=>{throw new Error("temporary network failure");},async()=>{},()=>{},()=>{});
  await refresh();
  expect(state.operatorMetrics===verified,"a real failed refresh keeps the previous metric object");
  expect(state.operatorMetricsStatus==="stale","a real failed refresh marks preserved counts as stale");
  expect(state.operatorMetricsUpdatedAt===verifiedAt,"a real failed refresh keeps the last verification time");
}

for(const [needle,label] of [
  ["data-operator-visitors","desktop and mobile operator badge keeps the visitor count"],
  ["data-operator-users","desktop and mobile operator badge keeps the registration count"],
  ["id=\"mobileOperatorMetricsSlot\"","mobile has a dedicated operator metrics mount point"],
  ["mobileBadge.id='mobileOperatorMetrics'","mobile receives its own rendered operator badge"],
  [".mobile-operator-metrics-slot .operator-metrics","mobile badge has an explicit visible layout"],
  ["data-operator-account-visitors","account page keeps the visitor count"],
  ["data-operator-account-users","account page keeps the registration count"],
  [".operator-metrics-status.is-stale","stale values are visibly distinguished from live values"],
  ["const GROWTH_RPC_MISSING_BACKOFF_MS=6*60*60*1000","missing analytics RPC is circuit-broken instead of retried continuously"],
  ["VISITOR_REGISTRATION_MAX_ATTEMPTS=5","visitor registration retry count is bounded"],
  ["catch(()=>{setCloudSyncStatus('error');return false;})","cloud polling cannot reject without a handler"]
])expect(index.includes(needle),label);

const authInit=section("async function initMemberAuth\\(\\)\\{","async function loadPublishedReviews");
expect(authInit.includes("if(event==='INITIAL_SESSION'&&nextUserId===lastAuthUserId)return"),"only the duplicate initial session is skipped");
expect(!authInit.includes("event==='TOKEN_REFRESHED')&&nextUserId===lastAuthUserId"),"phone token refresh is never skipped");
expect(authInit.indexOf("memberClient.auth.onAuthStateChange")<authInit.indexOf("await queueMemberRefresh(data.session)"),"auth listener is installed before slow initial account loading");

expect(workflow.includes("node scripts/test-runtime-resilience.mjs"),"scheduled news updates run the stability regression test");

if(failures.length){
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Runtime resilience contract passed.");
