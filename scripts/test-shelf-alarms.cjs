// Run with Node and jsdom available (or NODE_PATH pointing to an installed jsdom).
// Synthetic records only. No request is sent to LINE or the user's sync endpoint.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(process.env.SHELF_HTML || path.join(__dirname,'../shelf/index.html'),'utf8');
const KEY='white-shelf.tasks.v1',BACKUP='white-shelf.tasks.backup-before-alarm-edit-v1';
const now=Date.now(),stamp=now-60000;
const records=[
  {id:'past',title:'既存案件',memo:'変更前の説明',category:'ec',status:'active',calendarDate:'2027-12-20',due:'2027-12-20',alarm:'日時指定|2020-01-01T09:00',alarm2:'日時指定|2020-01-02T09:00',createdAt:stamp,updatedAt:stamp,custom:{keep:'unknown field'}},
  {id:'future',title:'別の予定',memo:'消さない',category:'p',status:'active',calendarDate:'2099-01-03',alarm:'日時指定|2099-01-02T10:00',alarm2:'なし',createdAt:stamp,updatedAt:stamp},
  {id:'memo',title:'既存メモ',memo:'大切な本文',category:'u',status:'someday',calendarDate:null,alarm:'なし',alarm2:'なし',createdAt:stamp,updatedAt:stamp},
  {id:'done',title:'完了履歴',status:'completed',calendarDate:null,alarm:'なし',alarm2:'なし',createdAt:stamp,updatedAt:stamp},
  {id:'deleted',title:'削除済みの同期記録',status:'deleted',calendarDate:null,alarm:'なし',alarm2:'なし',createdAt:stamp,updatedAt:stamp}
];
const raw=JSON.stringify(records);
function setup(t,connected=false){
  const errors=[],requests=[];
  const dom=new JSDOM(html,{url:'https://reiki-ai-apps.github.io/AI-/shelf/index.html',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){
    w.localStorage.setItem(KEY,raw);
    w.requestIdleCallback=()=>0;
    w.TextEncoder=TextEncoder;
    w.addEventListener('error',e=>errors.push(e.error));
    w.fetch=async(url,opts)=>{requests.push(JSON.parse(opts.body));return {json:async()=>({ok:true,snapshot:{tasks:JSON.parse(opts.body).snapshot.tasks}})}};
    if(connected){w.localStorage.setItem('white-shelf.line-endpoint','https://script.google.com/macros/s/synthetic_test_endpoint_123456789/exec');w.localStorage.setItem('white-shelf.sync-key','synthetic-test-only')}
  }});
  t.after(()=>{dom.window.close();assert.deepEqual(errors,[])});
  const w=dom.window,d=w.document,$=s=>d.querySelector(s),read=()=>JSON.parse(w.localStorage.getItem(KEY));
  const click=s=>{assert.ok($(s),s);$(s).click()};
  const edit=id=>{click('[data-tab="all"]');click(`[data-edit-id="${id}"]`)};
  const alarm=(slot,value)=>{const suffix=slot===1?'':'2',sel=$('#taskAlarmAt'+suffix+'Mode');sel.value=value?'scheduled':'none';sel.dispatchEvent(new w.Event('change',{bubbles:true}));$('#taskAlarmAt'+suffix).value=value};
  const save=()=>click('#saveTask');
  const saved=()=>assert.ok($('#modalRoot').classList.contains('is-hidden'),$('#formMessage')?.textContent);
  return {w,$,click,read,edit,alarm,save,saved,requests};
}
test('opening the updated app does not rewrite existing records or connection settings',t=>{
  const h=setup(t,true);assert.equal(h.w.localStorage.getItem(KEY),raw);assert.equal(h.w.localStorage.getItem('white-shelf.sync-key'),'synthetic-test-only');assert.equal(h.w.localStorage.getItem(BACKUP),null);
});
for(const slots of [[],[1],[2],[1,2]])test(`new task saves with alarm slots ${slots.join(',')||'unset'}`,t=>{
  const h=setup(t);h.click('#headerAdd');h.$('#taskTitle').value='新しい予定';h.$('#taskCalendarDate').value='2099-01-10';
  for(const slot of slots)h.alarm(slot,`2099-01-0${slot}T10:00`);
  assert.equal(h.$('#taskForm').checkValidity(),true);h.save();h.saved();
  const all=h.read(),item=all.find(x=>x.title==='新しい予定');assert.equal(all.length,records.length+1);assert.equal(item.calendarDate,'2099-01-10');
  for(const slot of [1,2])assert.equal(item[slot===1?'alarm':'alarm2'],slots.includes(slot)?`日時指定|2099-01-0${slot}T10:00`:'なし');
  assert.equal(h.w.localStorage.getItem(BACKUP),raw);
});
test('editing a title with two unchanged past alarms keeps dates, unknown fields, memos and other records',t=>{
  const h=setup(t);h.edit('past');h.$('#taskTitle').value='修正した案件';h.save();h.saved();
  const all=h.read(),edited=all.find(x=>x.id==='past');assert.equal(all.length,records.length);assert.equal(edited.title,'修正した案件');
  for(const field of ['alarm','alarm2','calendarDate','memo','custom','createdAt'])assert.deepEqual(edited[field],records[0][field]);
  for(const r of records.slice(1))for(const [key,value]of Object.entries(r))assert.deepEqual(all.find(x=>x.id===r.id)[key],value);
  assert.equal(h.w.localStorage.getItem(BACKUP),raw);
  h.edit('past');h.$('#taskMemo').value='説明だけ再編集';h.save();h.saved();assert.equal(h.w.localStorage.getItem(BACKUP),raw);
});
test('one old alarm may remain while the other is set in the future',t=>{
  const h=setup(t);h.edit('past');h.alarm(2,'2099-01-05T10:00');h.save();h.saved();const r=h.read()[0];assert.equal(r.alarm,records[0].alarm);assert.equal(r.alarm2,'日時指定|2099-01-05T10:00');
});
test('unset cancels only the selected alarm, and clear alarms preserves calendar date',t=>{
  const h=setup(t);h.edit('past');h.alarm(1,'');h.save();h.saved();assert.equal(h.read()[0].alarm,'なし');assert.equal(h.read()[0].alarm2,records[0].alarm2);
  h.edit('past');h.click('[data-action="clear-alarms"]');assert.equal(h.$('#taskCalendarDate').value,'2027-12-20');h.save();h.saved();assert.equal(h.read()[0].alarm2,'なし');assert.equal(h.read()[0].calendarDate,'2027-12-20');
});
test('blank date-time and entirely undated tasks can be saved',t=>{
  const h=setup(t);h.click('#headerAdd');h.$('#taskTitle').value='未定';const sel=h.$('#taskAlarmAtMode');sel.value='scheduled';sel.dispatchEvent(new h.w.Event('change',{bubbles:true}));h.save();h.saved();const item=h.read().find(x=>x.title==='未定');assert.equal(item.alarm,'なし');assert.equal(item.calendarDate,null);
});
test('new past alarms and duplicate future alarms report errors without changing saved records',t=>{
  const h=setup(t);h.edit('future');h.alarm(1,'2020-01-01T10:00');h.save();assert.match(h.$('#formMessage').textContent,/未来/);assert.equal(h.w.localStorage.getItem(KEY),raw);
  h.alarm(1,'2099-01-05T10:00');h.alarm(2,'2099-01-05T10:00');h.save();assert.match(h.$('#formMessage').textContent,/別の日時/);assert.equal(h.w.localStorage.getItem(KEY),raw);
});
test('backup failure blocks changes rather than overwriting data',t=>{
  const h=setup(t);h.edit('past');h.$('#taskTitle').value='保存失敗';const proto=Object.getPrototypeOf(h.w.localStorage),set=proto.setItem;proto.setItem=function(k,v){if(k===BACKUP)throw new Error('quota');return set.call(this,k,v)};
  h.save();assert.match(h.$('#formMessage').textContent,/変更はしていません/);assert.equal(h.w.localStorage.getItem(KEY),raw);
});
test('sync keeps every record and cleared alarm values (mock endpoint only)',async t=>{
  const h=setup(t,true);h.edit('past');h.click('[data-action="clear-alarms"]');h.save();h.saved();await new Promise(r=>setTimeout(r,0));
  assert.equal(h.requests.length,1);const snapshot=h.requests[0].snapshot.tasks;assert.equal(snapshot.length,records.length);assert.equal(snapshot.find(x=>x.id==='past').alarm,'なし');assert.equal(snapshot.find(x=>x.id==='memo').memo,'大切な本文');assert.equal(h.w.localStorage.getItem('white-shelf.sync-key'),'synthetic-test-only');
});
