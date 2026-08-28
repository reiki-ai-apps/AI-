const CURRENT_PROMPT_VERSION="ai-radar-2026-08-28-v10-contextual-depth";
const SAFE_COMPOSITE_VERSION="ai-radar-2026-08-29-safe-composite-v1";
const MIN_COMPACT_CHARS=420;
const MAX_COMPACT_CHARS=720;

function compact(value){
  return String(value||"").replace(/\s+/g,"");
}

function sentences(value){
  return String(value||"").replace(/\r\n?/g,"\n").split(/(?<=[。！？!?])/)
    .map(value=>value.trim()).filter(Boolean).map(value=>/[。！？!?]$/.test(value)?value:value+"。");
}

function comparable(value){
  return compact(value).normalize("NFKC").toLowerCase().replace(/[、。！？!?「」『』（）()・：:]/g,"");
}

function grams(value,size=3){
  const text=comparable(value);
  const result=new Set();
  for(let index=0;index<=text.length-size;index++)result.add(text.slice(index,index+size));
  return result;
}

function isNearDuplicate(a,b){
  const left=comparable(a),right=comparable(b);
  if(!left||!right)return false;
  if(left===right)return true;
  const short=left.length<=right.length?left:right;
  const long=left.length>right.length?left:right;
  if(short.length>=20&&long.includes(short)&&short.length/long.length>=0.72)return true;
  const leftGrams=grams(left),rightGrams=grams(right);
  if(!leftGrams.size||!rightGrams.size)return false;
  let overlap=0;
  for(const gram of leftGrams)if(rightGrams.has(gram))overlap++;
  return overlap/Math.min(leftGrams.size,rightGrams.size)>=0.64;
}

function addUnique(target,value,prefix=""){
  for(const sentence of sentences(value)){
    let candidate=prefix?`${prefix}${sentence}`:sentence;
    candidate=candidate
      .replace(/ことが新しい。$/,"ことが新しい点です。")
      .replace(/こと。$/,"ことです。")
      .replace(/必要。$/,"必要です。");
    if(target.some(existing=>isNearDuplicate(existing,candidate)))continue;
    target.push(candidate);
    prefix="";
  }
}

function hasDeepFriendlyExplanation(value){
  const raw=String(value||"").trim();
  const paragraphs=raw.split(/\n+/).map(value=>value.trim()).filter(Boolean);
  const sentenceCount=(raw.match(/[。！？!?]/g)||[]).length;
  const length=compact(raw).length;
  return length>=MIN_COMPACT_CHARS&&length<=MAX_COMPACT_CHARS&&paragraphs.length>=3&&sentenceCount>=7;
}

function stageSentence(item){
  const stage=String(item.event_stage||"").trim();
  const scope=String(item.event_scope||"").trim();
  const messages={
    announced:"今回の情報は発表・報道段階で、実施や提供の完了まで確認されたものではありません。",
    planned:"現時点では計画段階で、開始時期や最終的な提供条件が変わる可能性があります。",
    beta:"現時点では試験提供の段階で、正式版では機能や利用条件が変わる可能性があります。",
    launched:"提供開始済みとして整理されていますが、利用できる地域・プラン・環境は個別に確認が必要です。",
    expanded:"提供範囲の拡大として整理されていますが、追加対象と従来対象の違いは公式条件で確認する必要があります。",
    investigating:"現在は調査段階で、原因・影響範囲・対応完了については確定していません。",
    fixed:"修正済みとして整理されていますが、対象バージョンや利用者側に必要な対応の確認が残ります。"
  };
  if(messages[stage])return messages[stage];
  if(scope)return `報道時点で確認できる対象範囲は「${scope}」です。`;
  return "現時点では、記事で確認できる事実と、まだ明らかでない条件を分けて読む必要があります。";
}

function termSentence(item){
  const text=[item.title,originalLegacyDetail(item),item.raw_excerpt,item.story_subject].join(" ");
  const definitions=[
    [/プロンプトインジェクション/,"プロンプトインジェクションとは、Webページなどに埋め込まれた命令をAIが正規の指示と誤認し、意図しない操作を行う攻撃です。"],
    [/AIエージェント/,"AIエージェントとは、質問へ答えるだけでなく、目的に沿って情報取得や画面操作など複数の手順を進める仕組みです。"],
    [/大規模言語モデル|LLM|大模型/,"大規模言語モデルは、大量の文章から言葉の関係を学び、質問への回答や文章・コードの生成を行うAIの中核技術です。"],
    [/オープンウェイト|オープンソースモデル/,"オープンウェイトモデルは学習済みの重みが公開され、利用者が自社環境で動かしたり調整したりできるモデルです。"],
    [/マルチモーダル/,"マルチモーダルモデルは、文章だけでなく画像や音声など複数種類の情報をまとめて扱えるAIです。"],
    [/ファウンドリー/,"半導体のファウンドリーは、自社ブランドの製品を売るのではなく、他社が設計したチップを受託製造する事業です。"],
    [/\bGPU\b|GPUなど半導体/,"GPUは大量の計算を並列に処理しやすく、AIモデルの学習と、学習済みモデルを動かす推論の両方に使われる半導体です。"],
    [/推論向けチップ|AI推論/,"AIの推論とは、学習済みモデルへ新しい入力を渡し、回答・予測・画像などの結果を生成する処理です。"],
    [/\bCRM\b|顧客関係管理/,"CRMは顧客情報や商談履歴をまとめ、営業や顧客対応に使う顧客関係管理の仕組みです。"],
    [/ローカル環境|ローカルで動作|Mac単体/,"ローカル実行は、処理を外部クラウドへ送らず手元の端末で行う方式で、通信の有無や端末性能が利用条件になります。"],
    [/データセンター/,"AI向けデータセンターは、GPUや電力・冷却設備を集め、大規模な学習や推論を支える計算拠点です。"],
    [/統合メモリ/,"統合メモリはCPUとGPUが同じメモリ領域を共有する仕組みで、端末上で扱えるAIモデルの大きさに関係します。"]
  ];
  const found=definitions.find(([pattern])=>pattern.test(text));
  return found?found[1]:"";
}

function mechanismSentence(item){
  const type=String(item.event_type||"").trim();
  const text=[item.title,item.detail,item.story_subject].join(" ");
  const byType={
    release:"発表と実際の提供開始は同じではなく、利用者に届く範囲は地域、料金プラン、対応環境などの条件で決まります。",
    pricing:"料金変更は表示価格だけでなく、利用量の単位、無料枠、既存契約への適用時期まで確認して初めて実際の負担が分かります。",
    funding:"資金調達は企業が開発や設備投資に使う資金を外部から得る動きで、調達額だけでは資金使途や事業成果までは確定しません。",
    security:"セキュリティ情報では、問題の発見、影響範囲の確認、修正の提供、利用者側の対応完了を分けて見る必要があります。",
    policy:"政策・規制の情報は、提案、承認、施行で効力が異なり、対象地域や事業者の範囲によって実務への影響が変わります。",
    partnership:"提携の発表は協力範囲を示すものですが、共同製品、提供時期、料金、責任分担が示されるまでは利用者側の変化は確定しません。",
    acquisition:"買収は経営権や事業資産の移動を伴いますが、発表、契約締結、規制審査、完了は別の段階です。",
    research:"研究発表は新しい手法や評価結果を示す段階で、製品として利用できることや、別条件でも同じ性能になることを意味しません。"
  };
  if(byType[type])return byType[type];
  if(/決算|売上|利益|業績/.test(text))return "決算は一定期間の売上や利益を示す資料で、AI需要の強さを見るには製品別売上、見通し、設備投資など内訳の確認が必要です。";
  if(/株価|市場/.test(text))return "株価の反応は将来への期待も含むため、価格の上昇だけで事業の成長やAI需要の持続性が確定したとは判断できません。";
  if(/退社|退任|就任|人事|再編/.test(text))return "経営・技術部門の人事は方針や実行体制に関わりますが、後任、権限の移動、既存計画の変更が示されるまでは影響範囲は確定しません。";
  if(/投資|出資|資金/.test(text))return "投資の発表は資金関係を示しますが、契約条件、実行時期、資金の使い道が示されるまで事業への具体的効果は確定しません。";
  return "この動きの意味を判断するには、発表された事実と、提供条件・実施時期・対象範囲など未確定の条件を分けて確認する必要があります。";
}

function originalLegacyDetail(item){
  if(item&&item.friendly_explanation_source==="verified_fields_safe_composite"){
    let first=String(item.detail||"").split(/\n+/)[0].trim();
    const raw=String(item.raw_excerpt||"").trim();
    if(raw&&first.endsWith(raw))first=first.slice(0,-raw.length).trim();
    return first;
  }
  return String(item&&item.detail||"").trim();
}

function buildLegacyDeepFriendlyExplanation(item){
  if(hasDeepFriendlyExplanation(item&&item.detail)&&item.friendly_explanation_source!=="verified_fields_safe_composite")return String(item.detail).trim();

  const first=[];
  const second=[];
  const third=[];
  addUnique(first,originalLegacyDetail(item));

  addUnique(second,termSentence(item||{}));
  addUnique(second,mechanismSentence(item||{}));
  addUnique(second,item&&item.change_summary,"今回の変化として、");
  addUnique(second,item&&item.impact_summary,"この動きが重要なのは、");

  addUnique(third,item&&item.action_suggestion,"次に確認するなら、");
  const entity=String(item&&item.primary_entity||"").trim();
  const subject=String(item&&item.story_subject||"").trim();
  if(entity&&subject)addUnique(third,`今回の主体は${entity}で、対象となっているのは「${subject}」です。`);
  const slots=Array.isArray(item&&item.fact_slots)?item.fact_slots:[];
  for(const slot of slots.slice(0,2)){
    const scope=String(slot&&slot.scope||"").trim();
    const value=String(slot&&slot.value||"").trim();
    if(scope&&value)addUnique(third,`確認できる条件として、${scope}は「${value}」とされています。`);
  }
  addUnique(third,stageSentence(item||{}));

  const total=()=>compact([...first,...second,...third].join("")).length;
  const count=()=>[...first,...second,...third].length;
  if(total()<MIN_COMPACT_CHARS||count()<7){
    addUnique(third,"情報元にない理由や効果は補わず、確認できる内容と未確定の内容を分けて判断する必要があります。");
  }
  if(total()<MIN_COMPACT_CHARS||count()<7){
    const source=String(item&&item.source_name||"").trim();
    addUnique(third,source?`この解説は「${source}」の公開内容を基にしており、条件の更新は情報元で確認する必要があります。`:"利用条件・対象範囲・提供時期は、発表主体の最新情報と照合する必要があります。");
  }
  if(count()<7)addUnique(third,"続報で条件が更新された場合は、現在の説明より新しい一次情報を優先してください。");

  // 既存の深い本文は触らず、旧形式だけを読みやすい3段落へ整える。
  // 720字を超える場合は、追加情報を後ろから外して文の途中では切らない。
  while(total()>MAX_COMPACT_CHARS&&third.length>2)third.splice(third.length-2,1);
  while(total()>MAX_COMPACT_CHARS&&second.length>2)second.pop();
  while(total()>MAX_COMPACT_CHARS&&first.length>3)first.pop();

  return [first.join(""),second.join(""),third.join("")].map(value=>value.trim()).filter(Boolean).join("\n\n");
}

function upgradeFriendlyExplanationItem(item){
  if(!item||typeof item!=="object")return item;
  if(hasDeepFriendlyExplanation(item.detail)&&item.friendly_explanation_source!=="verified_fields_safe_composite")return item;
  const detail=buildLegacyDeepFriendlyExplanation(item);
  return {
    ...item,
    detail,
    enrichment_version:SAFE_COMPOSITE_VERSION,
    friendly_explanation_source:"verified_fields_safe_composite"
  };
}

module.exports={
  CURRENT_PROMPT_VERSION,
  SAFE_COMPOSITE_VERSION,
  MIN_COMPACT_CHARS,
  MAX_COMPACT_CHARS,
  hasDeepFriendlyExplanation,
  buildLegacyDeepFriendlyExplanation,
  upgradeFriendlyExplanationItem
};
