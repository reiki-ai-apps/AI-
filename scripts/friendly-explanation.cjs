const CURRENT_PROMPT_VERSION="ai-radar-2026-08-29-v12-student-clear";
const SAFE_COMPOSITE_VERSION="ai-radar-2026-08-29-student-composite-v18";
const TARGET_COMPACT_CHARS=190;
const MIN_COMPACT_CHARS=170;
const MAX_COMPACT_CHARS=310;
const MIN_SENTENCES=5;
const MAX_SENTENCES=7;
const MAX_SENTENCE_CHARS=85;

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
  return overlap/Math.min(leftGrams.size,rightGrams.size)>=0.45;
}

function toStudentJapanese(value){
  let text=String(value||"").trim();
  const replacements=[
    [/目的は人工知能（AI）技術を中核に据え、事業構造の変革を加速させることだという。/g,"目的は、AIを中心に会社の仕事の進め方を変えることです。"],
    [/目的はAI技術を中心に置き、会社の仕事の進め方を大きく変えることを加速させることということです。/g,"目的は、AIを中心に会社の仕事の進め方を変えることです。"],
    [/パナソニックHDが技術部門を再編し、AIを中核とした事業変革を加速する方針を示した。/g,"パナソニックHDは、AIを中心に仕事の進め方を変えるため、研究や開発の部署を組み直す方針です。"],
    [/パナソニックホールディングスが技術部門を再編し、AIを中核とした事業変革を加速する方針を示した。?/g,"パナソニックHDは、AIを中心に仕事の進め方を変えるため、研究や開発の部署を組み直す方針です。"],
    [/パナソニックホールディングスが技術部門を再編し、AIを中核とした会社の仕事の進め方を変えることを加速する方針を示した。?/g,"パナソニックHDは、AIを中心に仕事の進め方を変えるため、研究や開発の部署を組み直す方針です。"],
    [/NVIDIAの好調な四半期決算が改めて確認されたこと。/g,"NVIDIAは、好調な第2四半期の決算を発表しました。"],
    [/AI関連投資の拡大が業績を押し上げているとされる。/g,"AIに使うお金が増え、NVIDIAの売上や利益を伸ばしているとされています。"],
    [/NVIDIAの業績はAI関連半導体需要の強さを示す指標であり、日本の半導体・AIインフラ関連企業の投資判断にも影響する可能性がある。/g,"NVIDIAの決算を見ると、AI向け半導体がどれだけ求められているかが分かります。日本の半導体やAI設備の会社がお金を使う判断にも影響する可能性があります。"],
    [/大手電機メーカーの技術戦略転換は、関連部品・サービス業界や社内の雇用・人事体制にも波及する可能性がある。/g,"この変化は、関連会社の仕事や社内の採用にも影響する可能性があります。"],
    [/クラウド経由のトークン課金なしに動作するローカル型AIエージェント端末が新たに発表された。/g,"PerplexityとNVIDIAは、外部のAIサービスへデータを送らず、端末内で動かせるAI端末を発表しました。利用した文字量に応じた料金は、かからないとしています。"],
    [/企業や個人がAI利用コストを気にせず継続的に活用できる可能性があり、データをローカルに留めたいユーザーにも影響する。/g,"使うたびにかかる料金を抑えながら、AIを続けて利用できる可能性があります。データを外部へ送りたくない人にも選択肢が増えます。"],
    [/OpenAIがAIエージェントによる自律的なシステム侵入事例を公式に報告した点が新しい。/g,"OpenAIは、AIが人の指示を待たずにHugging Faceのシステムへ侵入した事例を報告しました。Hugging Faceは、AIを公開・共有できるサービスです。"],
    [/業務にAIエージェントを導入する企業にとって、自律型AIが新たなセキュリティリスクになり得る点への注意が必要になる。/g,"会社でこのようなAIを使う場合、AIが勝手に危険な操作をする可能性がある点へ注意が必要です。"],
    [/OpenAIがHugging Face侵害についての公式レポートを公開したことです。/g,"対象は、AIを公開・共有できるサービス「Hugging Face」です。"],
    [/M5 Ultraが最大512GBのメモリを搭載し、大型AIモデルのローカル実行を可能にしたことが新たに発表された。/g,"Appleは、最大512GBのメモリを選べる「M5 Ultra」を発表しました。高性能なAIを、自分のMacだけで動かせるとしています。"],
    [/Anthropicがセキュリティ防御用途でのモデル活用拡大とOSS向け3500万ドルのクレジット提供を新たに発表しました。/g,"Anthropicは、AIを安全対策に使う取り組みを広げます。だれでも中身を確認・改良できるソフト向けに、3500万ドル分のAI利用枠も用意します。"],
    [/NVIDIAがサムスン電子のファウンドリー製AI推論チップを初めて本格商用化し、買収済みのGlock技術を実サービスに投入する動きが明らかになった。/g,"NVIDIAは、サムスンが製造するAI向け半導体を、初めて本格的に販売へ使います。買収したGlockの技術も、実際のサービスへ取り入れる計画です。"],
    [/DeepSeekが画像対応のマルチモーダル実験モデル「V4-Flash-Vision-Exp」を新たに公開しました。/g,"DeepSeekは、文章と画像を扱える試験中のAI「V4-Flash-Vision-Exp」を公開しました。"],
    [/Perplexityの売上高急増と、Nvidiaによる巨額買収交渉の観測が同時に報じられました。/g,"Perplexityの売上が大きく増え、NVIDIAが会社の買収を話し合っていると報じられました。"],
    [/MetaがManusに保有していた株式をテンセントが引き受け、テンセントが筆頭株主となった。/g,"テンセントは、Metaが持っていたManusの株式を買い取りました。これにより、Manusの株を最も多く持つ会社になりました。"],
    [/ReplitのトップがAIを使って人の手を減らすの会社づくりについての考えを公に語った。/g,"Replitの経営トップは、AIに仕事を任せて人の手間を減らす会社づくりについて話しました。"],
    [/限定的だったClaude in Chromeの対象が全有料プランへ広がった。公式情報ではCoworkとClaude Codeは一般提供だが、Chromeサイドパネルは引き続きベータで、利用経路によって状態が異なる。/g,"Anthropicは、Chrome上でClaudeにページ操作を任せられる機能を、すべての有料プランへ広げました。ページを読んだり、クリックや入力をしたりできます。ただし、この機能はまだ試験版です。"],
    [/ブラウザでの比較、入力、転記、動作確認を会話から実行できるため、定型的な画面操作をAIへ任せる選択肢が増える。一方、機密画面を扱う組織では権限設計と操作確認が導入条件になる。/g,"比べる、入力する、書き写すといった作業をAIへ任せやすくなります。会社の秘密や個人情報が見える画面で使う場合は、利用できる人と操作の記録を確認する必要があります。"],
    [/AIチップ企業がモデル・ソフトウェア企業への投資を拡大することで、AI業界の勢力図や技術の主導権争いに影響し、関連企業の株式・提携動向にも波及し得る。/g,"NVIDIAがAIソフトの会社にもお金を出すことで、会社どうしの力関係が変わる可能性があります。関連会社の株価や協力関係にも影響しそうです。"],
    [/AIチップ企業がモデル・ソフトウェア企業への投資を拡大することで、AI業界の勢力図や技術の主導権争いに影響し、関連企業の株式・提携動向にも波及する可能性がある。/g,"NVIDIAがAIソフトの会社にもお金を出すことで、会社どうしの力関係が変わる可能性があります。関連会社の株価や協力関係にも影響しそうです。"],
    [/AI半導体の供給網や技術提携の動向は、日本企業が調達するAIサーバーやクラウドサービスのコスト・性能にも間接的に影響し得る。/g,"この協力が進むと、日本企業が使うAI用コンピューターの価格や性能にも影響する可能性があります。"],
    [/PerplexityがNVIDIAと共同でローカル実行型のAIエージェント「Portable Computer」を新たに発表した。/g,"PerplexityとNVIDIAは、外部へデータを送らず、端末内で動かせるAI端末「Portable Computer」を発表しました。"],
    [/AIコーディング支援ツール市場の競争構図が変わる可能性があり、企業のAI導入先選定にも影響を与えうる。/g,"プログラム作りを助けるAIの競争が変わる可能性があります。会社がどのAIを選ぶかにも影響しそうです。"],
    [/暗号化命令によってGrokのデータ外部送信とGeminiの安全ガードレール回避が可能であることが新たに実証された。/g,"読めない形に変えた命令を使い、Grokからデータを外へ送らせたり、Geminiの安全対策をすり抜けたりできると実験で示されました。"],
    [/NVIDIAが金融大手6社と5000億ドル規模のAIインフラ整備で資金調達提携を発表した。/g,"NVIDIAは、AIを動かす施設を整えるため、金融大手6社と資金面で協力します。規模は5000億ドルとされています。"],
    [/NVIDIAが金融大手6社と5000億ドル規模のAIインフラ整備で提携した。/g,"NVIDIAは、AIを動かす施設を整えるため、金融大手6社と資金面で協力します。規模は5000億ドルとされています。"],
    [/NVIDIAが金融大手6社と5000億ドル規模のAIインフラ資金調達で提携した。/g,"NVIDIAは、AIを動かす施設を整えるため、金融大手6社と資金面で協力します。規模は5000億ドルとされています。"],
    [/英国の金融規制当局が、若年層のAI投資助言依存について公式に警告した。/g,"英国の金融当局は、若い人がAIの投資相談を信じすぎていると注意を呼びかけました。"],
    [/英FCAがZ世代の投資助言におけるAI依存傾向について警告した(?:こと)?。?/g,"FCAは、AIの答えを専門家より信じる人がいることを問題にしています。"],
    [/エヌビディア株の7営業日続落という新たな市場動向と、それに続く決算発表への注目が報じられた。/g,"NVIDIAの株価は、7営業日続けて下がりました。その後に出る決算へ注目が集まっています。"],
    [/ブリン氏の圧力を受けてアルファベットがAI指導部を再編した点が新しい動き。セルゲイ・ブリン氏がDeepMindにGemini開発の加速を求めている。/g,"Googleの共同創業者ブリン氏は、Geminiの開発を速めるようDeepMindへ求めました。Googleの親会社Alphabetは、AI開発をまとめる人たちの役割も変えました。"],
    [/ブリン氏の圧力を受けてアルファベットがAI指導部を再編した点が新しい動き。/g,"Googleの共同創業者ブリン氏は、Geminiの開発を速めるようDeepMindへ求めました。Googleの親会社Alphabetは、AI開発をまとめる人たちの役割も変えました。"],
    [/AnthropicがAI機器連携のための新標準「MHS」を新たに発表した。/g,"Anthropicは、AI機器どうしをつなぐ新しい共通ルール「MHS」を発表しました。"],
    [/ただし配信された情報はタイトルのみで、共通ルールの技術の詳しい決まり、対応する機器やソフトウェア、使い始められる時期などの詳しい内容はまだ発表されていない。/g,"ただし、分かっているのは記事のタイトルにある内容だけです。対応する機器や使い始められる時期は、まだ発表されていません。"],
    [/規格の詳細が不明なため現時点での具体的な影響は判断できないが、対応が進めばAI機器間の相互運用性向上につながる可能性がある。/g,"まだ詳しい内容は分からないため、今すぐの影響は判断できません。対応が進めば、違うAI機器を一緒に使いやすくなる可能性があります。"],
    [/AIの普及によりコンサルティング業界を含む知識労働の採用基準が変わりつつあることは、日本企業の人材戦略にも参考になる可能性がある。/g,"AIが決まった手順の仕事を行うようになると、会社が人に求める力も変わります。日本企業が人を採用したり育てたりするときの参考になる可能性があります。"],
    [/画像生成AIを利用するクリエイターやツール開発者にとって、編集機能や生成の多様性が広がる可能性がある。/g,"画像生成AIを使う人にとって、編集の方法や作れる画像の種類が増える可能性があります。"],
    [/画像生成AIを利用する画像などを作る人やアプリを作る人にとって、編集機能や作れる内容の種類が広がる可能性がある。/g,"画像生成AIを使う人にとって、編集の方法や作れる画像の種類が増える可能性があります。"],
    [/同社のGPUなど半導体製品はAIモデルの学習・推論に広く用いられており、生成AIブームの継続が業績を押し上げている構図が続いているとみられる。/g,"NVIDIAの半導体は、AIを学習させたり、回答を作らせたりする計算に使われます。文章や画像を作るAIが広がり、売上や利益を伸ばしていると考えられています。"],
    [/人工知能（AI）/g,"AI"],
    [/技術部門の再編/g,"研究・開発を担当する部署の組み直し"],
    [/事業構造の変革/g,"会社の仕事の進め方を大きく変えること"],
    [/事業変革/g,"会社の仕事の進め方を変えること"],
    [/中核に据え/g,"中心に置き"],
    [/業務プロセス/g,"仕事の手順"],
    [/技術戦略/g,"技術をどう使うかの計画"],
    [/事業領域/g,"事業の分野"],
    [/人員規模/g,"関わる人数"],
    [/投資規模/g,"使うお金の大きさ"],
    [/実施時期/g,"始める時期"],
    [/競争環境/g,"会社どうしの競争"],
    [/技術投資/g,"新しい技術に使うお金"],
    [/定型的な業務/g,"決まった手順の仕事"],
    [/AIモデルの学習・推論/g,"AIを学習させたり、回答を作らせたりする計算"],
    [/大型AIモデル/g,"高性能なAI"],
    [/ローカル実行/g,"自分の端末だけで動かすこと"],
    [/ローカル型/g,"手元の端末で動く"],
    [/自分の端末だけで動かすこと型/g,"自分の端末だけで動く"],
    [/アーキテクチャ/g,"基本の仕組み"],
    [/安全ガードレール/g,"危険な回答を防ぐ仕組み"],
    [/ガードレール/g,"危険な回答を防ぐ仕組み"],
    [/脆弱性/g,"安全上の弱点"],
    [/性的ディープフェイク/g,"本人の許可なく作られた偽の性的動画"],
    [/ディープフェイク/g,"本物のように見える偽の画像や動画"],
    [/暗号化プロンプト/g,"読めない形に変えたAIへの指示"],
    [/プロンプト/g,"AIへの指示"],
    [/モデルゲートウェイ/g,"複数のAIをまとめて呼び出す窓口"],
    [/ゲートウェイ/g,"サービスを呼び出す窓口"],
    [/無料トライアル/g,"無料のお試し期間"],
    [/トライアル/g,"お試し期間"],
    [/エンジニア/g,"技術者"],
    [/指導部/g,"経営・開発をまとめる人たち"],
    [/法人全体/g,"会社全体"],
    [/供給網/g,"製品が届くまでの流れ"],
    [/技術プログラム/g,"技術を紹介する企画"],
    [/AIサーバー/g,"AIを動かす大型コンピューター"],
    [/クラウドサービス/g,"インターネット経由で使うサービス"],
    [/AIアシスタント/g,"作業を助けるAI"],
    [/パーソナルAGI/g,"一人ひとりを幅広く助ける高性能AI"],
    [/一般提供/g,"正式に使える状態"],
    [/全社導入/g,"会社全体で使うこと"],
    [/AI推論チップ/g,"学習済みAIが答えを作るための半導体"],
    [/OSS向け/g,"だれでも中身を確認・改良できるソフト向け"],
    [/オープンソース開発者/g,"中身を公開しているソフトを作る人"],
    [/筆頭株主/g,"株を最も多く持つ会社"],
    [/株主構成/g,"だれがどれだけ株を持つか"],
    [/M&A/g,"会社の合併や買収"],
    [/自律型AI/g,"人の指示を待たずに作業するAI"],
    [/自律的なシステム侵入/g,"人の指示を待たずにシステムへ侵入すること"],
    [/セキュリティリスク/g,"安全上の危険"],
    [/商用化/g,"販売や有料サービスへ使うこと"],
    [/実サービス/g,"実際のサービス"],
    [/モデル活用/g,"AIの利用"],
    [/クレジット提供/g,"無料で使える利用枠の提供"],
    [/生成AIブームの継続/g,"文章や画像を作るAIへの関心が続いていること"],
    [/業績を押し上げている構図/g,"売上や利益を伸ばしている状況"],
    [/スキルセット/g,"必要な知識や能力"],
    [/人材採用のあり方/g,"人を採用する考え方"],
    [/知識労働/g,"考えることが中心の仕事"],
    [/人材戦略/g,"人を採用し育てる計画"],
    [/コンサルティング会社/g,"企業の課題解決を助ける会社"],
    [/コンサル業界/g,"企業の課題解決を助ける業界"],
    [/最高経営責任者\(CEO\)/g,"経営トップ"],
    [/のCEO/g,"の経営トップ"],
    [/CEO/g,"経営トップ"],
    [/相互運用性/g,"別々の機器やサービスを一緒に使いやすくすること"],
    [/AI機器連携/g,"AI機器どうしをつなぐこと"],
    [/AI機器同士の連携/g,"AI機器どうしをつなぐこと"],
    [/AI機器間の/g,"違うAI機器を"],
    [/AIインフラ/g,"AIを動かす設備"],
    [/インフラ/g,"設備"],
    [/プラットフォーム/g,"サービス"],
    [/チェンジログ/g,"更新記録"],
    [/技術的な仕様/g,"技術の詳しい仕組み"],
    [/仕様/g,"詳しい仕組み"],
    [/標準規格名/g,"共通ルール名"],
    [/標準化/g,"共通ルールにそろえること"],
    [/新標準/g,"新しい共通ルール"],
    [/標準/g,"共通ルール"],
    [/規格/g,"共通ルール"],
    [/導入時期/g,"使い始められる時期"],
    [/延長線上にある/g,"これまでの取り組みの続きである"],
    [/経緯/g,"流れ"],
    [/評価額/g,"会社の価値"],
    [/言及した/g,"話した"],
    [/自律運営型/g,"AIを使って人の手を減らす"],
    [/自律的に/g,"人の指示を待たずに"],
    [/モデル発表サイクル/g,"新しいAIモデルを発表する間隔"],
    [/ドラフトモード/g,"素早く試作するモード"],
    [/ランダムスタイル機能/g,"見た目を自動で変える機能"],
    [/ランダムスタイル/g,"見た目を自動で変える方法"],
    [/ローカル動作/g,"手元の端末で動く"],
    [/トークン課金/g,"使った文字量などに応じた料金"],
    [/4Kアップスケーリング/g,"映像を4Kの高画質にする機能"],
    [/フレーム補間/g,"映像の間をなめらかにつなぐ機能"],
    [/提供チャネル/g,"使える場所"],
    [/業務効率化/g,"仕事の時間や手間を減らすこと"],
    [/投資判断/g,"お金を出すかどうかの判断"],
    [/需給/g,"必要な量と供給できる量"],
    [/投資動向/g,"お金の流れ"],
    [/具体的な施策/g,"具体的な取り組み"],
    [/資金使途/g,"お金の使い道"],
    [/調達の形態/g,"お金を集める方法"],
    [/指導体制/g,"経営・開発のまとめ役"],
    [/AI投資サイクルの試金石/g,"AIへの投資が続くかを見きわめる材料"],
    [/サイドパネル/g,"ブラウザ横の操作画面"],
    [/機密画面/g,"外部に見せられない情報を含む画面"],
    [/権限設計/g,"誰がどこまで使えるかの設定"],
    [/AI投資助言依存/g,"AIの投資相談に頼りすぎること"],
    [/投資助言/g,"投資についての助言"],
    [/技術をどう使うかの計画転換/g,"AIを使う方針の変化"],
    [/関連部品・サービス業界/g,"部品やサービスを作る会社"],
    [/雇用・人事体制/g,"人の採用や部署の形"],
    [/クリエイター/g,"画像などを作る人"],
    [/ツール開発者/g,"アプリを作る人"],
    [/生成の多様性/g,"作れる内容の種類"],
    [/コンサルティング業界/g,"企業の課題解決を助ける業界"],
    [/採用基準/g,"人を採用する基準"],
    [/AI関連半導体需要の強さを示す指標/g,"AI向け半導体がどれだけ求められているかを見る材料"],
    [/半導体・AIインフラ関連企業/g,"半導体やAI設備に関わる会社"],
    [/AIチップ企業/g,"AI向け半導体を作る会社"],
    [/勢力図/g,"会社どうしの力関係"],
    [/技術の主導権争い/g,"どの会社が技術の中心になるかの競争"],
    [/株式・提携動向/g,"株価や会社どうしの協力"],
    [/AI導入担当者/g,"会社でAIを取り入れる担当者"],
    [/コスト/g,"費用"],
    [/可視化/g,"分かりやすく見えるようにすること"],
    [/予算管理/g,"使うお金の管理"],
    [/金融業界/g,"銀行などお金を扱う会社"],
    [/半導体・データセンター関連の需給や投資動向/g,"半導体やAI施設の不足、お金の流れ"],
    [/半導体・データセンター関連の必要な量と供給できる量やお金の流れ/g,"半導体やAI施設の不足、お金の流れ"],
    [/ベータ版|ベータ/g,"試験版"],
    [/リリース/g,"公開"],
    [/波及し得る|波及する/g,"広がる可能性がある"],
    [/代替する/g,"代わりに行う"],
    [/注視する/g,"注意して見る"],
    [/望ましい/g,"よい"],
    [/明らかにされていない/g,"まだ発表されていない"],
    [/明らかではない/g,"まだ分からない"],
    [/詳細な内容/g,"詳しい内容"],
    [/具体的な内容/g,"詳しい内容"],
    [/具体的な影響/g,"どんな影響があるか"],
    [/との見方を示している/g,"と考えています"],
    [/と述べた/g,"と話しました"],
    [/示されている/g,"書かれています"],
    [/記載されている/g,"書かれています"],
    [/方針を示した。/g,"方針を示しました。"],
    [/新たに発表した。/g,"新たに発表しました。"],
    [/発表した。/g,"発表しました。"],
    [/公開された。/g,"公開されました。"],
    [/追加された。/g,"追加されました。"],
    [/実施した。/g,"実施しました。"],
    [/行った。/g,"行いました。"],
    [/報告した。/g,"報告しました。"],
    [/指摘した。/g,"指摘しました。"],
    [/とされる。/g,"とされています。"],
    [/である。/g,"です。"],
    [/となる。/g,"となります。"],
    [/とされる。/g,"とされています。"],
    [/と報じられた。/g,"と報じられました。"],
    [/と報じられた。/g,"と報じられました。"],
    [/と報じられている。/g,"と報じられています。"],
    [/と伝えられている。/g,"と伝えられています。"],
    [/だという。/g,"ということです。"],
    [/とみられる。/g,"と考えられています。"],
    [/広がった。/g,"広がりました。"],
    [/拡大された。/g,"広がりました。"],
    [/示された。/g,"示されました。"],
    [/判明した。/g,"分かりました。"],
    [/明らかになった。/g,"分かりました。"],
    [/異なる。/g,"異なります。"],
    [/必要になる。/g,"必要になります。"],
    [/可能になる。/g,"できるようになります。"],
    [/期待される。/g,"期待されています。"],
    [/影響し得る。/g,"影響する可能性があります。"],
    [/影響しうる。/g,"影響する可能性があります。"],
    [/影響する。/g,"影響します。"],
    [/指摘される。/g,"指摘されています。"],
    [/脅かしている。/g,"傷つける危険があります。"],
    [/警告した。/g,"警告しました。"],
    [/参加した。/g,"参加しました。"],
    [/実証した。/g,"実証しました。"],
    [/提出した。/g,"提出しました。"],
    [/下落した。/g,"下落しました。"],
    [/採用した。/g,"採用しました。"],
    [/出資した。/g,"出資しました。"],
    [/停止した。/g,"停止しました。"],
    [/提携した。/g,"提携しました。"],
    [/求めている。/g,"求めています。"],
    [/注目されている。/g,"注目されています。"],
    [/示している。/g,"示しています。"],
    [/強化された。/g,"強化されました。"],
    [/報告された。/g,"報告されました。"],
    [/新たに名を連ねた。/g,"新しく参加しました。"],
    [/新たに実証された。/g,"新しい実験で確認されました。"],
    [/新たに示された。/g,"新しく示されました。"],
    [/新たに分かりました。/g,"新しく分かりました。"],
    [/必要がある。/g,"必要があります。"],
    [/可能性がある。/g,"可能性があります。"],
    [/確認できない。/g,"確認できません。"],
    [/分かっていない。/g,"まだ分かっていません。"],
    [/新しい情報。/g,"新しい情報です。"],
    [/新しい進展。/g,"新しい動きです。"],
    [/点が新しい。/g,"点が新しい動きです。"],
    [/機能機能/g,"機能"],
    [/共通ルール共通ルール名/g,"共通ルール名"],
    [/こと。/g,"ことです。"]
  ];
  for(const [pattern,replacement] of replacements)text=text.replace(pattern,replacement);
  return text
    .replace(/今回の変化として[、,]\s*/g,"")
    .replace(/この動きが重要なのは[、,]\s*/g,"")
    .replace(/次に確認するなら[、,]\s*/g,"")
    .replace(/可能性がある可能性があります。/g,"可能性があります。")
    .replace(/\s+/g," ")
    .trim();
}

function addUnique(target,value,prefix=""){
  for(const sentence of sentences(toStudentJapanese(value))){
    let candidate=prefix?`${prefix}${sentence}`:sentence;
    candidate=candidate
      .replace(/ことが新しい。$/,"ことが新しい点です。")
      .replace(/こと。$/,"ことです。")
      .replace(/必要。$/,"必要です。")
      .replace(/である。$/,"です。")
      .replace(/発表した。$/,"発表しました。")
      .replace(/公開した。$/,"公開しました。")
      .replace(/報告した。$/,"報告しました。")
      .replace(/指摘した。$/,"指摘しました。")
      .replace(/報じられた。$/,"報じられました。")
      .replace(/とされる。$/,"とされています。");
    if(target.some(existing=>isNearDuplicate(existing,candidate)))continue;
    target.push(candidate);
    prefix="";
  }
}

function beginnerImpactSentence(value){
  const hardWords=/競争構図|動向|指標|進化速度|注意喚起|AI依存傾向|導入先選定|基盤選定|実用性|効率化|資本関係|法整備|戦略|エコシステム|波及|主導権/;
  return sentences(toStudentJapanese(value))
    .filter(sentence=>compact(sentence).length<=68&&!hardWords.test(sentence))
    .slice(0,1)
    .join("");
}

// 関数名は既存テストとの互換性のため維持する。判定内容は高校生向けR3基準。
function hasDeepFriendlyExplanation(value){
  const raw=String(value||"").trim();
  const paragraphs=raw.split(/\n+/).map(value=>value.trim()).filter(Boolean);
  const sentenceList=sentences(raw);
  const length=compact(raw).length;
  const longest=sentenceList.reduce((max,sentence)=>Math.max(max,compact(sentence).length),0);
  return length>=MIN_COMPACT_CHARS&&length<=MAX_COMPACT_CHARS&&
    paragraphs.length>=2&&paragraphs.length<=3&&
    sentenceList.length>=MIN_SENTENCES&&sentenceList.length<=MAX_SENTENCES&&longest<=MAX_SENTENCE_CHARS;
}

function stageSentence(item){
  const stage=String(item.event_stage||"").trim();
  const scope=String(item.event_scope||"").trim();
  const messages={
    announced:"今は発表された段階で、記事だけでは詳しい数字や条件まで分かりません。正式な内容は、情報元の資料で確認する必要があります。",
    planned:"今は計画の段階です。開始日や内容が変わる可能性があります。",
    beta:"今は試験中です。正式版では機能や使える条件が変わる可能性があります。",
    launched:"すでに提供は始まっています。ただし、地域や料金プランによって使えない場合があります。",
    expanded:"使える範囲が広がりました。新しく対象になった地域や料金プランは確認が必要です。",
    investigating:"今は調査中です。原因や影響を受ける人の範囲は、まだ決まっていません。",
    fixed:"問題は修正されたとされています。自分が使う版で対応済みかは確認が必要です。",
    paused:"現在は停止しています。再開する時期や利用者への影響は、まだ分かっていません。",
    delayed:"予定より遅れています。新しい開始日が正式に発表されたか確認が必要です。"
  };
  if(messages[stage])return messages[stage];
  if(scope&&scope!=="不明")return `今回、記事で分かる対象は「${scope}」までです。詳しい条件は情報元で確認する必要があります。`;
  return "記事だけでは、詳しい条件までは分かりません。新しい発表が出るか確認が必要です。";
}

function termSentence(item){
  const text=[item.title,originalLegacyDetail(item),item.raw_excerpt,item.story_subject].join(" ");
  const definitions=[
    [/ユニコーン企業/,"ユニコーン企業は、会社の価値が10億ドルを超え、まだ株式市場に上場していない会社です。"],
    [/スタートアップ/,"スタートアップは、新しい事業を短期間で大きく育てようとする会社です。"],
    [/プロンプトインジェクション/,"プロンプトインジェクションは、Webページの悪い命令をAIが本物の指示だと勘違いする攻撃です。"],
    [/AIエージェント/,"AIエージェントは、答えるだけでなく、調べる・入力するなどの作業も順番に進めるAIです。"],
    [/大規模言語モデル|LLM|大模型/,"大規模言語モデルは、大量の文章を学び、質問への回答や文章作成を行うAIです。"],
    [/オープンウェイト|オープンソースモデル/,"オープンウェイトモデルは、AIの中身の一部が公開され、自分のパソコンや会社の環境でも動かしやすいモデルです。"],
    [/マルチモーダル/,"マルチモーダルは、文章だけでなく、画像や音声も一緒に扱える仕組みです。"],
    [/ファウンドリー/,"半導体のファウンドリーは、ほかの会社が設計したチップを代わりに作る会社です。"],
    [/\bGPU\b|GPUなど半導体/,"GPUは、AIに必要な大量の計算を速く進める半導体です。"],
    [/推論向けチップ|AI推論/,"AIの推論は、学習済みのAIが質問への答えや画像などを作る処理です。"],
    [/\bAPI\b/,"APIは、別のサービスからAIの機能を呼び出すための窓口です。"],
    [/\bCRM\b|顧客関係管理/,"CRMは、顧客情報や商談の記録をまとめる仕組みです。"],
    [/ローカル環境|ローカルで動作|Mac単体/,"ローカル実行は、外部のクラウドへ送らず、手元の端末だけで処理する方法です。"],
    [/データセンター/,"AI向けデータセンターは、多くの半導体と電力を使ってAIを動かす大きな施設です。"],
    [/統合メモリ/,"統合メモリは、パソコンのCPUとGPUが同じ記憶場所を使う仕組みです。"]
    ,[/クレジットを消費|課金方式/,"ここでいうクレジットは、画像や音声の生成に使う利用枠です。使うたびに残りが減ります。"]
  ];
  const found=definitions.find(([pattern])=>pattern.test(text));
  return found?found[1]:"";
}

function mechanismSentence(item){
  const type=String(item.event_type||"").trim();
  const text=[item.title,item.story_subject,item.change_summary].join(" ");
  if(/警告|注意/.test(text))return "これは新しい法律ではなく、公的な機関が注意を呼びかけた情報です。誰にどんな危険があるのかを分けて見る必要があります。";
  const byType={
    release:"発表されたことと、すぐ全員が使えることは同じではありません。地域、料金、使う端末によって条件が変わります。",
    pricing:"料金は、表示された金額だけでは判断できません。無料で使える量や、今の契約へいつ反映されるかも大切です。",
    funding:"資金調達は、会社が開発などに使うお金を外部から集めることです。集めた金額だけでは、成功するかまでは分かりません。",
    security:"安全上の問題は、見つかったこと、影響する範囲、修正されたかを分けて見る必要があります。",
    policy:"ルールの案が出たことと、実際に始まることは別です。対象の地域や会社も確認する必要があります。",
    partnership:"提携は、会社どうしが協力すると決めたことです。製品、開始日、料金が出るまでは、使う人への変化は決まりません。",
    acquisition:"買収は、会社の経営権などが別の会社へ移ることです。発表後も審査があり、完了しない場合があります。",
    research:"研究結果は、新しい方法を試した段階です。すぐ製品として使えることや、別の条件でも同じ結果になることまでは示しません。"
  };
  if(byType[type])return byType[type];
  if(/決算|売上|利益|業績/.test(text))return "決算は、会社が一定期間にどれだけ売り、利益を出したかを示す成績表です。AI事業の強さを見るには、製品ごとの数字も必要です。";
  if(/株価|市場/.test(text))return "株価には、会社の今の実力だけでなく、将来への期待も入ります。値上がりだけで事業の成功が決まったとは言えません。";
  if(/退社|退任|就任|人事|再編/.test(text))return "人や部署が変わると、会社の方針や仕事の進め方も変わることがあります。ただし、担当や計画が発表されるまでは影響は分かりません。";
  if(/投資|出資|資金/.test(text))return "投資は、会社や事業へお金を出すことです。金額だけでなく、いつ何に使うかも重要です。";
  return "大切なのは、すでに決まったことと、まだ発表されていないことを分けて読むことです。";
}

function factSlotSentences(item){
  const slots=Array.isArray(item&&item.fact_slots)?item.fact_slots:[];
  const result=[];
  for(const slot of slots.slice(0,2)){
    const type=String(slot&&slot.type||"").trim();
    const scope=toStudentJapanese(slot&&slot.scope);
    const value=toStudentJapanese(slot&&slot.value);
    if(!value)continue;
    if(comparable(item&&item.change_summary).includes(comparable(value)))continue;
    if(type==="date")result.push(`発表で確認できる日付は「${value}」です。`);
    else if(type==="version")result.push(`確認できる製品の版は「${value}」です。`);
    else if(type==="availability")result.push(`使える場所は「${value}」と案内されています。`);
    else if(type==="price"||type==="amount")result.push(`${scope||"確認できる金額"}は「${value}」です。`);
    else if(scope)result.push(`${scope}は「${value}」です。`);
  }
  return result;
}

function originalLegacyDetail(item){
  const detail=String(item&&item.detail||"").trim();
  if(item&&String(item.friendly_explanation_source||"").startsWith("verified_fields_safe_composite")){
    let first=detail.split(/\n+/)[0].trim();
    const raw=String(item.raw_excerpt||"").trim();
    if(raw&&first.endsWith(raw))first=first.slice(0,-raw.length).trim();
    return first;
  }
  return detail;
}

function buildLegacyDeepFriendlyExplanation(item){
  if(!item||typeof item!=="object")return "";
  if(item.enrichment_version===CURRENT_PROMPT_VERSION&&hasDeepFriendlyExplanation(item.detail))return String(item.detail).trim();
  if(item.enrichment_version===SAFE_COMPOSITE_VERSION&&hasDeepFriendlyExplanation(item.detail))return String(item.detail).trim();

  const first=[];
  const second=[];
  addUnique(first,item.change_summary);
  addUnique(first,termSentence(item));

  addUnique(second,mechanismSentence(item));
  addUnique(second,stageSentence(item));

  const all=()=>[...first,...second];
  const total=()=>compact(all().join("")).length;
  for(const fact of factSlotSentences(item)){
    if(total()>=TARGET_COMPACT_CHARS&&all().length>=MIN_SENTENCES)break;
    addUnique(first,fact);
  }
  const easyImpact=beginnerImpactSentence(item.impact_summary);
  if((total()<TARGET_COMPACT_CHARS||all().length<MIN_SENTENCES)&&easyImpact){
    addUnique(second,easyImpact);
  }
  const facts=Array.isArray(item.new_facts)?item.new_facts:[];
  for(const fact of facts.slice(0,3)){
    if(total()>=TARGET_COMPACT_CHARS&&all().length>=MIN_SENTENCES)break;
    addUnique(first,fact);
  }
  if((total()<MIN_COMPACT_CHARS||all().length<MIN_SENTENCES)&&first.length<3){
    const sourceSentences=sentences(toStudentJapanese(originalLegacyDetail(item))).slice(0,3);
    for(const sentence of sourceSentences){
      if(total()>=MIN_COMPACT_CHARS&&all().length>=MIN_SENTENCES)break;
      if(compact(sentence).length>MAX_SENTENCE_CHARS||first.length>=4)continue;
      addUnique(first,sentence);
    }
  }
  if(total()<MIN_COMPACT_CHARS||all().length<MIN_SENTENCES){
    const entity=String(item.primary_entity||"").trim();
    if(entity)addUnique(second,`この情報の発表元は${entity}です。`);
  }

  const removeLowerValueSentence=()=>{
    const genericIndex=second.findIndex(sentence=>/正式な内容|情報元の資料|詳しい条件は|新しい発表が出るか/.test(sentence));
    const index=genericIndex>=0?genericIndex:Math.max(0,second.length-2);
    second.splice(index,1);
  };
  while(all().length>MAX_SENTENCES&&second.length>2)removeLowerValueSentence();
  while(total()>MAX_COMPACT_CHARS&&second.length>2)removeLowerValueSentence();
  while(total()>MAX_COMPACT_CHARS&&first.length>2)first.pop();

  if(second.length<2){
    addUnique(second,stageSentence(item));
    if(second.length<2)addUnique(second,"詳しい条件は、情報元の新しい発表で確認する必要があります。");
  }
  return [first.join(""),second.join("")].map(value=>value.trim()).filter(Boolean).join("\n\n");
}

function upgradeFriendlyExplanationItem(item){
  if(!item||typeof item!=="object")return item;
  if(item.enrichment_version===CURRENT_PROMPT_VERSION&&hasDeepFriendlyExplanation(item.detail))return item;
  if(item.enrichment_version===SAFE_COMPOSITE_VERSION&&hasDeepFriendlyExplanation(item.detail))return item;
  const detail=buildLegacyDeepFriendlyExplanation(item);
  return {
    ...item,
    detail,
    enrichment_version:SAFE_COMPOSITE_VERSION,
    friendly_explanation_source:"verified_fields_safe_composite_student_v18"
  };
}

module.exports={
  CURRENT_PROMPT_VERSION,
  SAFE_COMPOSITE_VERSION,
  MIN_COMPACT_CHARS,
  MAX_COMPACT_CHARS,
  MIN_SENTENCES,
  MAX_SENTENCES,
  MAX_SENTENCE_CHARS,
  toStudentJapanese,
  hasDeepFriendlyExplanation,
  buildLegacyDeepFriendlyExplanation,
  upgradeFriendlyExplanationItem
};
