/* Private aggregates: the RPC independently checks operator permissions. No persistent report cache. */
(()=>{
  'use strict';
  const sources={google:'Google検索',bing:'Bing検索',yahoo:'Yahoo!検索',duckduckgo:'DuckDuckGo検索',brave:'Brave検索',x:'X',youtube:'YouTube',note:'note',instagram:'Instagram',facebook:'Facebook',other:'その他の外部サイト',direct_unknown:'直接・流入元不明',internal:'アプリ内リンク',unrecorded:'過去の未記録'};
  const searchSources=['google','bing','yahoo','duckduckgo','brave'];
  const periods={today:'今日',yesterday:'昨日','7d':'7日間','30d':'30日間',all:'全期間'};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const numeric=['opens','unique_browsers','new_browsers','returning_browsers','unknown_opens'];
  let host,context,period='today',data=null,timer=null,generation=0,busy=false;
  const permitted=()=>context?.isAllowed()===true;
  function reset(){
    generation++;if(timer!==null)clearInterval(timer);timer=null;busy=false;
    if(host?.isConnected)host.replaceChildren();
    host=null;context=null;data=null;period='today';
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
  const count=value=>value.toLocaleString('ja-JP');
  const sourceCount=keys=>(data?.sources||[]).filter(x=>keys.includes(x.source)).reduce((n,x)=>n+x.opens,0);
  function trafficCards(){
    const measured=!!data&&(!!data.details_started_at||data.sources.some(x=>x.source!=='unrecorded'));
    return '<div class="insights-sources" aria-label="流入元ごとのアクセス回数">'+[
      ['x','Xから',['x'],'X・Twitterのリンク'],
      ['youtube','YouTubeから',['youtube'],'動画説明欄などのリンク'],
      ['search','Web検索から',searchSources,'Google・Yahoo!・Bingなど']
    ].map(([key,label,keys,note])=>'<article class="insights-source-card" data-source="'+key+'"><h4>'+label+'</h4><p class="insights-source-number">'+(measured?count(sourceCount(keys)):'—')+'<span>回</span></p><p>'+note+'</p></article>').join('')+'</div>'+
      '<p class="insights-caption">選択した期間に、流入元を判別できた回数です。リピーターのアクセスも含みます。</p>'+
      (data?'<div class="insights-source-other">'+[
        ['Instagram',sourceCount(['instagram'])],['note',sourceCount(['note'])],['Facebook',sourceCount(['facebook'])],
        ['その他のサイト',sourceCount(['other'])],['直接・不明（アプリへの復帰を含む）',sourceCount(['direct_unknown'])],
        ['アプリ内リンク',sourceCount(['internal'])],['過去の未記録',sourceCount(['unrecorded'])]
      ].map(([label,n])=>'<div><span>'+label+'</span><strong>'+count(n)+'回</strong></div>').join('')+'</div>':'');
  }
  function campaignLinks(){
    return '<details class="insights-help"><summary>X・YouTubeに貼る計測用リンク</summary><p>SNSアプリが流入元を渡さない場合も区別できるよう、投稿には次のリンクを使ってください。リンク先が開かれると、その流入元として記録します。</p>'+
      [['x','X用'],['youtube','YouTube用']].map(([key,label])=>{
        const url='https://reiki-ai-apps.github.io/AI-/?utm_source='+key+'&utm_medium='+(key==='x'?'social':'video');
        return '<label class="insights-share-link">'+label+'<input readonly aria-label="'+label+'の計測リンク" value="'+esc(url)+'"><button class="btn" data-copy-url="'+esc(url)+'">リンクをコピー</button></label>';
      }).join('')+'<p class="insights-copy-state" aria-live="polite"></p><p>検索からのアクセスは参照元で判別します。情報が渡らない場合は「直接・不明」であり、推測で検索へ振り分けません。</p></details>';
  }
  function timeChart(){
    const max=Math.max(1,...data.hourly.map(x=>x.opens));
    return '<div class="insights-hours" aria-label="時間帯ごとのアクセス">'+data.hourly.map(x=>'<div class="insights-hour" title="'+x.hour+'時台：'+x.opens+'回"><div><i style="height:'+Math.round(x.opens/max*100)+'%"></i></div><small>'+(x.hour%3===0?x.hour:'')+'</small></div>').join('')+'</div>';
  }
  function paint(message=''){
    if(!host?.isConnected||!permitted()){reset();return;}
    host.innerHTML='<h3>どこから見に来た？</h3><p>日本時間で集計。期間を変えると、日ごとの記録や累計も確認できます。</p>'+
      '<div class="insights-controls"><label>期間 <select aria-label="分析の集計期間">'+Object.entries(periods).map(([v,l])=>'<option value="'+v+'"'+(v===period?' selected':'')+'>'+l+'</option>').join('')+'</select></label><button class="btn" data-reload>再取得</button><button class="btn" data-export'+(!data?' disabled':'')+'>集計CSV</button></div>'+
      '<p role="status" class="insights-status">'+esc(message||(data?'最終確認：'+stamp():'集計を取得しています…'))+'</p>'+
      (data?'<p>'+esc(data.from)+' 〜 '+esc(data.through)+'</p>':'')+trafficCards()+
      (data?'<details class="insights-help"><summary>流入元を詳しく見る</summary>'+table(['流入元','開いた回数','ユニーク'],data.sources.map(x=>[sources[x.source],x.opens,x.unique_browsers]))+'</details>'+
        '<h4>'+esc(periods[period])+'の利用状況</h4><div class="operator-metric-grid">'+
        [['開かれた回数',data.summary.opens,'回'],['ユニーク',data.summary.unique_browsers,'ブラウザー'],['初めて来た',data.summary.new_browsers,'ブラウザー'],['以前にも来た',data.summary.returning_browsers,'ブラウザー'],['累計の開かれた回数',data.totals.opens,'回'],['累計ユニーク',data.totals.unique_browsers,'ブラウザー']].map(([l,n,u])=>'<div class="operator-metric-card"><span>'+esc(l)+'</span><strong>'+count(n)+'</strong><small>'+u+'</small></div>').join('')+'</div>'+
        '<h4>いつ見られた？</h4>'+timeChart()+'<details class="insights-help"><summary>時間帯別の回数を見る</summary>'+table(['時間帯','開いた回数'],data.hourly.map(x=>[String(x.hour).padStart(2,'0')+'時台',x.opens]))+'</details>'+
        '<details class="insights-help"><summary>日別の推移を見る</summary>'+table(['日付','開いた回数','ユニーク','新規','再訪','判別不可'],data.daily.map(x=>[x.day,...numeric.map(k=>x[k])]))+'</details>':'')+
      campaignLinks()+
      '<details class="insights-help"><summary>データの見方・計測の範囲</summary>'+
      (data?'<p>詳細計測の記録開始：'+(data.details_started_at?esc(new Date(data.details_started_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})):'新形式の記録はまだありません')+'</p><p>新規／再訪を判別できない開き方：'+count(data.summary.unknown_opens)+'回。</p>':'')+
      '<p>ユニークは実人数ではなく匿名のブラウザー識別子の数です。端末変更や保存データの消去で別の訪問者になる場合があります。日別の新規はその日に初めて来たブラウザー、再訪は前日以前にも来たブラウザーです。期間の新規／再訪は期間開始日を基準にします。</p>'+
      '<p>流入元別のユニークは重複するため合計できません。Web検索の大きなカードは回数だけを合算しています。直接・不明にはホーム画面からの起動やアプリへの復帰も含みます。流入元が渡らないアクセスや、過去の未記録分の内訳は復元できません。</p>'+
      '<p>位置情報・IP・参照元の全文URLは保存しません。保存した履歴から集計するため、毎日の作業は不要です。詳細計測は開いた時刻、下の従来カウンターは受信時刻のため、遅延送信時には差が出ることがあります。運営者として確認済みのブラウザーは除外します。</p></details>';
    host.querySelector('select').onchange=e=>{period=e.target.value;data=null;generation++;busy=false;paint();void refresh();};
    host.querySelector('[data-reload]').onclick=()=>void refresh();
    host.querySelector('[data-export]').onclick=download;
    host.querySelectorAll('[data-copy-url]').forEach(button=>button.onclick=async()=>{
      if(!permitted())return;
      const message=host.querySelector('.insights-copy-state');
      try{await navigator.clipboard.writeText(button.dataset.copyUrl);if(message?.isConnected)message.textContent='リンクをコピーしました。投稿のリンクとして貼り付けてください。';}
      catch{if(message?.isConnected)message.textContent='コピーできませんでした。上のリンク欄を選択してコピーしてください。';}
    });
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
        '流入元の計測はまだ有効になっていません。Supabaseのアクセス分析SQLが未適用です。「—」は0回という意味ではありません。従来の人数・回数は下で確認できます。':
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
    const previousPeriod=keep?period:'today',previousData=keep?data:null;
    reset();if(!element||!options.isAllowed())return;
    host=element;context=options;period=previousPeriod;data=previousData;paint();void refresh();
    timer=setInterval(()=>{if(!host?.isConnected){reset();return;}if(document.visibilityState==='visible')void refresh();},60000);
  }};
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refresh();});
  window.dispatchEvent(new Event('ai-radar-insights-ready'));
})();
