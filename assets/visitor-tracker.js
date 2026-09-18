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
  let hashPromise=null,v2RetryAt=0,firstOpening=true;
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
  async function visitorHash(){
    let key=get(REVIEWER);
    if(!/^[0-9a-f-]{36}$/i.test(key||'')){
      if(get(REGISTERED)==='1')return null;
      key=crypto.randomUUID();
      // Without persistent storage, do not count a new person on every load.
      if(!put(REVIEWER,key))return null;
    }
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
    return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  }
  function getHash(){return hashPromise||(hashPromise=visitorHash().catch(()=>null));}
  async function registerUnique(){
    if(get(REGISTERED)==='1'||excluded())return;
    const hash=await getHash();if(!hash)return;
    if(excluded())return;
    if(await rpc('register_unique_visitor',{p_visitor_key_hash:hash})!==true)throw new Error('unique visitor not acknowledged');
    put(REGISTERED,'1');
  }
  async function sendOpens(){
    // Count new openings first. A pre-migration backlog must never starve today's opens.
    const batch=pending().sort((a,b)=>Number(!!a.legacy)-Number(!!b.legacy)||a.createdAt-b.createdAt).slice(0,50);
    for(const item of batch){
      if(excluded()){excludeBrowser();return;}
      if(item.legacy&&Date.now()-item.createdAt>30*86400000){forget(item.id);continue;}
      if(Date.now()>=v2RetryAt){
        try{
          const hash=await getHash();
          if(excluded()){excludeBrowser();return;}
          if(await rpc('record_app_open_v2',{p_event_id:item.id,p_visitor_key_hash:hash,
            p_occurred_at:new Date(item.createdAt).toISOString(),p_source_group:item.source||'unrecorded',
            p_page_kind:item.page||'app'})!==true)throw new Error('opening not acknowledged');
          forget(item.id);continue;
        }catch(error){
          // Only a missing function warrants legacy fallback, not an arbitrary server error.
          if(error.status!==404)throw error;
          v2RetryAt=Date.now()+600000;
        }
      }
      if(!item.legacy){
        if(await rpc('record_app_open',{p_event_id:item.id})!==true)throw new Error('opening not acknowledged');
        item.legacy=true;memory.set(item.id,item);put(PREFIX+item.id,JSON.stringify(item));
      }
      // Keep details for later migration, with the SAME UUID to avoid double counting.
    }
  }
  function retry(){
    if(retryTimer!==null||excluded())return;
    const delay=Math.max(v2RetryAt-Date.now(),Math.min(60000,4000*2**Math.min(failures++,4)));
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
    const item={id:crypto.randomUUID(),createdAt:Date.now(),source:firstOpening?sourceGroup():'direct_unknown',
      page:location.pathname.includes('/articles/')?'article':'app'};
    firstOpening=false;
    memory.set(item.id,item);put(PREFIX+item.id,JSON.stringify(item));
    void flush();
  }
  function visibility(){if(document.visibilityState==='hidden')active=false;else onVisible();}
  function sourceGroup(){
    const classify=value=>{
      const s=String(value||'').toLowerCase().replace(/^www\./,'');
      if(/^(google|google\.com|google\.co\.jp)$/.test(s))return 'google';
      if(/^(bing|bing\.com)$/.test(s))return 'bing';
      if(/^(yahoo|search\.yahoo\.co\.jp|search\.yahoo\.com)$/.test(s))return 'yahoo';
      if(/^(duckduckgo|duckduckgo\.com)$/.test(s))return 'duckduckgo';
      if(/^(brave|search\.brave\.com)$/.test(s))return 'brave';
      if(/^(x|twitter|x\.com|twitter\.com|t\.co)$/.test(s))return 'x';
      if(/^(youtube|youtube\.com|m\.youtube\.com|youtu\.be)$/.test(s))return 'youtube';
      if(/^(note|note\.com)$/.test(s))return 'note';
      // Existing Instagram bio links use utm_source=ig, not only "instagram".
      if(/^(ig|instagram|instagram\.com|l\.instagram\.com)$/.test(s))return 'instagram';
      if(/^(facebook|facebook\.com|m\.facebook\.com|l\.facebook\.com)$/.test(s))return 'facebook';
      return null;
    };
    try{
      const tagged=classify(new URL(location.href).searchParams.get('utm_source'));
      if(tagged)return tagged;
      if(!document.referrer)return 'direct_unknown';
      const from=new URL(document.referrer);
      if(from.hostname===location.hostname&&from.pathname.startsWith('/AI-/'))return 'internal';
      return classify(from.hostname)||'other';
    }catch{return 'direct_unknown';}
  }
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
