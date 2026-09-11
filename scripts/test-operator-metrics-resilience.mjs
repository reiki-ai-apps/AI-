import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end));
const code=section('async function operatorRpc(name){','function updateOperatorMetricsBadge(');
const refresh=section('async function refreshOperatorMetrics(){','function startOperatorMetricsRefresh(){');
const cacheKey='ai_radar_operator_metrics_snapshot_v1';
function setup(){
  let now=Date.parse('2026-09-11T14:59:59Z'),id=0;
  class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const timers=new Map(),storage=new Map();
  const state={user:{id:'owner'},subscription:{access_source:'operator_grant'},operatorMetrics:null,operatorMetricsStatus:'idle'};
  const ctx={Date:Clock,memberState:state,
    memberClient:{rpc:async()=>({data:{unique_visitors:97,daily_opens:12,daily_opens_date:'2026-09-11'},error:null})},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    cachedOperatorAccessForUser:userId=>userId==='owner'?{access_source:'operator_grant'}:null,
    window:{setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)},
    renderOperatorMetrics(){},stopOperatorMetricsRefresh(){},waitMs:async()=>{},
    operatorMetricsRefreshInFlight:null
  };
  vm.createContext(ctx);vm.runInContext(code+'\n'+refresh,ctx);
  return {ctx,state,timers,storage,setTime:value=>{now=Date.parse(value);}};
}
{
  const {ctx}=setup();
  for(const value of [null,undefined,'',false,true,-1,1.5,'bad',Infinity]){
    assert.equal(ctx.validOperatorMetrics({unique_visitors:value,daily_opens:0}),null,'invalid unique must not become 0');
  }
  for(const value of ['',false,true,-1,1.5,'bad',Infinity]){
    assert.equal(ctx.validOperatorMetrics({unique_visitors:97,daily_opens:value}),null,'invalid daily must not become 0');
  }
  assert.equal(ctx.validOperatorMetrics({unique_visitors:97}).dailyOpens,null,'missing daily is unknown, not zero');
  assert.equal(ctx.validOperatorMetrics({unique_visitors:'97',daily_opens:'0'}).dailyOpens,0,'verified zero remains valid');
}
{
  const b=setup();await b.ctx.refreshOperatorMetrics();
  assert.equal(b.state.operatorMetrics.dailyOpens,12);
  assert.equal(b.state.operatorMetricsStatus,'live');
  assert.ok(b.storage.has(cacheKey),'successful values persist for reload');
  assert.equal(b.ctx.cachedOperatorMetrics('owner').metrics.uniqueVisitors,97);
  assert.equal(b.ctx.cachedOperatorMetrics('other'),null,'another account cannot restore owner snapshot');
  b.setTime('2026-09-11T15:00:00Z');
  assert.equal(b.ctx.displayedOperatorMetrics().dailyOpens,null,'yesterday daily count cannot appear as today');
  assert.equal(b.ctx.displayedOperatorMetrics().uniqueVisitors,97,'cumulative total survives midnight');
  assert.match(b.ctx.operatorMetricsTimeLabel(b.state.operatorMetricsUpdatedAt),/9\/11/,'older verification includes date');
  b.ctx.memberClient.rpc=async()=>{throw Error('network failed');};
  await b.ctx.refreshOperatorMetrics();
  assert.equal(b.state.operatorMetricsStatus,'stale');
  assert.equal(b.state.operatorMetrics.uniqueVisitors,97,'failure preserves last verified total');
  assert.equal(b.ctx.operatorMetricsRefreshInFlight,null,'failure releases lock');
  b.ctx.memberClient.rpc=async()=>({data:{unique_visitors:98,daily_opens:1,daily_opens_date:'2026-09-12'}});
  await b.ctx.refreshOperatorMetrics();
  assert.equal(b.ctx.displayedOperatorMetrics().dailyOpens,1,'next day data recovers normally');
  assert.equal(b.state.operatorMetrics.uniqueVisitors,98);
}
{
  const b=setup();b.ctx.memberClient.rpc=()=>new Promise(()=>{});
  const pending=b.ctx.refreshOperatorMetrics();
  for(let attempt=0;attempt<3;attempt++){
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(b.timers.size,1);
    for(const [id,t] of b.timers){assert.equal(t.ms,8000);b.timers.delete(id);t.fn();}
  }
  await pending;
  assert.equal(b.ctx.operatorMetricsRefreshInFlight,null,'hung requests time out and release refresh lock');
  assert.equal(b.state.operatorMetricsStatus,'error','no successful value is an error, not 0');
  assert.equal(b.state.operatorMetrics,null);
}
{
  const b=setup();let finish;
  b.ctx.memberClient.rpc=()=>new Promise(resolve=>{finish=resolve;});
  const pending=b.ctx.refreshOperatorMetrics();
  b.state.user={id:'other'};b.state.subscription=null;
  finish({data:{unique_visitors:97,daily_opens:12}});
  await pending;
  assert.equal(b.state.operatorMetrics,null,'in-flight owner response is discarded after account change');
  assert.equal(b.storage.size,0);
}
{
  const b=setup();await b.ctx.refreshOperatorMetrics();
  b.storage.set('sb-ncosmmesecpqhzfikpmn-auth-token',JSON.stringify({user:{id:'owner'}}));
  b.state.user=null;b.state.subscription=null;b.state.operatorMetrics=null;
  vm.runInContext(section('function restoreOperatorSnapshot(){','async function initOperatorAuth(){'),b.ctx);
  b.ctx.memberClient=null;
  b.ctx.restoreOperatorSnapshot();
  assert.equal(b.state.operatorMetrics.uniqueVisitors,97,'verified snapshot displays without waiting for SDK or network');
  assert.equal(b.state.operatorMetricsStatus,'stale','restored values never pretend to be live');
  b.state.user=null;b.state.subscription=null;b.state.operatorMetrics=null;
  b.storage.delete('sb-ncosmmesecpqhzfikpmn-auth-token');
  b.ctx.restoreOperatorSnapshot();
  assert.equal(b.state.operatorMetrics,null,'no session means no operator display');
}
console.log('Operator metrics passed: strict zero validation, Japan midnight, cached values, account isolation, failed and stalled requests, SDK-independent restoration.');
