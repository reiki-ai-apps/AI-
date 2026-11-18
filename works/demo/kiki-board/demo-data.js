(function(root){
  'use strict';
  const KEY='portfolio.kiki-board.samples.v1';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const day=offset=>{const d=new Date(today+'T12:00:00+09:00');d.setUTCDate(d.getUTCDate()+offset);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);};
  const poster='<svg xmlns="http://www.w3.org/2000/svg" width="540" height="960" viewBox="0 0 540 960"><rect width="540" height="960" fill="#e9e2d4"/><rect x="35" y="35" width="470" height="890" rx="8" fill="none" stroke="#88816f"/><g text-anchor="middle" fill="#3f463c" font-family="sans-serif"><text x="270" y="355" font-size="22" letter-spacing="5">KIKI TOA</text><text x="270" y="440" font-size="34">架空の投稿見本</text><text x="270" y="498" font-size="20">表示用ポスター</text><text x="270" y="544" font-size="17">動画・過去の制作実績ではありません</text><text x="270" y="790" font-size="16">ポートフォリオ体験版</text></g></svg>';
  function fixture(){
    const row=(id,offset,title,done=false)=>({id,date:day(offset),song:'架空曲 / 操作用サンプル',title,moment:'架空の場面',part:'表示用ポスター',ver:1,
      poster_id:'sample-poster',story_id:'sample-story',video_id:'',filename:'sample-poster.svg',
      tiktok_text:'【架空の投稿文】これは投稿ボードの操作確認用サンプルです。実際の作品や公開予定ではありません。 #架空データ',
      cover_hint:'架空ポスターを表示しています。動画は含みません。',tt_done:done,tt_at:done?day(offset)+'T21:10:00+09:00':null,tt_story_done:done,tt_story_at:done?day(offset)+'T21:15:00+09:00':null,
      x_state:done?'done':'scheduled',x_at:day(offset)+'T21:00:00+09:00',x_url:'',ig_state:done?'done':'scheduled',ig_at:day(offset)+'T21:00:00+09:00',ig_url:'',
      yt_state:done?'done':'scheduled',yt_at:day(offset)+'T21:00:00+09:00',yt_url:'',ig_story_state:'skip',ig_story_url:'',updated_at:new Date().toISOString()});
    return {version:1,videos:[row('sample-today',0,'架空の夜景 A'),row('sample-past',-1,'架空の朝景 B'),row('sample-next',1,'架空の雨景 C'),row('sample-done',-2,'架空の街景 D',true)],
      notes:[{id:'sample-note',text:'【架空のメモ】ポスターの文字と投稿文を見比べる。実際の投稿は行いません。',done:false}],status:null};
  }
  let state;
  try{const stored=JSON.parse(root.localStorage.getItem(KEY)||'null');if(stored?.version===1&&Array.isArray(stored.videos)&&Array.isArray(stored.notes))state=stored;}catch(_){}
  if(!state)state=fixture();
  const listeners={videos:new Set(),notes:new Set()};
  function save(){try{root.localStorage.setItem(KEY,JSON.stringify(state));}catch(_){}}
  function notify(name){for(const listener of listeners[name])listener({docs:state[name].map(record=>({id:record.id,exists:true,data:()=>copy(record)})),metadata:{fromCache:false}});}
  const db={
    collection(name){if(!listeners[name])throw Error('架空の投稿とメモだけ扱えます');return {onSnapshot(listener){listeners[name].add(listener);queueMicrotask(()=>notify(name));return()=>listeners[name].delete(listener);}};},
    doc(path){const [name,id,...extra]=path.split('/');if(extra.length||!listeners[name])throw Error('架空の保存先ではありません');return {async update(patch){const record=state[name].find(row=>row.id===id);if(!record)throw Error('架空データが見つかりません');const allowed=name==='videos'?['tt_done','tt_at','tt_story_done','tt_story_at','updated_at']:['done','done_at'];if(Object.keys(patch).some(key=>!allowed.includes(key)))throw Error('体験版で許可していない変更です');Object.assign(record,copy(patch));save();notify(name);}};}
  };
  function download(filename,content,type){if(!root.document)return {filename,content,type};const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return {ok:true};}
  root.KikiSample={db,key:KEY,poster,
    reset(){state=fixture();save();notify('videos');notify('notes');},
    saveStatus(value){state.status=copy(value);save();},
    downloadStatus(){return state.status?download(state.status.title,'\ufeff'+state.status.text,'text/csv;charset=utf-8'):null;},
    downloadPoster(){return download('架空の表示用ポスター.svg',poster,'image/svg+xml;charset=utf-8');},
    read(){return copy(state);}
  };
})(globalThis);
