import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const sw=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const syncState=html.slice(html.indexOf('let _syncDone='),html.indexOf('function looksCorruptedText'));
const syncCode=html.slice(html.indexOf('async function syncFromDataJson('),html.indexOf('/* ============================================================\n   Toast'));
assert.ok(syncCode.includes('async function performDataSync'), 'test executes production sync code');
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function harness(fetchImpl){
  const timers=new Map(),events={},status={style:{},innerHTML:''};
  let timerId=0,calls=0,renders=0,saves=0;
  const record={id:'existing',title:'old',home_top_rank:1,status:'read',memo:'keep',is_saved:true};
  const db={updates:[record]};
  const context=vm.createContext({
    console:{warn(){}},AbortController,Date,
    document:{visibilityState:'visible',getElementById:()=>status,addEventListener:(n,f)=>{events[n]=f;}},
    window:{setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId;},clearTimeout:id=>timers.delete(id),setInterval(){},addEventListener:(n,f)=>{events[n]=f;}},
    getSettings:()=>({autoFetch:true}),
    fetch:(...args)=>{calls++;return fetchImpl(...args);},
    setAutoStatus:on=>{status.innerHTML=on?'loading':'';},
    isCompletePublishedArticle:item=>Boolean(item?.title),looksCorruptedText:()=>false,isRecent:()=>true,
    DB:{load:()=>db,save:()=>saves++},ensureImportedTool:()=>({id:'tool'}),
    findCurrentArticle:()=>record,patchPublishedArticleFields:(target,item)=>{target.title=item.title;return true;},
    nowISO:()=>new Date().toISOString(),memberState:{ready:false},recomputeAll(){},toast(){},renderNav(){},render:()=>renders++,
  });
  vm.runInContext(syncState+syncCode,context);
  return {
    context,record,status,events,timers,
    get calls(){return calls;},get renders(){return renders;},get saves(){return saves;},
    run:code=>vm.runInContext(code,context),
    async fire(delay){const entry=[...timers].find(([,v])=>v.delay===delay);assert.ok(entry,`timer ${delay} exists`);timers.delete(entry[0]);entry[1].fn();await settle();}
  };
}
const good=()=>({ok:true,json:async()=>[{title:'latest',published_at:'2026-09-10T00:00:00Z'}]});
let attempts=0;
const transient=harness(async()=>++attempts===1?{ok:false,status:503}:good());
await transient.run('syncFromDataJson()');
assert.equal(transient.run('_syncDone'),false,'a failed request is not marked complete');
assert.equal(transient.record.title,'old','failure retains the previously readable article');
await transient.fire(1000);
assert.equal(transient.record.title,'latest','first request failure recovers in the same page');
assert.equal(transient.renders,1,'recovered articles render immediately');
assert.equal(transient.run('_syncDone'),true);
assert.equal(transient.record.status,'read');assert.equal(transient.record.memo,'keep');assert.equal(transient.record.is_saved,true);
assert.equal(transient.timers.size,0,'success clears deadline and retry timers');

const stuck=harness(async()=>({ok:true,json:()=>new Promise(()=>{})}));
const stuckResult=stuck.run('syncFromDataJson()');
await settle();await stuck.fire(8000);await stuckResult;
assert.equal(stuck.run('_syncDone'),false,'body stall is bounded even when headers arrived');
assert.equal(stuck.run('_syncPromise'),null,'body stall releases the in-flight lock');
assert.ok([...stuck.timers.values()].some(timer=>timer.delay===1000));

const broken=harness(async()=>({ok:true,json:async()=>{throw new SyntaxError('bad JSON');}}));
await broken.run('syncFromDataJson()');
assert.equal(broken.record.title,'old');
assert.equal(broken.run('_lastSyncAt'),0,'invalid JSON does not postpone recovery for five minutes');
await broken.fire(1000);await broken.fire(3000);await broken.fire(10000);
assert.equal(broken.calls,4,'retries are bounded to three after the initial request');
assert.match(broken.status.innerHTML,/再取得/,'offline failure leaves an in-page retry action');
assert.equal(broken.timers.size,0);

let release;
const concurrent=harness(()=>new Promise(resolve=>{release=resolve;}));
const first=concurrent.run('syncFromDataJson()');
const second=concurrent.run('syncFromDataJson(true)');
assert.equal(concurrent.calls,1,'resume and controller changes share one pending request');
release(good());await Promise.all([first,second]);
assert.equal(concurrent.renders,1);

const workerEvents={},deleted=[],puts=[];
const previousData={tag:'saved feed'};
vm.runInNewContext(sw,{
  self:{addEventListener:(n,f)=>{workerEvents[n]=f;},clients:{claim:async()=>{}},skipWaiting(){}},
  caches:{keys:async()=>['ai-radar-old','unrelated-cache'],match:async()=>previousData,
    open:async()=>({match:async()=>undefined,put:async(key,value)=>puts.push([key,value])}),
    delete:async key=>deleted.push(key)},
});
let activation;
workerEvents.activate({waitUntil:promise=>{activation=promise;}});await activation;
assert.deepEqual(deleted,['ai-radar-old'],'activation preserves other applications caches');
assert.deepEqual(puts,[['./data.json',previousData]],'cached articles survive worker replacement');
assert.ok(!/client\.navigate\(/.test(sw),'worker never navigates away during first-open sync');
const pwa=html.slice(html.indexOf('function setupPWA(){'),html.indexOf('function dismissBootScreen(){'));
assert.ok(!pwa.includes('window.location.reload()'),'controller changes never reload the running app');
assert.match(html,/initial render failed; continuing news sync/,'initial render failure cannot skip background sync');
const migrationContext=vm.createContext({
  INFORMATION_PRESETS:[{name:'New AI tool',query:'new AI',kind:'AI',priority:'B',category:'研究・技術'}],
  uid:()=> 'new-id',slugify:name=>name,nowISO:()=> '2026-09-10T00:00:00Z',googleNewsRss:query=>query,
});
vm.runInContext(html.slice(html.indexOf('function createToolRecord('),html.indexOf('function seedData('))+
  html.slice(html.indexOf('const MIGRATIONS = ['),html.indexOf('function removeNearDuplicateStories(')),migrationContext);
for(const migrationId of ['2026-08-01-major-ai-tool-presets','2026-08-01-major-ai-tool-presets-v2']){
  const migrated=vm.runInContext(`(()=>{const d={tools:[]};MIGRATIONS.find(m=>m.id==='${migrationId}').apply(d);return d;})()`,migrationContext);
  assert.equal(migrated.tools[0].name,'New AI tool','legacy startup creates missing tools without an out-of-scope variable');
  assert.equal(migrated.tools[0].id,'new-id');
}
console.log('First-open recovery passed: transient HTTP failure, stalled body, invalid JSON, bounded retries, concurrency, cache activation.');
