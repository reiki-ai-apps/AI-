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
  ["applyResolvedMembership(membership.value,previousSubscription)","membership result is applied through the verified entitlement guard"]
])expect(memberRefresh.includes(needle),label);

const membershipGuard=section("const membershipResolution=","function cachedMembershipForUser").replace(/function cachedMembershipForUser[\s\S]*$/,'');
expect(Boolean(membershipGuard),"verified membership guard exists");
if(membershipGuard){
  const guardState={user:{id:"operator"},subscription:{plan:"premium",status:"active",access_source:"operator_grant"}};
  const cached=[];
  const buildGuard=Function("memberState","cacheMembershipForUser",`${membershipGuard};return {membershipResolution,applyResolvedMembership};`);
  const guard=buildGuard(guardState,(userId,membership)=>cached.push({userId,membership}));
  guard.applyResolvedMembership(guard.membershipResolution({plan:"free",status:"inactive",access_source:"account"},false),guardState.subscription);
  expect(guardState.subscription.access_source==="operator_grant","an unverified mobile fallback cannot remove operator access");
  guard.applyResolvedMembership(guard.membershipResolution({plan:"free",status:"inactive",access_source:"account"},true),guardState.subscription);
  expect(guardState.subscription.access_source==="account","a server-verified revocation still removes operator access");
  expect(cached.length===1,"only a server-verified membership is cached");
}

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
  ["id=\"operatorMetrics\" class=\"operator-metrics\" hidden","desktop operator badge has a permanent mount point"],
  ["id=\"mobileOperatorMetricsSlot\" class=\"mobile-operator-metrics-slot\" hidden","mobile has a permanent operator metrics mount point"],
  ["id=\"mobileOperatorMetrics\" class=\"operator-metrics\" hidden","mobile badge cannot be deleted by a route redraw"],
  [".mobile-operator-metrics-slot .operator-metrics","mobile badge has an explicit visible layout"],
  [".mobile-operator-metrics-slot[hidden]{display:none!important}","mobile mount is hidden safely for ordinary accounts"],
  ["if(!isOperator){desktopBadge.replaceChildren();mobileBadge.replaceChildren();return;}","ordinary accounts cannot retain operator counts in the DOM"],
  ["membershipAccessRefreshTimer=window.setInterval(refreshMembershipAccess,90000)","account entitlement is rechecked while the app remains open"],
  ["window.addEventListener('focus',()=>{if(memberState.user)refreshMembershipAccess();})","phone resume rechecks operator entitlement"],
  ["effectivePlanKey(),memberState.subscription?.access_source||''","operator entitlement changes invalidate the account render signature"],
  ["data-operator-account-visitors","account page keeps the visitor count"],
  ["data-operator-account-users","account page keeps the registration count"],
  [".operator-metrics-status.is-stale","stale values are visibly distinguished from live values"],
  ["const GROWTH_RPC_MISSING_BACKOFF_MS=6*60*60*1000","missing analytics RPC is circuit-broken instead of retried continuously"],
  ["VISITOR_REGISTRATION_MAX_ATTEMPTS=5","visitor registration retry count is bounded"],
  ["UNIQUE_VISITOR_REGISTERED_KEY='ai_radar_unique_visitor_registered_v1'","app and public articles share the unique-visitor completion marker"],
  ["if(hasRegisteredUniqueVisitor()){visitorRegistrationComplete=true;return;}","a previously registered browser avoids duplicate visitor writes"],
  ["markUniqueVisitorRegistered();","successful visitor registration is persisted"],
  ["catch(()=>{setCloudSyncStatus('error');return false;})","cloud polling cannot reject without a handler"]
])expect(index.includes(needle),label);

const metricRenderer=section("function renderOperatorMetrics\\(\\)\\{","function stopOperatorMetricsRefresh");
expect(!metricRenderer.includes(".remove()"),"operator metric mount points are never deleted during redraws");

const publicVisitorTracker=fs.readFileSync(path.join(root,"assets","visitor-tracker.js"),"utf8");
for(const [needle,label] of [
  ["ai_radar_public_reviewer_v1","public article uses the same anonymous browser key"],
  ["ai_radar_unique_visitor_registered_v1","public article persists completed registration"],
  ["/rpc/register_unique_visitor","public article calls the unique visitor RPC"],
  ["if(response.ok)saveValue(REGISTERED_KEY,\"1\");","public article marks completion only after a successful RPC"],
  ["article URL","public article tracker does not send article URL"]
])expect(publicVisitorTracker.includes(needle),label);

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
