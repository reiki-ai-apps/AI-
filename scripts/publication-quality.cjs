// One publication text contract for generation, upgrades, release validation and tests.
const TERM_RULES=[
  ["GPU",/半導体|画像.{0,15}(処理|計算).{0,15}(装置|チップ)|大量の計算.{0,15}(チップ|装置)/],
  ["AIエージェント",/作業も順番|(?:代わりに|自律的に|自分で|自動で|自動的に).{0,25}(?:作業|操作|調べ|実行)|(?:作業|操作).{0,25}(?:自律的に|自動で|自分で)/],
  ["マルチモーダル",/(?:文章|文字|テキスト).{0,25}(?:画像|音声|動画).{0,35}(?:扱|処理|理解|組み合|読み取)|文章だけでなく/],
  ["API",/窓口|(?:ソフト|アプリ|プログラム|サービス).{0,30}(?:つな|連携|やり取り|呼び出)/]
];

function termExplanationIssues(value){
  const paragraphs=String(value||"").split(/\r?\n+/).filter(Boolean);
  const issues=[];
  for(const [term,meaning] of TERM_RULES){
    if(!paragraphs.some(part=>part.includes(term)))continue;
    // The explanation must be near the named term, not an unrelated word elsewhere.
    const explained=paragraphs.some(part=>{
      let index=part.indexOf(term);
      while(index>=0){
        if(meaning.test(part.slice(Math.max(0,index-40),index+term.length+130)))return true;
        index=part.indexOf(term,index+term.length);
      }
      return false;
    });
    if(!explained)issues.push('専門語「'+term+'」に説明がありません');
  }
  return issues;
}

function friendlyExplanationIssues(value){
  const detail=String(value||"").trim();
  const compactLength=detail.replace(/\s+/g,"").length;
  const paragraphs=detail.split(/\n+/).map(part=>part.trim()).filter(Boolean);
  const sentences=(detail.match(/[。！？!?]/g)||[]).length;
  const longest=detail.split(/(?<=[。！？!?])/).reduce((max,part)=>Math.max(max,part.replace(/\s+/g,"").length),0);
  const issues=[];
  if(compactLength<280||compactLength>440||paragraphs.length!==3||sentences<8||sentences>11||longest>85){
    issues.push("高校生向け解説の長さ・段落・文数が基準未達です");
  }
  issues.push(...termExplanationIssues(detail));
  if(/\bM&A\b|セキュリティリスク|業務プロセス|相互運用性|知識労働|AI依存傾向|注意喚起|競争構図|導入先選定/.test(detail)){
    issues.push("やさしい解説に言い換えていない業界語があります");
  }
  return issues;
}

function publicationTextIssues(item={}){
  const issues=friendlyExplanationIssues(item.detail);
  const normalize=value=>String(value||"").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu,"");
  const title=normalize(item.title),summary=normalize(item.raw_excerpt);
  if(title&&summary&&(title===summary||(summary.includes(title)&&summary.length<title.length+35))){
    issues.push("要約がタイトルの繰り返しです");
  }
  if(!/[ぁ-んァ-ヶ一-龠々]/.test([item.raw_excerpt,item.detail,item.change_summary,item.impact_summary,item.action_suggestion].join(""))){
    issues.push("日本語の解説がありません");
  }
  const unnatural=String(item.detail||"")+"\n"+String(item.action_suggestion||"");
  if(/^(?:まず[、,]\s*)?このニュースを(?:ひと|一)言で(?:いう|言う)と|^かんたんに言うと|すぐに全部のやり方を変える必要はありません|小さな作業から試すと安心です/.test(unnatural.trim())){
    issues.push("定型的で不自然な書き出し・結びがあります");
  }
  return issues;
}
module.exports={termExplanationIssues,friendlyExplanationIssues,publicationTextIssues};
