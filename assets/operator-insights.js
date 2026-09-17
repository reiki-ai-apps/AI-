/* Private aggregates: the RPC independently checks operator permissions. No persistent report cache. */
(()=>{
  'use strict';
  const sources={google:'Google',bing:'Bing',x:'X',youtube:'YouTube',note:'note',instagram:'Instagram',facebook:'Facebook',other:'その他の外部サイト',direct_unknown:'直接・流入元不明',internal:'アプリ内リンク',unrecorded:'過去の未記録'};
  const periods={today:'今日',yesterday:'昨日','7d':'7日間','30d':'30日間',all:'全期間'};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const numeric=['opens','unique_browsers','new_browsers','returning_browsers','unknown_opens'];
  let host,context,period='7d',data=null,timer=null,generation=0,busy=false;
  const permitted=()=>context?.isAllowed()===true;
  function reset(){
    generation++;if(timer!==null)clearInterval(timer);timer=null;busy=false;
    if(host?.isConnected)host.replaceChildren();
    host=null;context=null;data=null;period='7d';
  }
  function valid(d){
    const counts=(o,keys)=>!!o&&keys.every(k=>Number.isSafeInteger(o[k])&&o[k]>=0);
    return d?.version===1&&d.period===period&&d.timezone==='Asia/Tokyo'&&
      /^\d{4}-\d{2}-\d{2}$/.test(d.from)&&/^\d{4}-\d{2}-\d{2}$/.test(d.through)&&Number.isFinite(Date.parse(d.as_of))&&
      counts(d.totals,['opens','unique_browsers'])&&counts(d.summary,numeric)&&
      Array.isArray(d.daily)&&d.daily.every(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.day)&&counts(x,numeric))&&
      Array.isArray(d.sources)&&d.sources.every(x=>Object.hasOwn(sources,x.source)&&counts(x,['opens','unique_browsers']))&&
      Array.isArray(d.hourly)&&d.hourly.length===24&&d.hourly.every((x,i)=>x.hour===i&&counts(x,['opens']));
  }
  function table(head,rows){return '<div class="insights-scroll" tabindex="0"><table><thead><tr>'+head.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
  const stamp=()=>new Date(data.as_of).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});
  function paint(message=''){
    if(!host?.isConnected||!permitted()){reset();return;}
    host.innerHTML='<h3>アクセス分析</h3><p>日本時間で毎日自動集計。管理者だけが確認できます。</p>'+
      '<div class="insights-controls"><label>期間 <select aria-label="分析の集計期間">'+Object.entries(periods).map(([v,l])=>'<option value="'+v+'"'+(v===period?' selected':'')+'>'+l+'</option>').join('')+'</select></label><button class="btn" data-reload>再取得</button><button class="btn" data-export'+(!data?' disabled':'')+'>集計CSV</button></div>'+
      '<p role="status" class="insights-status">'+esc(message||(data?'最終確認：'+stamp():'集計を取得しています…'))+'</p>'+
      (data?'<p>'+esc(data.from)+' 〜 '+esc(data.through)+'</p><p>詳細計測の記録開始：'+(data.details_started_at?esc(new Date(data.details_started_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})):'新形式の記録はまだありません')+'</p><div class="operator-metric-grid">'+
        [['期間中に開かれた回数',data.summary.opens],['判別できたユニーク',data.summary.unique_browsers],['期間中に初めて来たブラウザー',data.summary.new_browsers],['期間開始前にも来たブラウザー',data.summary.returning_browsers],['累計の開かれた回数',data.totals.opens],['累計ユニーク',data.totals.unique_browsers]].map(([l,n])=>'<div class="operator-metric-card"><span>'+esc(l)+'</span><strong>'+n.toLocaleString('ja-JP')+'</strong></div>').join('')+'</div>'+
        '<p>新規／再訪を判別できない開き方：'+data.summary.unknown_opens.toLocaleString('ja-JP')+'回。過去の未記録や、ブラウザーの保存制限を含みます。</p>'+
        '<h4>日別の推移</h4>'+table(['日付','開いた回数','ユニーク','新規','再訪','判別不可'],data.daily.map(x=>[x.day,...numeric.map(k=>x[k])]))+
        '<h4>時間帯別（選択期間の合計）</h4>'+table(['時間帯','開いた回数'],data.hourly.map(x=>[String(x.hour).padStart(2,'0')+'時台',x.opens]))+
        '<h4>どこから開かれたか</h4>'+table(['流入元','開いた回数','ユニーク'],data.sources.map(x=>[sources[x.source],x.opens,x.unique_browsers])):'')+
      '<p class="billing-help">ユニークは実人数ではなく匿名のブラウザー識別子の数です。端末の変更や保存データの消去で別の訪問者になる場合があります。日別の新規はその日に初めて来たブラウザー、再訪は前日以前にも来たブラウザーです。日別・流入元別のユニークは重複するため、合計しても期間全体のユニークにはなりません。</p>'+
      '<p class="billing-help">流入元は参照情報や既知のutm_sourceから分類します。SNSなどが参照情報を渡さない場合は「直接・流入元不明」です。位置情報・IPアドレス・参照元の全文URLは保存しません。未記録だった過去の流入元や再訪の内訳は復元しません。</p>'+
      '<p class="billing-help">保存した記録から自動集計するため、翌日も履歴が残ります。詳細計測は開いた時刻を使用し、30日以内の再送も元の日時に反映します。旧記録と上部の「今日」はサーバー受信時刻のため、通信遅延時に差が出る場合があります。運営者として確認済みのブラウザーは除外します。</p>';
    host.querySelector('select').onchange=e=>{period=e.target.value;data=null;generation++;busy=false;paint();void refresh();};
    host.querySelector('[data-reload]').onclick=()=>void refresh();
    host.querySelector('[data-export]').onclick=download;
  }
  async function refresh(){
    if(!host?.isConnected)return;
    if(!permitted()){reset();return;}
    if(busy)return;busy=true;const current=++generation,requested=period;
    try{
      const result=await context.rpc('operator_access_insights',{p_period:requested});
      if(current!==generation||!permitted())return;
      if(result.error)throw result.error;
      if(!valid(result.data))throw new Error('invalid aggregate');
      data=result.data;paint();
    }catch(error){
      if(current!==generation||!permitted())return;
      paint(error?.code==='PGRST202'||error?.status===404?
        '詳細計測の準備中：Supabaseのアクセス分析SQLが未適用です。従来の人数・回数は上部で確認できます。':
        (data?'再取得に失敗しました。前回確認値を表示中（'+stamp()+'）。':'集計を取得できませんでした。0件とは表示せず、接続回復後に再取得します。'));
    }finally{if(current===generation)busy=false;}
  }
  function download(){
    if(!permitted()||!data)return;
    const rows=[['集計期間',data.from,data.through,'Asia/Tokyo'],['確認時刻',data.as_of],
      ['種別','日付／時間／流入元','開いた回数','ユニーク','新規','再訪','判別不可'],
      ['期間合計',period,...numeric.map(k=>data.summary[k])],['累計','全期間',data.totals.opens,data.totals.unique_browsers],
      ...data.daily.map(x=>['日別',x.day,...numeric.map(k=>x[k])]),
      ...data.hourly.map(x=>['時間帯',x.hour+'時台',x.opens]),
      ...data.sources.map(x=>['流入元',sources[x.source],x.opens,x.unique_browsers])];
    const csv='\ufeff'+rows.map(row=>row.map(v=>'"'+String(v??'').replace(/^[=+\-@]/,"'$&").replace(/"/g,'""')+'"').join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='ai-radar-insights-'+data.from+'-'+data.through+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  window.aiRadarInsights={reset,mount(element,options){
    const keep=options.userId&&context?.userId===options.userId&&permitted();
    const previousPeriod=keep?period:'7d',previousData=keep?data:null;
    reset();if(!element||!options.isAllowed())return;
    host=element;context=options;period=previousPeriod;data=previousData;paint();void refresh();
    timer=setInterval(()=>{if(!host?.isConnected){reset();return;}if(document.visibilityState==='visible')void refresh();},60000);
  }};
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refresh();});
  window.dispatchEvent(new Event('ai-radar-insights-ready'));
})();
