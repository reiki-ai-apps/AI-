/*
  Public article pages are often reached directly from search and social posts.
  Register that browser once, with the same one-way key used by the app shell,
  and record one opening of this page. No total is returned to the browser and
  no account, IP address, or article URL is sent with either request.
*/
(()=>{
  "use strict";
  const SUPABASE_URL="https://ncosmmesecpqhzfikpmn.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY="sb_publishable_9nyRtwzYeaArcNKiZtVVVA_2ji4eK6G";
  const REVIEWER_KEY="ai_radar_public_reviewer_v1";
  const REGISTERED_KEY="ai_radar_unique_visitor_registered_v1";
  const OPEN_EVENT_ID=crypto?.randomUUID?.()||"";
  const requestHeaders={apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${SUPABASE_PUBLISHABLE_KEY}`,"Content-Type":"application/json"};

  // Same policy as the app shell; tested together to prevent drift. No SDK or
  // auth network request is needed, and uncertain storage fails closed.
function isPublicReaderVisit(){
  try{
    if(location.hostname!=='reiki-ai-apps.github.io'||!location.pathname.startsWith('/AI-/'))return false;
    if(/operator|access_token=|refresh_token=|type=recovery/.test(location.hash))return false;
    const operator=JSON.parse(localStorage.getItem('ai_radar_verified_operator_v1')||'null');
    if(operator?.isOperator===true)return false;
    // Only operators log in. An expired/restoring session must not be mistaken
    // for an anonymous reader while the SDK is still loading.
    if(localStorage.getItem('sb-ncosmmesecpqhzfikpmn-auth-token'))return false;
    return true;
  }catch(_error){return false;}
}

  function storedValue(key){
    try{return localStorage.getItem(key)||"";}catch(_error){return "";}
  }
  function saveValue(key,value){
    try{localStorage.setItem(key,value);return true;}catch(_error){return false;}
  }
  function visitorKey(){
    let key=storedValue(REVIEWER_KEY);
    if(/^[0-9a-f-]{36}$/i.test(key))return key;
    if(!crypto?.randomUUID)return "";
    key=crypto.randomUUID();
    return saveValue(REVIEWER_KEY,key)?key:"";
  }
  async function register(){
    if(!isPublicReaderVisit())return;
    if(storedValue(REGISTERED_KEY)==="1"||!crypto?.subtle)return;
    const key=visitorKey();
    if(!key)return;
    const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(key));
    const hash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
    if(!isPublicReaderVisit())return;
    const response=await fetch(`${SUPABASE_URL}/rest/v1/rpc/register_unique_visitor`,{
      method:"POST",keepalive:true,
      headers:requestHeaders,
      body:JSON.stringify({p_visitor_key_hash:hash})
    });
    if(response.ok)saveValue(REGISTERED_KEY,"1");
  }
  async function recordOpen(){
    if(!isPublicReaderVisit())return;
    if(!OPEN_EVENT_ID)return;
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_app_open`,{
      method:"POST",keepalive:true,
      headers:requestHeaders,
      body:JSON.stringify({p_event_id:OPEN_EVENT_ID})
    });
  }
  Promise.allSettled([register(),recordOpen()]);
})();
