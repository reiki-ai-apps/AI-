/* Shared app/article analytics, independent of the authentication SDK.
   New visible opening = new UUID. Retries reuse it; the database deduplicates. */
(()=>{
  'use strict';
  if(window.aiRadarAnalytics)return;
  const ROOT='https://ncosmmesecpqhzfikpmn.supabase.co/rest/v1/rpc/';
  const KEY='sb_publishable_9nyRtwzYeaArcNKiZtVVVA_2ji4eK6G';
  const OPERATOR='ai_radar_verified_operator_v1';
  const EXCLUDED='ai_radar_exclude_operator_browser_v1';
  const SESSION='sb-ncosmmesecpqhzfikpmn-auth-token';
  const REVIEWER='ai_radar_public_reviewer_v1';
  const REGISTERED='ai_radar_unique_visitor_registered_v1';
  const PREFIX='ai_radar_pending_open_v2:';
  const memory=new Map();
  let active=false,started=false,inFlight=null,retryTimer=null,failures=0;
  let identityOverride=null;
  function get(key){try{return localStorage.getItem(key);}catch{return null;}}
  function put(key,value){try{localStorage.setItem(key,value);return true;}catch{return false;}}
  function object(value){try{return JSON.parse(value||'null');}catch{return null;}}
  function isPublicPage(){
    return location.hostname==='reiki-ai-apps.github.io'&&location.pathname.startsWith('/AI-/')&&
      !/operator|access_token=|refresh_token=|type=recovery/.test(location.hash);
  }
  function excluded(){return identityOverride==='operator'||get(EXCLUDED)==='1'||object(get(OPERATOR))?.isOperator===true;}
  function pending(){
    try{for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);
      if(key?.startsWith(PREFIX)){
        const item=object(localStorage.getItem(key));
        if(item&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)&&Number.isFinite(item.createdAt))memory.set(item.id,item);
      }
    }}catch{}
    return [...memory.values()].sort((a,b)=>a.createdAt-b.createdAt);
  }
  function forget(id){memory.delete(id);try{localStorage.removeItem(PREFIX+id);}catch{}}
  function excludeBrowser(){
    identityOverride='operator';put(EXCLUDED,'1');
    for(const item of pending())forget(item.id);
    if(retryTimer!==null){clearTimeout(retryTimer);retryTimer=null;}
  }
  async function rpc(name,body={},token=KEY){
    const controller=new AbortController();let timer;
    try{
      return await Promise.race([
        (async()=>{
          const response=await fetch(ROOT+name,{method:'POST',keepalive:true,signal:controller.signal,
            headers:{apikey:KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
          if(!response.ok){const error=new Error('analytics HTTP '+response.status);error.status=response.status;throw error;}
          return await response.json();
        })(),
        new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('analytics timeout'));},8000);})
      ]);
    }finally{clearTimeout(timer);}
  }
  async function isReader(){
    if(!isPublicPage())return false;
    if(excluded()){excludeBrowser();return false;}
    if(identityOverride==='reader')return true;
    const session=object(get(SESSION));
    if(!session?.user?.id||!session.access_token)return true;
    const cached=object(get(OPERATOR));
    if(cached?.userId===session.user.id&&cached.isOperator===false)return true;
    // Do not exclude every former member with an expired session.
    // Previously verified operators remain excluded by the browser marker.
    if(Number(session.expires_at)>0&&Number(session.expires_at)*1000<Date.now())return true;
    let access;
    try{access=await rpc('get_my_membership',{},session.access_token);}
    catch(error){if(error.status===401)return true;throw error;}
    if(access?.access_source==='operator_grant'){
      put(OPERATOR,JSON.stringify({userId:session.user.id,isOperator:true}));excludeBrowser();return false;
    }
    if(typeof access?.access_source!=='string')throw new Error('identity not confirmed');
    put(OPERATOR,JSON.stringify({userId:session.user.id,isOperator:false}));
    return true;
  }
  async function registerUnique(){
    if(get(REGISTERED)==='1'||excluded())return;
    let key=get(REVIEWER);
    if(!/^[0-9a-f-]{36}$/i.test(key||'')){
      key=crypto.randomUUID();
      // Without persistent storage, do not count a new person on every load.
      if(!put(REVIEWER,key))return;
    }
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
    const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    if(excluded())return;
    if(await rpc('register_unique_visitor',{p_visitor_key_hash:hash})!==true)throw new Error('unique visitor not acknowledged');
    put(REGISTERED,'1');
  }
  async function sendOpens(){
    for(const item of pending().slice(0,50)){
      if(excluded()){excludeBrowser();return;}
      if(await rpc('record_app_open',{p_event_id:item.id})!==true)throw new Error('opening not acknowledged');
      forget(item.id);
    }
  }
  function retry(){
    if(retryTimer!==null||excluded())return;
    const delay=Math.min(60000,4000*2**Math.min(failures++,4));
    retryTimer=setTimeout(()=>{retryTimer=null;void flush();},delay);
  }
  function flush(){
    if(inFlight)return inFlight;
    inFlight=(async()=>{
      try{
        if(!await isReader())return;
        const results=await Promise.allSettled([registerUnique(),sendOpens()]);
        if(results.some(result=>result.status==='rejected'))retry();
        else{failures=0;if(pending().length)retry();}
      }catch{retry();}
      finally{inFlight=null;}
    })();
    return inFlight;
  }
  function onVisible(){
    if(document.visibilityState==='hidden'||active)return;
    active=true;
    if(!isPublicPage()||excluded()){if(excluded())excludeBrowser();return;}
    const item={id:crypto.randomUUID(),createdAt:Date.now()};
    memory.set(item.id,item);put(PREFIX+item.id,JSON.stringify(item));
    void flush();
  }
  function visibility(){if(document.visibilityState==='hidden')active=false;else onVisible();}
  function start(){
    if(started)return;started=true;
    document.addEventListener('visibilitychange',visibility);
    window.addEventListener('pagehide',()=>{active=false;});
    window.addEventListener('pageshow',onVisible);
    window.addEventListener('online',()=>{failures=0;void flush();});
    window.addEventListener('focus',()=>{void flush();}); // focus alone never increments
    window.addEventListener('storage',event=>{if(event.key===EXCLUDED&&excluded())excludeBrowser();});
    onVisible();
  }
  window.aiRadarAnalytics={start,flush,identityChanged(isOperator){
    if(isOperator)excludeBrowser();else{identityOverride='reader';void flush();}
  }};
  start();
})();
