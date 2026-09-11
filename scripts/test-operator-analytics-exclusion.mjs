import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const tracker=read('assets/visitor-tracker.js');
const html=read('index.html');
const operatorKey='ai_radar_verified_operator_v1';
const excludedKey='ai_radar_exclude_operator_browser_v1';
const sessionKey='sb-ncosmmesecpqhzfikpmn-auth-token';
const registeredKey='ai_radar_unique_visitor_registered_v1';
const prefix='ai_radar_pending_open_v2:';
assert.equal((html.match(/id="visitorTracker"/g)||[]).length,1);
assert.ok(html.includes('defer src="./assets/visitor-tracker.js"'));
assert.ok(!html.includes('APP_OPEN_EVENT_ID'),'shell must not have a second counting engine');

function browser(options={}){
  const storage=options.storage instanceof Map?options.storage:new Map(Object.entries(options.storage||{}));
  const calls=[],timers=new Map(),listeners={window:{},document:{}};
  const opens=options.opens||new Set(),uniques=options.uniques||new Set();
  let serial=0;
  const localStorage={
    get length(){return storage.size;},
    key(i){return [...storage.keys()][i];},
    getItem(k){if(options.blocked)throw Error('storage blocked');return storage.get(k)||null;},
    setItem(k,v){if(options.blocked)throw Error('storage blocked');storage.set(k,v);},
    removeItem(k){if(options.blocked)throw Error('storage blocked');storage.delete(k);}
  };
  const listen=surface=>(name,fn)=>(listeners[surface][name]??=[]).push(fn);
  const setTimeout=(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;};
  const clearTimeout=id=>timers.delete(id);
  const document={visibilityState:options.hidden?'hidden':'visible',addEventListener:listen('document')};
  const window={addEventListener:listen('window')};
  const ctx={window,document,localStorage,crypto:webcrypto,TextEncoder,Uint8Array,AbortController,
    setTimeout,clearTimeout,location:{hostname:'reiki-ai-apps.github.io',pathname:'/AI-/',hash:'',...options.location},
    fetch:async(url,request)=>{
      const name=url.split('/').at(-1),body=JSON.parse(request.body);
      calls.push({name,body});
      if(options.respond){const result=await options.respond(name,body);if(result!==undefined)return result;}
      if(name==='record_app_open')opens.add(body.p_event_id);
      if(name==='register_unique_visitor')uniques.add(body.p_visitor_key_hash);
      return {ok:true,json:async()=>name==='get_my_membership'?{access_source:'none'}:true};
    }
  };
  vm.runInNewContext(tracker,ctx);
  const settle=async()=>{
    // crypto.subtle completes on a real worker; flush also waits for the in-flight attempt.
    await window.aiRadarAnalytics.flush();
    await new Promise(resolve=>setImmediate(resolve));
  };
  const emit=(surface,name,event={})=>{for(const fn of listeners[surface][name]||[])fn(event);};
  const visible=async value=>{document.visibilityState=value?'visible':'hidden';emit('document','visibilitychange');await settle();};
  const fire=async ms=>{
    const selected=[...timers].filter(([,t])=>t.ms===ms);
    assert.ok(selected.length,'expected timer '+ms);
    for(const [id,t] of selected){timers.delete(id);t.fn();}
    await settle();
  };
  return {options,storage,calls,timers,opens,uniques,ctx,settle,emit,visible,fire,
    queue:()=>[...storage.keys()].filter(k=>k.startsWith(prefix))};
}

for(const [label,options,expected] of [
  ['reader',{},1],
  ['returning reader',{storage:{[registeredKey]:'1'}},1],
  ['expired former account',{storage:{[sessionKey]:JSON.stringify({user:{id:'old'},access_token:'expired',expires_at:1})}},1],
  ['malformed former session',{storage:{[sessionKey]:'broken'}},1],
  ['non-operator session',{storage:{[sessionKey]:JSON.stringify({user:{id:'reader'},access_token:'reader-token'})}},1],
  ['known owner',{storage:{[operatorKey]:JSON.stringify({userId:'owner',isOperator:true})}},0],
  ['owner after logout',{storage:{[excludedKey]:'1'}},0],
  ['operator entry',{location:{hash:'#operator'}},0],
  ['preview',{location:{hostname:'localhost'}},0],
  ['another project',{location:{pathname:'/other/'}},0],
  ['blocked storage',{blocked:true},1],
]){
  const b=browser(options);await b.settle();
  assert.equal(b.opens.size,expected,label);
  if(label==='reader')assert.equal(b.uniques.size,1);
  if(label==='returning reader'||label==='blocked storage')assert.equal(b.uniques.size,0);
  if(!expected)assert.equal(b.calls.length,0,label+' must not send analytics');
}
{
  const b=browser();await b.settle();
  b.emit('window','pageshow');b.emit('window','focus');
  await Promise.all([b.settle(),b.settle()]);
  assert.equal(b.opens.size,1,'pageshow/focus/flush must not duplicate initial opening');
  await b.visible(false);await b.visible(true);
  b.emit('window','pageshow');await b.settle();
  assert.equal(b.opens.size,2,'PWA resume counts exactly once');
  b.emit('window','pagehide');b.emit('window','pageshow');await b.settle();
  assert.equal(b.opens.size,3,'BFCache restore counts once');
  assert.equal(b.uniques.size,1,'repeat openings never add another unique browser');
  assert.equal(b.queue().length,0);
  vm.runInNewContext(tracker,b.ctx);await b.settle();
  assert.equal(b.opens.size,3,'duplicate script injection must not install another engine');
}
{
  const b=browser({hidden:true});await b.settle();
  assert.equal(b.opens.size,0,'background loaded pages are not yet openings');
  await b.visible(true);assert.equal(b.opens.size,1);
}
{
  const saved=new Map(),opens=new Set();
  const b=browser({storage:saved,opens,respond:async()=>{throw Error('offline');}});
  await b.settle();assert.equal(b.queue().length,1);
  const first=JSON.parse(saved.get(b.queue()[0])).id;
  const restored=browser({storage:saved,opens});await restored.settle();
  assert.equal(opens.size,2,'failed opening survives reload alongside new opening');
  assert.ok(opens.has(first),'retry retains original event UUID');
  assert.equal(restored.queue().length,0);
}
{
  const opens=new Set();let fail=true;
  const b=browser({opens,respond:async(name,body)=>{
    if(name==='record_app_open'&&fail){opens.add(body.p_event_id);throw Error('acknowledgement lost');}
  }});
  await b.settle();assert.equal(b.queue().length,1);fail=false;
  await b.fire(4000);
  assert.equal(opens.size,1,'server commit followed by retry cannot double count');
  const ids=b.calls.filter(c=>c.name==='record_app_open').map(c=>c.body.p_event_id);
  assert.equal(new Set(ids).size,1);
}
{
  let fail=true;
  const b=browser({respond:async name=>{if(name==='register_unique_visitor'&&fail)throw Error('unique failure');}});
  await b.settle();assert.equal(b.opens.size,1,'unique failure does not block daily open');
  fail=false;await b.fire(4000);assert.equal(b.uniques.size,1);assert.equal(b.opens.size,1);
}
{
  let fail=true;
  const b=browser({respond:async name=>name==='record_app_open'&&fail?{ok:true,json:async()=>false}:undefined});
  await b.settle();assert.equal(b.queue().length,1,'false acknowledgement retains pending event');
  fail=false;b.emit('window','online');await b.settle();assert.equal(b.opens.size,1);
}
{
  const b=browser({storage:{[registeredKey]:'1'},respond:async()=>({ok:true,json:()=>new Promise(()=>{})})});
  // Wait for fetch headers; the body stalls forever.
  await new Promise(resolve=>setImmediate(resolve));
  await b.fire(8000);
  assert.equal(b.queue().length,1,'body timeout retains the event and releases in-flight lock');
  b.options.respond=null;await b.fire(4000);assert.equal(b.opens.size,1);
}
{
  const storage=new Map([[sessionKey,JSON.stringify({user:{id:'owner'},access_token:'owner-token'})]]);
  const b=browser({storage,respond:async name=>name==='get_my_membership'?{ok:true,json:async()=>({access_source:'operator_grant'})}:undefined});
  await b.settle();assert.equal(b.opens.size,0);assert.equal(b.uniques.size,0);
  assert.equal(storage.get(excludedKey),'1');assert.equal(b.queue().length,0);
  storage.delete(sessionKey);storage.delete(operatorKey);
  const after=browser({storage});await after.settle();assert.equal(after.calls.length,0,'logout preserves owner exclusion');
}
{
  let fail=true;
  const b=browser({storage:{[sessionKey]:JSON.stringify({user:{id:'reader'},access_token:'token'})},
    respond:async name=>{if(name==='get_my_membership'&&fail)throw Error('identity lookup offline');}});
  await b.settle();assert.equal(b.opens.size,0,'uncertain active account waits for verification');
  fail=false;await b.fire(4000);assert.equal(b.opens.size,1);
}
console.log('Shared analytics passed: PWA/BFCache reopens, idempotent durable retries, timeout, legacy readers, owner exclusion and blocked storage.');
