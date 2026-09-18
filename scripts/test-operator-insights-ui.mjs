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
  let allowed=true,result,blob,clicks=0,copied='',copyFails=false;
  const timer=new Map();let id=0;
  const copyButtons=[{dataset:{copyUrl:'https://reiki-ai-apps.github.io/AI-/?utm_source=x&utm_medium=social'}}];
  const elements={select:{},'[data-reload]':{},'[data-export]':{},'.insights-copy-state':{isConnected:true,textContent:''}};
  const host={isConnected:true,innerHTML:'',replaceChildren(){this.innerHTML='';},querySelector:s=>elements[s],querySelectorAll:()=>copyButtons};
  const window={dispatchEvent(){}};
  const document={visibilityState:'visible',addEventListener(){},createElement:()=>({click(){clicks++;}})};
  vm.runInNewContext(source,{window,document,Event,Blob,URL:{createObjectURL:b=>{blob=b;return 'blob:test';},revokeObjectURL(){}},
    navigator:{clipboard:{writeText:async value=>{if(copyFails)throw Error('clipboard unavailable');copied=value;}}},
    setInterval:fn=>{timer.set(++id,fn);return id;},clearInterval:i=>timer.delete(i),setTimeout:()=>1});
  const rpc=async(_name,p)=>result===undefined?{data:sample(p.p_period)}:typeof result==='function'?await result(p):result;
  return {host,elements,api:window.aiRadarInsights,timer,setAllowed:v=>allowed=v,setResult:v=>result=v,
    mount:()=>window.aiRadarInsights.mount(host,{rpc,isAllowed:()=>allowed}),blob:()=>blob,clicks:()=>clicks,
    copy:()=>copyButtons[0].onclick(),copied:()=>copied,failCopy:()=>copyFails=true};
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
  const b=setup();b.setResult({data:{...sample('today'),summary:{opens:null}}});b.mount();await settle();
  assert.match(b.host.innerHTML,/0件とは表示せず/);assert.match(b.host.innerHTML,/insights-source-number">—/);
  assert.ok(!b.host.innerHTML.includes('insights-source-number">0'),'missing data is not zero source traffic');
}
{
  const b=setup();let resolve;
  b.setResult(()=>new Promise(r=>resolve=r));b.mount();await settle();
  b.api.reset();resolve({data:sample('today')});await settle();assert.equal(b.host.innerHTML,'','late response cannot restore logged-out data');
}
{
  const b=setup();let first;
  b.setResult(p=>p.p_period==='today'?new Promise(r=>first=r):Promise.resolve({data:sample(p.p_period)}));b.mount();await settle();
  b.elements.select.onchange({target:{value:'7d'}});await settle();first({data:sample('today')});await settle();
  assert.match(b.host.innerHTML,/<option value="7d" selected>/);
  b.elements['[data-export]'].onclick();assert.match(await b.blob().text(),/"期間合計","7d"/);
}
{
  const b=setup(),d=sample('today');d.details_started_at='2026-09-17T00:00:00Z';
  d.sources=[['x',7],['youtube',4],['google',3],['bing',2],['yahoo',1],['duckduckgo',2],['brave',1],['direct_unknown',9],['unrecorded',11]].map(([source,opens])=>({source,opens,unique_browsers:1}));
  b.setResult({data:d});b.mount();await settle();
  for(const [key,value] of [['x',7],['youtube',4],['search',9]]){
    assert.match(b.host.innerHTML,new RegExp('data-source="'+key+'"[^]*?insights-source-number">'+value+'<span>回'));
  }
  assert.ok(b.host.innerHTML.indexOf('data-source="x"')<b.host.innerHTML.indexOf('いつ見られた'));
  assert.match(b.host.innerHTML,/utm_source=x&amp;utm_medium=social/);
  assert.match(b.host.innerHTML,/utm_source=youtube&amp;utm_medium=video/);
  assert.match(b.host.innerHTML,/<option value="today" selected>/);
  assert.match(b.host.innerHTML,/流入元を判別できない（直接起動・復帰など）/);
  assert.match(b.host.innerHTML,/外部の流入元を判別できた<\/dt><dd>20回/);
  assert.match(b.host.innerHTML,/流入元を判別できない<\/dt><dd>9回/);
  assert.match(b.host.innerHTML,/既に載せている通常のURLも置き換える必要/);
  assert.match(b.host.innerHTML,/別のSNSに転載されても元の印で集計/);
  for(const key of ['instagram','note','facebook'])assert.match(b.host.innerHTML,new RegExp('utm_source='+key+'&amp;utm_medium=social'));
  assert.equal((b.host.innerHTML.match(/data-copy-url=/g)||[]).length,5,'one copy link for each supported social placement');
  assert.ok(b.host.innerHTML.indexOf('SNS別の計測リンクをコピー')<b.host.innerHTML.indexOf('data-source="x"'),'measurement links are discoverable near the top');
  await b.copy();assert.match(b.copied(),/utm_source=x/);
  assert.match(b.elements['.insights-copy-state'].textContent,/コピーしました/);
  b.failCopy();await b.copy();assert.match(b.elements['.insights-copy-state'].textContent,/コピーできません/);
}
{
  const b=setup(),d=sample('today');
  d.summary={opens:9,unique_browsers:4,new_browsers:3,returning_browsers:1,unknown_opens:0};
  d.sources=[{source:'direct_unknown',opens:9,unique_browsers:4}];
  b.setResult({data:d});b.mount();await settle();
  assert.match(b.host.innerHTML,/外部の流入元を判別できた<\/dt><dd>0回/);
  assert.match(b.host.innerHTML,/流入元を判別できない<\/dt><dd>9回/);
  assert.match(b.host.innerHTML,/新規のアクセスでも、流入元の情報がなければ/);
  assert.match(b.host.innerHTML,/今の記録だけでは、この内訳を分けられません/);
  for(const key of ['x','youtube','search'])assert.match(b.host.innerHTML,new RegExp('data-source="'+key+'"[^]*?insights-source-number">0<span>回'));
  assert.match(b.host.innerHTML,/初めて来た<\/span><strong>3<\/strong>/,'new browsers are not relabelled as referrals');
}
{
  const b=setup(),d=sample('today');d.sources=[{source:'unrecorded',opens:12,unique_browsers:0}];
  b.setResult({data:d});b.mount();await settle();
  assert.match(b.host.innerHTML,/insights-source-number">—/,'legacy-only data cannot invent historical source zeroes');
}
{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const operator=html.slice(html.indexOf('function renderOperator(v)'),html.indexOf('function exportUpdatesCsv'));
  assert.ok(operator.indexOf('id="operatorInsights"')<operator.indexOf('id="operatorBenefitTitle"'),'source breakdown appears before older account details');
  assert.ok(html.includes('class="operator-insights-link"'),'app counters provide a discoverable analysis entry');
  assert.equal((operator.match(/id="operatorInsights"/g)||[]).length,1,'no duplicate mounts or timers');
}
console.log('Insights UI passed: private mount/export, SQL missing, offline stale values, malformed data, logout and stale-range races.');
