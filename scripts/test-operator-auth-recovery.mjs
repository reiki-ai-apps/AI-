import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const code=html.slice(html.indexOf('function scheduleOperatorAuthRetry(){'),html.indexOf('async function loadPublishedReviews(){'));
const timers=new Map(),listeners={},sdkListeners={};
let nextTimer=0,hasSdk=false,sessionFails=true,authListeners=0,refreshes=0;
const session={user:{id:'owner'}};
const client={auth:{
  onAuthStateChange(){authListeners++;},
  async getSession(){if(sessionFails)throw new Error('temporary network failure');return {data:{session},error:null};}
}};
const ctx=vm.createContext({
  console:{warn(){}},memberState:{ready:false,user:null,recovery:false},memberClient:null,
  operatorAuthInitInFlight:null,operatorAuthListenerAttached:false,operatorAuthRetryTimer:null,lastAuthUserId:'',
  restoreOperatorSnapshot(){},waitForSupabaseSdk:async()=>{},ensureMemberClient(){if(hasSdk)ctx.memberClient=client;},
  loadPublishedReviews:async()=>{},loadReviewStatus:async()=>{},
  queueOperatorRefresh:async restored=>{assert.equal(restored,session);refreshes++;ctx.memberState.user=restored.user;},
  knownOperatorBrowser:()=>true,go(){},
  requestIdleCallback(){},
  document:{getElementById:()=>({addEventListener:(name,handler)=>{sdkListeners[name]=handler;}})},
  window:{setTimeout:(handler,delay)=>{timers.set(++nextTimer,{handler,delay});return nextTimer;},
    clearTimeout:id=>timers.delete(id),addEventListener:(name,handler)=>{listeners[name]=handler;}}
});
vm.runInContext(code,ctx);
await ctx.initOperatorAuth();
assert.equal(ctx.memberState.ready,true,'missing CDN cannot block the page');
assert.equal(authListeners,0);
assert.ok([...timers.values()].some(timer=>timer.delay===3000),'missing SDK schedules recovery');
hasSdk=true;
sdkListeners.load();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(authListeners,1,'late SDK creates one auth listener');
assert.equal(refreshes,0,'temporary session failure is not treated as logout');
assert.ok([...timers.values()].some(timer=>timer.delay===3000),'session failure schedules recovery');
sessionFails=false;
const retry=[...timers].find(([,timer])=>timer.delay===3000);
timers.delete(retry[0]);retry[1].handler();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(refreshes,1,'existing stored session restores without another login');
assert.equal(ctx.memberState.user.id,'owner');
listeners.online();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(authListeners,1,'retries never duplicate auth event listeners');
assert.equal(refreshes,2,'online retry checks the existing session');
console.log('Operator auth recovery passed: late SDK, transient session failure, automatic restoration, single listener.');

{
  const sdkCode=html.slice(html.indexOf('let supabaseFallbackStarted=false;'),html.indexOf('const memberState='));
  const sdkTimers=new Map(),sdkEvents={},primaryEvents={},fallbackEvents={};
  let timerId=0,appended=null,resolved=false;
  const sdkContext=vm.createContext({
    Event:class{constructor(type){this.type=type;}},
    document:{getElementById:()=>({addEventListener:(name,fn)=>{primaryEvents[name]=fn;}}),
      createElement:()=>({addEventListener:(name,fn)=>{fallbackEvents[name]=fn;}}),
      head:{appendChild:script=>{appended=script;}}},
    window:{supabase:null,addEventListener:(name,fn)=>{sdkEvents[name]=fn;},
      dispatchEvent:event=>sdkEvents[event.type]?.(),
      setTimeout:(fn,delay)=>{sdkTimers.set(++timerId,{fn,delay});return timerId;}}
  });
  vm.runInContext(sdkCode,sdkContext);
  const pending=sdkContext.waitForSupabaseSdk().then(()=>{resolved=true;});
  const fallbackTimer=[...sdkTimers.values()].find(timer=>timer.delay===2500);
  fallbackTimer.fn();
  assert.match(appended.src,/unpkg\.com\/@supabase\/supabase-js@2\.100\.0\/dist\/umd\/supabase\.js/);
  sdkContext.window.supabase={createClient(){}};
  fallbackEvents.load();
  await pending;
  assert.equal(resolved,true,'second CDN restores auth SDK without closing the app');
  primaryEvents.error?.();
  assert.equal(appended.src.includes('unpkg.com'),true,'an error cannot start duplicate downloads');
}
