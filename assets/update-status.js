/* Publication freshness is independent of workflow success and browser caching. */
(()=>{
  'use strict';
  let report=null,pending=null,lastFetch=0;
  function paint(){
    for(const node of document.querySelectorAll('[data-update-health]')){
      const updated=Date.parse(report?.last_article_update_at);
      const delayed=report?.status!=='current'||!Number.isFinite(updated)||Date.now()-updated>86400000;
      let message='';
      if(report&&delayed)message='自動更新が遅れています。現在は最後に確認できた記事を表示しています。'+
        (Number.isFinite(updated)?' 最終確認：'+new Date(updated).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}):'');
      if(node.textContent!==message)node.textContent=message;
      node.hidden=!message;
    }
  }
  function refresh(){
    paint();
    if(pending||Date.now()-lastFetch<60000)return pending;
    lastFetch=Date.now();
    pending=(async()=>{
      try{
        const response=await fetch('./update-health.json',{cache:'no-store',signal:AbortSignal.timeout(8000)});
        if(!response.ok)throw Error('health unavailable');
        const value=await response.json();
        if(value.version!==1||!['current','delayed','action_required'].includes(value.status))throw Error('invalid health');
        report=value;paint();
      }catch{/* Do not replace the last known failure with a fabricated success. */}
      finally{pending=null;}
    })();return pending;
  }
  window.aiRadarUpdateStatus={refresh};
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refresh();});
  setInterval(()=>{if(document.visibilityState==='visible')void refresh();},60000);
  void refresh();
})();
