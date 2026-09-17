import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../assets/operator-insights.js',import.meta.url),'utf8');
const sample=period=>({version:1,timezone:'Asia/Tokyo',period,from:'2026-09-11',through:'2026-09-17',as_of:'2026-09-17T01:00:00Z',
  totals:{opens:25,unique_browsers:8},summary:{opens:12,unique_browsers:5,new_browsers:2,returning_browsers:3,unknown_opens:4},
  daily:[{day:'2026-09-17',opens:12,unique_browsers:5,new_browsers:2,returning_browsers:3,unknown_opens:4}],
  sources:[{source:'youtube',opens:12,unique_browsers:5}],hourly:Array.from({length:24},(_,hour)=>({hour,opens:hour===10?12:0}))});
const settle=()=>new Promise(r=>setImmediate(r));
function setup(){
  let allowed=true,result,blob,clicks=0;
  const timer=new Map();let id=0;
  const elements={select:{},'[data-reload]':{},'[data-export]':{}};
  const host={isConnected:true,innerHTML:'',replaceChildren(){this.innerHTML='';},querySelector:s=>elements[s]};
  const window={dispatchEvent(){}};
  const document={visibilityState:'visible',addEventListener(){},createElement:()=>({click(){clicks++;}})};
  vm.runInNewContext(source,{window,document,Event,Blob,URL:{createObjectURL:b=>{blob=b;return 'blob:test';},revokeObjectURL(){}},
    setInterval:fn=>{timer.set(++id,fn);return id;},clearInterval:i=>timer.delete(i),setTimeout:()=>1});
  const rpc=async(_name,p)=>result===undefined?{data:sample(p.p_period)}:typeof result==='function'?await result(p):result;
  return {host,elements,api:window.aiRadarInsights,timer,setAllowed:v=>allowed=v,setResult:v=>result=v,
    mount:()=>window.aiRadarInsights.mount(host,{rpc,isAllowed:()=>allowed}),blob:()=>blob,clicks:()=>clicks};
}
{
  const b=setup();b.setAllowed(false);b.mount();await settle();assert.equal(b.host.innerHTML,'');assert.equal(b.timer.size,0);
}
{
  const b=setup();b.mount();await settle();assert.match(b.host.innerHTML,/YouTube/);assert.match(b.host.innerHTML,/再訪/);
  b.elements['[data-export]'].onclick();assert.equal(b.clicks(),1);assert.match(await b.blob().text(),/時間帯/);
  b.setResult({error:{code:'PGRST202'}});b.elements['[data-reload]'].onclick();await settle();assert.match(b.host.innerHTML,/SQLが未適用/);
  b.setResult({error:{message:'offline'}});b.elements['[data-reload]'].onclick();await settle();assert.match(b.host.innerHTML,/前回確認値/);
  b.setAllowed(false);b.elements['[data-export]'].onclick();assert.equal(b.clicks(),1,'no export after permission loss');
  b.elements['[data-reload]'].onclick();await settle();assert.equal(b.host.innerHTML,'');assert.equal(b.timer.size,0);
}
{
  const b=setup();b.setResult({data:{...sample('7d'),summary:{opens:null}}});b.mount();await settle();
  assert.match(b.host.innerHTML,/0件とは表示せず/);assert.ok(!b.host.innerHTML.includes('YouTube'));
}
{
  const b=setup();let resolve;
  b.setResult(()=>new Promise(r=>resolve=r));b.mount();await settle();
  b.api.reset();resolve({data:sample('7d')});await settle();assert.equal(b.host.innerHTML,'','late response cannot restore logged-out data');
}
{
  const b=setup();let first;
  b.setResult(p=>p.p_period==='7d'?new Promise(r=>first=r):Promise.resolve({data:sample(p.p_period)}));b.mount();await settle();
  b.elements.select.onchange({target:{value:'today'}});await settle();first({data:sample('7d')});await settle();
  assert.match(b.host.innerHTML,/<option value="today" selected>/);
  b.elements['[data-export]'].onclick();assert.match(await b.blob().text(),/"期間合計","today"/);
}
console.log('Insights UI passed: private mount/export, SQL missing, offline stale values, malformed data, logout and stale-range races.');
