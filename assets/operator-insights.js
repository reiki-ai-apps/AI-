/* Private aggregates: the RPC independently checks operator permissions. No persistent report cache. */
(()=>{
  'use strict';
  const sources={google:'Google検索',bing:'Bing検索',yahoo:'Yahoo!検索',duckduckgo:'DuckDuckGo検索',brave:'Brave検索',x:'X',youtube:'YouTube',note:'note',instagram:'Instagram',facebook:'Facebook',other:'その他の外部サイト',direct_unknown:'直接・流入元不明',internal:'アプリ内リンク',unrecorded:'過去の未記録'};
  const searchSources=['google','bing','yahoo','duckduckgo','brave'];
  const externalSources=Object.keys(sources).filter(key=>!['direct_unknown','internal','unrecorded'].includes(key));
  const periods={today:'今日',yesterday:'昨日','7d':'7日間','30d':'30日間',all:'全期間'};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const numeric=['opens','unique_browsers','new_browsers','returning_browsers','unknown_opens'];
  let host,context,period='today',data=null,campaignData=null,campaignMessage='',timer=null,generation=0,busy=false;
  const permitted=()=>context?.isAllowed()===true;
  function reset(){
    generation++;if(timer!==null)clearInterval(timer);timer=null;busy=false;
    if(host?.isConnected)host.replaceChildren();
    host=null;context=null;data=null;campaignData=null;campaignMessage='';period='today';
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
  function validCampaigns(d){
    return d?.version===1&&d.days===14&&d.timezone==='Asia/Tokyo'&&Number.isFinite(Date.parse(d.as_of))&&
      /^\d{4}-\d{2}-\d{2}$/.test(d.from)&&/^\d{4}-\d{2}-\d{2}$/.test(d.through)&&
      Array.isArray(d.campaigns)&&d.campaigns.every(x=>/^kizashi-[a-z0-9-]{1,64}$/.test(x.campaign)&&
        typeof x.landing==='string'&&Object.hasOwn(sources,x.source)&&
        ['opens','unique_browsers','new_browsers','returned_browsers'].every(k=>Number.isSafeInteger(x[k])&&x[k]>=0)&&
        x.returned_browsers<=x.unique_browsers&&x.new_browsers<=x.unique_browsers);
  }
  function campaignReport(){
    return '<section class="insights-attribution" aria-label="投稿ごとの効果"><h4>どの投稿が読者につながった？</h4><p>この欄は直近14日間です。上の期間選択とは別に比較します。</p>'+
      (campaignMessage?'<p role="status">'+esc(campaignMessage)+'</p>':'')+
      (campaignData?'<p>'+esc(campaignData.from)+' 〜 '+esc(campaignData.through)+'</p>'+
        (campaignData.campaigns.length?'<div class="insights-posts">'+campaignData.campaigns.map(x=>'<article class="insights-post"><strong>'+esc(sources[x.source])+' · '+esc(x.campaign.replace(/^kizashi-/,''))+'</strong><p>記事：'+esc(x.landing)+'</p><dl>'+[['開いた回数',x.opens+'回'],['ブラウザー',x.unique_browsers],['新規',x.new_browsers],['後日再訪',x.returned_browsers]].map(([k,v])=>'<div><dt>'+k+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl></article>').join('')+'</div>':
          '<p>投稿ID付きリンクからの記録はまだありません。SNS別リンクだけの過去のアクセスは、特定の投稿へ振り分けられません。</p>'):
        '<p>投稿別データをまだ取得できていません。0件という意味ではありません。</p>')+
      '<p>「後日再訪」は、そのリンクを開いた翌日以降にこのアプリへ戻ったブラウザー数です。再訪のきっかけを断定する数ではありません。人の数ではなく、端末変更などで分かれる場合があります。投稿をまたぐ重複があるため合計しないでください。</p>'+
      '<details><summary>記事ごとの計測リンクを作る</summary><p>送りたい記事のURLと、投稿ごとに異なる短いIDを入力します。個人名・メールアドレスは入れないでください。リンクの作成だけでは投稿されません。</p>'+
      '<label class="insights-share-link">記事URL<input data-campaign-target type="url" placeholder="https://reiki-ai-apps.github.io/AI-/articles/…/"></label>'+
      '<label class="insights-share-link">投稿ID（半角英数字・ハイフン）<input data-campaign-id placeholder="20260930-minutes-x-01" maxlength="64"></label>'+
      '<label>掲載先 <select data-campaign-source><option value="x">X</option><option value="youtube">YouTube</option><option value="instagram">Instagram</option><option value="note">note</option></select></label> <button class="btn" data-campaign-build>計測リンクを作成</button>'+
      '<label class="insights-share-link">作成したリンク<input data-campaign-output readonly></label><p data-campaign-status aria-live="polite"></p></details></section>';
  }
  const stamp=()=>new Date(data.as_of).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});
  const count=value=>value.toLocaleString('ja-JP');
  const sourceCount=keys=>(data?.sources||[]).filter(x=>keys.includes(x.source)).reduce((n,x)=>n+x.opens,0);
  function attributionStatus(){
    if(!data)return '';
    return '<section class="insights-attribution" aria-label="流入元の判別状況"><h4>流入元はどこまで分かる？</h4>'+
      '<dl><div><dt>外部の流入元を判別できた</dt><dd>'+count(sourceCount(externalSources))+'回</dd></div>'+
      '<div><dt>流入元を判別できない</dt><dd>'+count(sourceCount(['direct_unknown']))+'回</dd></div></dl>'+
      '<p>「初めて来た」はブラウザーの利用履歴です。新規のアクセスでも、流入元の情報がなければX経由かYouTube経由かは分かりません。</p>'+
      (sourceCount(['direct_unknown'])?'<p>判別できない回数には、直接起動・アプリへの復帰・流入元を渡さない外部リンクが含まれます。今の記録だけでは、この内訳を分けられません。</p>':'')+
      '<p>下の計測リンクをSNSのプロフィールや投稿に使うと、参照元が渡らない場合もリンクの印で区別できます。アプリ内リンクと過去の未記録は、上の2項目には含めていません。</p></section>';
  }
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
        ['その他のサイト',sourceCount(['other'])],['流入元を判別できない（直接起動・復帰など）',sourceCount(['direct_unknown'])],
        ['アプリ内リンク',sourceCount(['internal'])],['過去の未記録',sourceCount(['unrecorded'])]
      ].map(([label,n])=>'<div><span>'+label+'</span><strong>'+count(n)+'回</strong></div>').join('')+'</div>':'');
  }
  function campaignLinks(){
    return '<details class="insights-help insights-campaign-links"><summary>SNS別の計測リンクをコピー</summary><p>載せる場所に合ったリンクをコピーし、そのSNSのプロフィール・投稿・動画説明欄に貼ってください。既に載せている通常のURLも置き換える必要があります。アプリ側の修正だけでは、外部に載せたリンクは変わりません。</p>'+
      [['x','X用','social'],['youtube','YouTube用','video'],['instagram','Instagram用','social'],['note','note用','social'],['facebook','Facebook用','social']].map(([key,label,medium])=>{
        const url='https://reiki-ai-apps.github.io/AI-/?utm_source='+key+'&utm_medium='+medium;
        return '<label class="insights-share-link">'+label+'<input readonly aria-label="'+label+'の計測リンク" value="'+esc(url)+'"><button class="btn" data-copy-url="'+esc(url)+'">リンクをコピー</button></label>';
      }).join('')+'<p class="insights-copy-state" aria-live="polite"></p><p>計測リンクは、開いた時にURLの印が残っている場合に判別できます。別のSNSに転載されても元の印で集計されるので、載せる場所ごとに使い分けてください。復帰表示を元のSNSからの新たな流入として数え直すことはありません。</p><p>検索経由はブラウザーから渡る参照元で判別します。情報がないアクセスを推測で検索やSNSに振り分けたり、過去の流入元を復元したりはできません。</p></details>';
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
      (data?'<p>'+esc(data.from)+' 〜 '+esc(data.through)+'</p>':'')+attributionStatus()+campaignLinks()+trafficCards()+
      campaignReport()+(data?'<details class="insights-help"><summary>流入元を詳しく見る</summary>'+table(['流入元','開いた回数','ユニーク'],data.sources.map(x=>[sources[x.source],x.opens,x.unique_browsers]))+'</details>'+
        '<h4>'+esc(periods[period])+'の利用状況</h4><div class="operator-metric-grid">'+
        [['開かれた回数',data.summary.opens,'回'],['ユニーク',data.summary.unique_browsers,'ブラウザー'],['初めて来た',data.summary.new_browsers,'ブラウザー'],['以前にも来た',data.summary.returning_browsers,'ブラウザー'],['累計の開かれた回数',data.totals.opens,'回'],['累計ユニーク',data.totals.unique_browsers,'ブラウザー']].map(([l,n,u])=>'<div class="operator-metric-card"><span>'+esc(l)+'</span><strong>'+count(n)+'</strong><small>'+u+'</small></div>').join('')+'</div>'+
        '<h4>いつ見られた？</h4>'+timeChart()+'<details class="insights-help"><summary>時間帯別の回数を見る</summary>'+table(['時間帯','開いた回数'],data.hourly.map(x=>[String(x.hour).padStart(2,'0')+'時台',x.opens]))+'</details>'+
        '<details class="insights-help"><summary>日別の推移を見る</summary>'+table(['日付','開いた回数','ユニーク','新規','再訪','判別不可'],data.daily.map(x=>[x.day,...numeric.map(k=>x[k])]))+'</details>':'')+
      '<details class="insights-help"><summary>データの見方・計測の範囲</summary>'+
      (data?'<p>詳細計測の記録開始：'+(data.details_started_at?esc(new Date(data.details_started_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})):'新形式の記録はまだありません')+'</p><p>新規／再訪を判別できない開き方：'+count(data.summary.unknown_opens)+'回。</p>':'')+
      '<p>ユニークは実人数ではなく匿名のブラウザー識別子の数です。端末変更や保存データの消去で別の訪問者になる場合があります。日別の新規はその日に初めて来たブラウザー、再訪は前日以前にも来たブラウザーです。期間の新規／再訪は期間開始日を基準にします。</p>'+
      '<p>流入元別のユニークは重複するため合計できません。Web検索の大きなカードは回数だけを合算しています。「流入元を判別できない」にはホーム画面からの起動やアプリへの復帰も含みます。流入元が渡らないアクセスや、過去の未記録分の内訳は復元できません。</p>'+
      '<p>位置情報・IP・参照元の全文URLは保存しません。許可した形式の投稿IDと記事IDは集計用に保存します。保存した履歴から集計するため、毎日の作業は不要です。詳細計測は開いた時刻、下の従来カウンターは受信時刻のため、遅延送信時には差が出ることがあります。運営者として確認済みのブラウザーは除外します。</p></details>';
    host.querySelector('select').onchange=e=>{period=e.target.value;data=null;generation++;busy=false;paint();void refresh();};
    host.querySelector('[data-reload]').onclick=()=>void refresh();
    host.querySelector('[data-export]').onclick=download;
    const buildButton=host.querySelector('[data-campaign-build]');
    if(buildButton)buildButton.onclick=()=>{
      if(!permitted())return;
      const output=host.querySelector('[data-campaign-output]'),status=host.querySelector('[data-campaign-status]');
      output.value='';
      try{
        const url=new URL(host.querySelector('[data-campaign-target]').value);
        const id=host.querySelector('[data-campaign-id]').value.trim();
        const source=host.querySelector('[data-campaign-source]').value;
        if(url.origin!=='https://reiki-ai-apps.github.io'||!/^\/AI-\/(?:articles\/article_[A-Za-z0-9_-]{8,90}\/|guides\/[a-z0-9-]{1,64}\/)?$/.test(url.pathname)||
          !/^[a-z0-9-]{1,64}$/.test(id)||!['x','youtube','instagram','note'].includes(source))throw Error('invalid');
        url.search='';url.hash='';url.searchParams.set('utm_source',source);url.searchParams.set('utm_medium',source==='youtube'?'video':'social');
        url.searchParams.set('utm_campaign','kizashi-'+id);output.value=url.href;
        status.textContent='作成しました。上のリンクをコピーして、この投稿だけに使ってください。';
      }catch{status.textContent='このアプリの記事URLと、半角小文字・数字・ハイフンだけの投稿IDを入力してください。';}
    };
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
    if(host.contains?.(document.activeElement)&&document.activeElement?.matches?.('input'))return;
    if(busy)return;busy=true;const current=++generation,requested=period;
    try{
      const result=await context.rpc('operator_access_insights',{p_period:requested});
      if(current!==generation||!permitted())return;
      if(result.error)throw result.error;
      if(!valid(result.data))throw new Error('invalid aggregate');
      data=result.data;paint();
      try{
        const report=await context.rpc('operator_campaign_insights',{p_days:14});
        if(current!==generation||!permitted())return;
        if(report.error||!validCampaigns(report.data))throw Error('campaign unavailable');
        campaignData=report.data;campaignMessage='';
      }catch{
        if(current!==generation||!permitted())return;
        campaignMessage=campaignData?'投稿別データの再取得に失敗しました。前回確認値を表示しています。':'投稿別データを取得できません。従来の集計はそのまま確認できます。';
      }
      paint();
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
      ...data.sources.map(x=>['流入元',sources[x.source],x.opens,x.unique_browsers]),
      ...(campaignData?[
        ['投稿別期間',campaignData.from,campaignData.through],['投稿ID','流入元','記事ID','開いた回数','ブラウザー','新規','後日再訪'],
        ...campaignData.campaigns.map(x=>[x.campaign,sources[x.source],x.landing,x.opens,x.unique_browsers,x.new_browsers,x.returned_browsers])]:[])];
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
