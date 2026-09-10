import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const read=file=>fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
const html=read('index.html');
const tracker=read('assets/visitor-tracker.js');
const policy=source=>source.match(/function isPublicReaderVisit\(\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(policy(html));
assert.equal(policy(html),policy(tracker),'shell and direct articles must share the exclusion policy');
const shell=html.slice(html.indexOf('function isPublicReaderVisit(){'),html.indexOf('function trackAppEvent(){'));
const operatorKey='ai_radar_verified_operator_v1';
const sessionKey='sb-ncosmmesecpqhzfikpmn-auth-token';
const registeredKey='ai_radar_unique_visitor_registered_v1';
const location={hostname:'reiki-ai-apps.github.io',pathname:'/AI-/',hash:''};

function context(options={}){
  const storage=new Map(Object.entries(options.storage||{}));
  const calls=[];
  const localStorage={
    getItem(key){if(options.storageBlocked)throw Error('storage unavailable');return storage.get(key)||null;},
    setItem(key,value){storage.set(key,value);}
  };
  const memberClient={rpc:async(name)=>{calls.push(name);return {error:null};}};
  return {calls,storage,localStorage,crypto:webcrypto,TextEncoder,Uint8Array,
    location:{...location,...options.location},memberState:{user:options.user||null},
    memberClient,ensureMemberClient:()=>memberClient,
    publicReviewerHash:options.hash||(()=>Promise.resolve('a'.repeat(64))),
    window:{setTimeout(){throw Error('unexpected retry');},clearTimeout(){}},
    fetch:async url=>{calls.push(url.split('/').at(-1));return {ok:true};}
  };
}

for(const [label,options,expected] of [
  ['ordinary reader',{},2],
  ['returning reader',{storage:{[registeredKey]:'1'}},1],
  ['verified owner after logout',{storage:{[operatorKey]:JSON.stringify({userId:'owner',isOperator:true})}},0],
  ['owner session restoring before SDK loads',{storage:{[sessionKey]:JSON.stringify({user:{id:'owner'},expires_at:1})}},0],
  ['unknown or expired auth session',{storage:{[sessionKey]:'unreadable-session'}},0],
  ['unreadable operator state',{storage:{[operatorKey]:'broken-json'}},0],
  ['blocked storage',{storageBlocked:true},0],
  ['operator sign-in page',{location:{hash:'#operator'}},0],
  ['local preview',{location:{hostname:'localhost'}},0],
  ['other project preview',{location:{pathname:'/preview/'}},0],
  ['non-operator cache',{storage:{[operatorKey]:JSON.stringify({isOperator:false})}},2],
]){
  for(const mode of ['shell','article']){
    const ctx=context(options);
    const code=mode==='shell'
      ?`${shell}\nPromise.all([registerUniqueVisitor(),recordAppOpen()]);`
      :tracker.replace('  Promise.allSettled([register(),recordOpen()]);','  return Promise.allSettled([register(),recordOpen()]);');
    await vm.runInNewContext(code,ctx);
    assert.equal(ctx.calls.length,expected,`${mode}: ${label}`);
    if(expected===2)assert.deepEqual(ctx.calls.sort(),['record_app_open','register_unique_visitor']);
    if(!expected)assert.equal(ctx.storage.get(registeredKey),undefined,'excluded owner must not be marked as registered');
  }
}

const signedIn=context({user:{id:'owner'}});
await vm.runInNewContext(`${shell}\nPromise.all([registerUniqueVisitor(),recordAppOpen()]);`,signedIn);
assert.equal(signedIn.calls.length,0,'in-memory owner session is also excluded');

let finishHash;
const changing=context({hash:()=>new Promise(resolve=>{finishHash=resolve;})});
const pending=vm.runInNewContext(`${shell}\nregisterUniqueVisitor();`,changing);
changing.storage.set(sessionKey,'new-operator-session');
finishHash('a'.repeat(64));
await pending;
assert.equal(changing.calls.length,0,'login during hashing must not register owner');

const repeated=context();
await vm.runInNewContext(`${shell}\nPromise.all([recordAppOpen(),recordAppOpen()]).then(()=>recordAppOpen());`,repeated);
assert.deepEqual(repeated.calls,['record_app_open'],'one ordinary opening remains idempotent');
console.log('Operator analytics exclusion passed (shell, direct articles, startup, storage failures and retries).');
