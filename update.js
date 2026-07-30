/* =====================================================================
 * AI進化レーダー — 毎日の自動取得スクリプト（GitHub Actions が実行）
 * ---------------------------------------------------------------------
 * AIツールやAI関連分野のRSS/Googleニュースフィードを取得し、ノイズを除外して
 * data.json を生成する。依存ライブラリ無し（Node 18+ の標準 fetch）。
 * 実行: node update.js  →  data.json を書き出す
 * ===================================================================== */
const fs = require("fs");

// 各ツール。feeds=検証済みフィード（公式RSS＋GoogleニュースRSS）、match=その記事が本当にそのツールの話か判定する正規表現
const TOOLS = [
  { name: "ChatGPT / OpenAI", match: /chatgpt|openai/i, feeds: [
    "https://news.google.com/rss/search?q=OpenAI%20ChatGPT%20when:7d&hl=ja&gl=JP&ceid=JP:ja",
    "https://openai.com/news/rss.xml" ] },
  { name: "Claude / Claude Code", match: /claude|anthropic/i, feeds: [
    "https://news.google.com/rss/search?q=Anthropic%20Claude%20when:7d&hl=ja&gl=JP&ceid=JP:ja",
    "https://github.com/anthropics/claude-code/releases.atom" ] },
  { name: "Gemini", match: /gemini/i, feeds: [
    "https://news.google.com/rss/search?q=Google%20Gemini%20AI%20when:7d&hl=ja&gl=JP&ceid=JP:ja",
    "https://blog.google/products-and-platforms/products/gemini/rss/" ] },
  { name: "v0", match: /\bv0\b|vercel/i, feeds: [
    "https://news.google.com/rss/search?q=Vercel%20v0%20when:7d&hl=en-US&gl=US&ceid=US:en",
    "https://vercel.com/changelog/rss.xml" ] },
  { name: "Cursor", match: /cursor/i, feeds: [
    "https://cursor.com/changelog/rss.xml",
    "https://news.google.com/rss/search?q=Cursor%20AI%20code%20editor%20when:7d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "Suno", match: /suno/i, feeds: [
    "https://news.google.com/rss/search?q=Suno%20%E9%9F%B3%E6%A5%BD%20AI%20when:7d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "Runway", match: /runway/i, feeds: [
    "https://news.google.com/rss/search?q=Runway%20AI%20video%20when:7d&hl=en-US&gl=US&ceid=US:en" ] },
  { name: "Canva", match: /canva/i, feeds: [
    "https://news.google.com/rss/search?q=Canva%20AI%20when:7d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "NotebookLM", match: /notebooklm|ノートブックlm/i, feeds: [
    "https://news.google.com/rss/search?q=Google%20NotebookLM%20when:7d&hl=ja&gl=JP&ceid=JP:ja",
    "https://blog.google/innovation-and-ai/products/notebooklm/rss/" ] },
  { name: "AI政策・政府動向", match: /AI|人工知能|生成AI/i, feeds: [
    "https://news.google.com/rss/search?q=%E7%94%9F%E6%88%90AI%20%E6%94%BF%E7%AD%96%20%E6%94%BF%E5%BA%9C%20when:7d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "AIと政治・選挙", match: /AI|人工知能|生成AI/i, feeds: [
    "https://news.google.com/rss/search?q=AI%20%E6%94%BF%E6%B2%BB%20%E9%81%B8%E6%8C%99%20%E5%9B%BD%E4%BC%9A%20when:7d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "AI補助金・助成金", match: /AI|人工知能|生成AI|DX/i, feeds: [
    "https://news.google.com/rss/search?q=AI%20%E5%B0%8E%E5%85%A5%20%E8%A3%9C%E5%8A%A9%E9%87%91%20%E5%8A%A9%E6%88%90%E9%87%91%20when:14d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "AI規制・著作権", match: /AI|人工知能|生成AI/i, feeds: [
    "https://news.google.com/rss/search?q=%E7%94%9F%E6%88%90AI%20%E8%A6%8F%E5%88%B6%20%E8%91%97%E4%BD%9C%E6%A8%A9%20%E6%B3%95%E5%BE%8B%20when:7d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "AI企業・関連株", match: /AI|人工知能|生成AI|半導体/i, feeds: [
    "https://news.google.com/rss/search?q=AI%20%E9%96%A2%E9%80%A3%E4%BC%81%E6%A5%AD%20%E6%B1%BA%E7%AE%97%20%E6%8F%90%E6%90%BA%20when:7d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "NVIDIA・AI半導体", match: /nvidia|GPU|半導体|データセンター/i, feeds: [
    "https://news.google.com/rss/search?q=NVIDIA%20AI%20GPU%20%E5%8D%8A%E5%B0%8E%E4%BD%93%20when:7d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "AI研究・新技術", match: /AI|人工知能|生成AI|機械学習/i, feeds: [
    "https://news.google.com/rss/search?q=%E7%94%9F%E6%88%90AI%20%E7%A0%94%E7%A9%B6%20%E8%AB%96%E6%96%87%20%E6%96%B0%E6%8A%80%E8%A1%93%20when:7d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "AIセキュリティ", match: /AI|人工知能|生成AI/i, feeds: [
    "https://news.google.com/rss/search?q=%E7%94%9F%E6%88%90AI%20%E3%82%BB%E3%82%AD%E3%83%A5%E3%83%AA%E3%83%86%E3%82%A3%20%E6%83%85%E5%A0%B1%E6%BC%8F%E3%81%88%E3%81%84%20when:7d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "中国AI・基盤モデル", match: /kimi|moonshot|deepseek|qwen|tongyi|通義|千問|glm|zhipu|z\.ai|minimax|doubao|豆包|baichuan|01\.ai|yi[- ]?lightning|hunyuan|混元|ernie|文心|mimo|stepfun|step[- ]?ai|中国.*AI|chinese ai/i, feeds: [
    "https://news.google.com/rss/search?q=%28Kimi%20OR%20Moonshot%20AI%20OR%20DeepSeek%20OR%20Qwen%20OR%20Zhipu%20OR%20GLM%20OR%20MiniMax%29%20when:2d&hl=ja&gl=JP&ceid=JP:ja",
    "https://news.google.com/rss/search?q=%28Kimi%20OR%20Moonshot%20AI%20OR%20DeepSeek%20OR%20Qwen%20OR%20Zhipu%20OR%20GLM%20OR%20MiniMax%20OR%20Doubao%20OR%20Hunyuan%29%20when:2d&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=%28%E4%B8%AD%E5%9B%BDAI%20OR%20%E6%9C%88%E4%B9%8B%E6%9A%97%E9%9D%A2%20OR%20Kimi%20OR%20DeepSeek%20OR%20%E9%80%9A%E4%B9%89%E5%8D%83%E9%97%AE%20OR%20%E6%99%BA%E8%B0%B1AI%20OR%20MiniMax%20OR%20%E8%B1%86%E5%8C%85%29%20when:2d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans" ] },
  { name: "世界の新モデル・速報", match: /AI|artificial intelligence|LLM|large language model|foundation model|multimodal|agent|生成AI|人工知能/i, feeds: [
    "https://news.google.com/rss/search?q=%28AI%20model%20OR%20LLM%20OR%20AI%20agent%29%20%28launch%20OR%20release%20OR%20unveil%20OR%20open-source%29%20when:1d&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=%28AI%E3%83%A2%E3%83%87%E3%83%AB%20OR%20%E7%94%9F%E6%88%90AI%20OR%20AI%E3%82%A8%E3%83%BC%E3%82%B8%E3%82%A7%E3%83%B3%E3%83%88%29%20%28%E7%99%BA%E8%A1%A8%20OR%20%E5%85%AC%E9%96%8B%20OR%20%E6%8F%90%E4%BE%9B%E9%96%8B%E5%A7%8B%29%20when:2d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "オープンモデル・開発者動向", match: /open.?source|open.?weight|hugging face|github|model|LLM|AI/i, feeds: [
    "https://news.google.com/rss/search?q=%28open-source%20AI%20OR%20open-weight%20model%20OR%20Hugging%20Face%29%20when:2d&hl=en-US&gl=US&ceid=US:en",
    "https://huggingface.co/blog/feed.xml" ] },
  { name: "AIスタートアップ・資金調達", match: /AI|artificial intelligence|生成AI|人工知能|LLM/i, feeds: [
    "https://news.google.com/rss/search?q=%28AI%20startup%20OR%20AI%20company%29%20%28funding%20OR%20raises%20OR%20acquisition%20OR%20valuation%29%20when:2d&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=%28AI%E4%BC%81%E6%A5%AD%20OR%20AI%E3%82%B9%E3%82%BF%E3%83%BC%E3%83%88%E3%82%A2%E3%83%83%E3%83%97%29%20%28%E8%B3%87%E9%87%91%E8%AA%BF%E9%81%94%20OR%20%E8%B2%B7%E5%8F%8E%20OR%20%E6%99%82%E4%BE%A1%E7%B7%8F%E9%A1%8D%29%20when:3d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "AIベンチマーク・研究速報", match: /AI|LLM|model|machine learning|benchmark|agent|人工知能|機械学習/i, feeds: [
    "https://news.google.com/rss/search?q=%28AI%20benchmark%20OR%20LLM%20leaderboard%20OR%20AI%20research%29%20when:2d&hl=en-US&gl=US&ceid=US:en",
    "https://rss.arxiv.org/rss/cs.AI",
    "https://rss.arxiv.org/rss/cs.CL" ] },
];
const PER_TOOL = 8; // 重要分野ごとの候補を広めに保持する

// ノイズ（広告・セール・ランキング記事・求人など）を落とす正規表現
const NOISE = /(セール|キャンペーン|クーポン|プレゼント|無料配布|値引き|%\s*オフ|％\s*オフ|\d+\s*%\s*off|kindle|割引|まとめ買い|求人|採用情報|転職|ランキング|おすすめ\d*\s*選|\d+\s*選|ベスト\d+|top\s*\d+|best\s+\d+\b|\bsale\b|\bdiscount\b|\bcoupon\b|\bgiveaway\b)/i;

function isOfficial(url) { return !/news\.google\.com/i.test(url); }
// 採用判定：公式フィードは無条件採用。ニュースは「ツール名を含む」かつ「ノイズでない」もののみ。
function keep(item, tool) {
  const age=Date.now()-new Date(item.date||0).getTime();
  if(item.date&&Number.isFinite(age)&&age>14*86400000)return false;
  if (item.official) return true;
  const text = item.title + " " + (item.desc || "");
  if (!tool.match.test(text)) return false;
  if (NOISE.test(item.title)) return false;
  return true;
}

/* =====================================================================
 * ②AI厳選・要約
 * 新着だけを小さなバッチで処理し、必須項目が揃った記事だけを公開する。
 * 既に要約済みの記事は data.json から再利用し、API費用と失敗率を抑える。
 * ===================================================================== */
const AI_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const AI_MAX = 30;
const AI_BATCH_SIZE = 6;
const AI_NEW_LIMIT = 30;
const ARTICLE_CONTEXT_LIMIT = 2400;
const ALLOWED_CATEGORIES = [
  "AIツール・モデル","政策・行政","補助金・助成金","企業・株式",
  "規制・法務","研究・技術","セキュリティ","半導体・インフラ",
  "アプリ開発・自動化","画像・動画生成","音楽・クリエイティブ",
  "営業・マーケティング","EC・業務活用","その他"
];

async function callClaude(system, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error("Anthropic HTTP " + res.status + ": " + (await res.text()).slice(0, 300));
  const data = await res.json();
  if (data.stop_reason === "refusal") throw new Error("refusal");
  return {
    text:(data.content || []).filter(b => b.type === "text").map(b => b.text).join(""),
    stopReason:data.stop_reason || ""
  };
}

function parseJsonArray(text) {
  if (!text) return null;
  const a = text.indexOf("["), b = text.lastIndexOf("]");
  if (a < 0 || b <= a) return null;
  try { const arr = JSON.parse(text.slice(a, b + 1)); return Array.isArray(arr) ? arr : null; }
  catch (e) { return null; }
}

function fallbackCategoryForTool(tool) {
  const name=String(tool||"");
  if(/政策|政治|選挙/.test(name))return ["政策・行政"];
  if(/補助金|助成金/.test(name))return ["補助金・助成金"];
  if(/規制|著作権|法律/.test(name))return ["規制・法務"];
  if(/企業|株|スタートアップ|資金調達/.test(name))return ["企業・株式"];
  if(/NVIDIA|半導体|GPU|インフラ/.test(name))return ["半導体・インフラ"];
  if(/セキュリティ/.test(name))return ["セキュリティ"];
  if(/研究|論文|ベンチマーク|新技術/.test(name))return ["研究・技術"];
  if(/v0|Cursor|Code|開発|オープンモデル/.test(name))return ["アプリ開発・自動化"];
  if(/Runway|Canva|画像|動画/.test(name))return ["画像・動画生成"];
  if(/Suno|音楽|音声/.test(name))return ["音楽・クリエイティブ"];
  return ["AIツール・モデル"];
}
function isCompleteEnrichedItem(item) {
  return !!item &&
    ["title","raw_excerpt","detail","change_summary","impact_summary","action_suggestion","importance"]
      .every(k=>String(item[k]||"").trim()) &&
    Array.isArray(item.related_categories) && item.related_categories.length>0 &&
    isJapaneseDisplayItem(item);
}
function cleanDisplayTitle(title, sourceName) {
  let value=stripTags(String(title||"")).replace(/\s+/g," ").trim();
  const source=String(sourceName||"").trim();
  if(source){
    const escaped=source.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    value=value.replace(new RegExp("\\s*(?:[-–—|｜]\\s*)"+escaped+"\\s*$","i"),"").trim();
  }
  return value.replace(/(?:\.\.\.|…|(?:\.\.)+)\s*$/,"").trim();
}
async function fetchArticleContext(item) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),7000);
  try{
    const res=await fetch(item.source_url,{redirect:"follow",signal:controller.signal,headers:{
      "User-Agent":"Mozilla/5.0 (compatible; AI-Radar/1.0; +https://reiki-ai-apps.github.io/AI-/)",
      "Accept":"text/html,application/xhtml+xml"
    }});
    if(!res.ok)return item.raw_excerpt||"";
    const type=String(res.headers.get("content-type")||"");
    if(!/html|xml|text/i.test(type))return item.raw_excerpt||"";
    const html=(await res.text()).slice(0,1_500_000);
    const meta=(name)=>{
      const escName=name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
      const patterns=[
        new RegExp(`<meta[^>]+(?:name|property)=["']${escName}["'][^>]+content=["']([^"']+)["']`,"i"),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escName}["']`,"i")
      ];
      for(const re of patterns){const m=html.match(re);if(m)return stripTags(m[1]);}
      return "";
    };
    const paragraphs=[...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map(m=>stripTags(m[1])).filter(t=>t.length>=45).slice(0,10);
    const context=[
      meta("og:description"),meta("description"),meta("twitter:description"),
      ...paragraphs
    ].filter(Boolean).join("\n");
    return context.slice(0,ARTICLE_CONTEXT_LIMIT)||(item.raw_excerpt||"");
  }catch(_error){
    return item.raw_excerpt||"";
  }finally{
    clearTimeout(timeout);
  }
}

async function aiEnrichBatch(items) {
  const list=items.map((it,i)=>({
    i,tool:it.tool,title:it.title,source:it.source_name||"",
    official:!!it.is_official,published_at:it.published_at,
    excerpt:String(it.raw_excerpt||"").slice(0,500),
    article_context:String(it.article_context||"").slice(0,ARTICLE_CONTEXT_LIMIT)
  }));
  const system =
    "あなたは、AIに詳しくない人にも理解できる日本語で伝えるAIニュース編集者です。" +
    "製品アップデート、新機能、使い方、料金変更だけでなく、AI政策、規制、著作権、補助金・助成金、AI関連企業・株式、研究、セキュリティ、半導体など、利用者の仕事や生活に影響する情報を重視してください。" +
    "記事本文の抜粋にない数字・人物・効果は作らず、不明な点は不明と明記してください。広告、別テーマの誤ヒット、根拠の薄い記事は除外してください。";
  const user =
    "次のAI関連ニュース候補(JSON)を確認し、一般の利用者が知っておく価値のある記事だけを残してください。\n" +
    "出力は次の形式のJSON配列だけ（前置き・説明・コードフェンスは一切不要）:\n" +
    '[{"i":元番号,"title_ja":"媒体名を除いた自然な日本語タイトル","summary_ja":"60〜100字で結論が分かる要約","detail_ja":"220〜360字、専門用語を説明したやさしい解説","change_ja":"何が新しいかを1〜2文","impact_ja":"日本の仕事・経営・生活への影響を1〜2文","action_ja":"利用者が次に確認することを1〜2文","importance":"S|A|B|C","categories":["指定カテゴリから1〜3件"]}]\n' +
    "指定カテゴリ:"+JSON.stringify(ALLOWED_CATEGORIES)+"\n"+
    "英語・中国語は自然な日本語に翻訳してください。article_contextを最優先の根拠にし、情報不足でもタイトルを言い換えただけの要約は作らないでください。価値や根拠が足りない記事は出力しないでください。\n候補:\n" +
    JSON.stringify(list);

  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { response = await callClaude(system, user); break; }
    catch (e) { console.error("AI厳選 試行" + (attempt + 1) + " 失敗:", String(e.message || e).slice(0, 200)); }
  }
  if(!response)return [];
  const arr = parseJsonArray(response.text);
  if (!arr || !arr.length) {
    console.error("AI応答をJSON解析できませんでした。stop_reason="+response.stopReason+" chars="+response.text.length);
    return [];
  }

  const out = [];
  for (const e of arr) {
    const idx = Number(e && e.i);
    if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) continue;
    const src = items[idx];
    const titleJa = cleanDisplayTitle((e.title_ja || "").toString().trim() || src.title,src.source_name);
    const sumJa = (e.summary_ja || "").toString().trim();
    const detailJa = (e.detail_ja || "").toString().trim();
    const categories=[...new Set((Array.isArray(e.categories)?e.categories:[])
      .map(String).filter(c=>ALLOWED_CATEGORIES.includes(c)))];
    const item={
      tool: src.tool,
      title: titleJa,
      source_url: src.source_url,
      source_name: src.source_name || "",
      is_official: !!src.is_official,
      published_at: src.published_at,
      raw_excerpt: sumJa || src.raw_excerpt,
      detail: detailJa,
      change_summary: (e.change_ja || "").toString().trim(),
      impact_summary: (e.impact_ja || "").toString().trim(),
      action_suggestion: (e.action_ja || "").toString().trim(),
      importance: ["S","A","B","C"].includes(String(e.importance||"").toUpperCase())?String(e.importance).toUpperCase():"B",
      related_categories:categories.length?categories:fallbackCategoryForTool(src.tool)
    };
    if(isCompleteEnrichedItem(item))out.push(item);
  }
  console.error("AI要約: "+out.length+"/"+items.length+"件（model="+AI_MODEL+"）");
  return out;
}

async function enrichNewItems(items) {
  if(!items.length)return [];
  if(!process.env.ANTHROPIC_API_KEY)throw new Error("ANTHROPIC_API_KEY 未設定");
  const enriched=[];
  for(let start=0;start<items.length;start+=AI_BATCH_SIZE){
    const batch=items.slice(start,start+AI_BATCH_SIZE);
    const withContext=await Promise.all(batch.map(async item=>({
      ...item,
      article_context:await fetchArticleContext(item)
    })));
    const result=await aiEnrichBatch(withContext);
    enriched.push(...result);
  }
  return enriched;
}

function decode(s) {
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const map = { "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&#x27;": "'", "&amp;": "&" };
  for (const k in map) s = s.split(k).join(map[k]);
  return s.replace(/&nbsp;|&#160;| /g, " ");
}
function stripTags(s) { return decode(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function tag(block, name) {
  const m = block.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i"));
  return m ? decode(m[1]).trim() : "";
}
function atomLink(block) { const m = block.match(/<link[^>]*href="([^"]+)"/i); return m ? m[1] : ""; }
function toIso(raw) { if (!raw) return null; const d = new Date(raw); return isNaN(d) ? null : d.toISOString(); }
function sourceLabelFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return /news\.google\.com/i.test(host) ? "Google ニュース掲載記事" : host;
  } catch (e) {
    return "";
  }
}

function hasJapaneseText(value) {
  return /[\u3040-\u30ff]/.test(String(value || ""));
}
function isJapaneseDisplayItem(item) {
  const explanations = [
    item && (item.raw_excerpt || item.summary),
    item && item.detail,
    item && item.change_summary,
    item && item.impact_summary,
    item && item.action_suggestion
  ].filter(value => String(value || "").trim());
  return explanations.length>0&&explanations.every(hasJapaneseText);
}

function parseFeed(xml, official, fallbackSource) {
  let blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi);
  if (!blocks) blocks = xml.match(/<entry\b[\s\S]*?<\/entry>/gi);
  if (!blocks) return [];
  const out = [];
  for (const b of blocks) {
    const sourceName = stripTags(tag(b, "source")) || fallbackSource || "";
    const title = cleanDisplayTitle(stripTags(tag(b, "title")),sourceName);
    if (!title) continue;
    const link = tag(b, "link") || atomLink(b);
    const dateRaw = tag(b, "pubDate") || tag(b, "published") || tag(b, "updated");
    const desc = stripTags(tag(b, "description") || tag(b, "summary") || tag(b, "content")).slice(0, 500);
    out.push({ title, link, date: toIso(dateRaw), desc, official, sourceName });
  }
  return out;
}

async function fetchText(url) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12000);
  try{
    const res = await fetch(url, { signal:controller.signal,headers: { "User-Agent": "Mozilla/5.0 (AI-Radar bot)" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  }finally{
    clearTimeout(timeout);
  }
}
function normalizedUrl(value) {
  try{
    const u=new URL(String(value||""));
    u.hash="";
    [...u.searchParams.keys()].forEach(k=>{
      if(/^utm_/i.test(k)||["oc","hl","gl","ceid","ref","source"].includes(k.toLowerCase()))u.searchParams.delete(k);
    });
    return u.toString().replace(/\/$/,"").toLowerCase();
  }catch(_error){
    return "";
  }
}
function normalizedStoryTitle(value) {
  return cleanDisplayTitle(value,"").toLowerCase()
    .replace(/[「」『』【】()[\]（）!?！？。、・:：'"“”‘’\-–—|｜]/g,"")
    .replace(/\s+/g,"")
    .replace(/(発表|公開|提供開始|明らかに|について|とは|ニュース)$/,"");
}
function titleGrams(value) {
  const text=normalizedStoryTitle(value);
  const grams=new Set();
  for(let i=0;i<Math.max(1,text.length-2);i++)grams.add(text.slice(i,i+3));
  return grams;
}
function sameStory(a,b) {
  const au=normalizedUrl(a.source_url),bu=normalizedUrl(b.source_url);
  if(au&&bu&&au===bu)return true;
  const at=normalizedStoryTitle(a.title),bt=normalizedStoryTitle(b.title);
  if(at&&bt&&(at===bt||at.includes(bt)||bt.includes(at))&&Math.min(at.length,bt.length)>=12)return true;
  const ag=titleGrams(at),bg=titleGrams(bt);
  if(!ag.size||!bg.size)return false;
  let overlap=0;for(const gram of ag)if(bg.has(gram))overlap++;
  return overlap/Math.max(ag.size,bg.size)>=0.58;
}
function dedupeStories(items) {
  const kept=[];
  for(const item of items){
    const duplicate=kept.some(existing=>{
      const timeGap=Math.abs(new Date(existing.published_at||0)-new Date(item.published_at||0));
      return timeGap<=7*86400000&&sameStory(existing,item);
    });
    if(!duplicate)kept.push(item);
  }
  return kept;
}
function readPreviousCompleteItems() {
  try{
    const parsed=JSON.parse(fs.readFileSync("data.json","utf8"));
    return Array.isArray(parsed)?parsed.filter(isCompleteEnrichedItem):[];
  }catch(_error){
    return [];
  }
}
function candidateScore(item) {
  const ageHours=Math.max(0,(Date.now()-new Date(item.published_at||0).getTime())/3600000);
  let score=Math.max(0,96-ageHours);
  if(item.is_official)score+=35;
  if(/中国AI|世界の新モデル|政策|規制|補助金|セキュリティ|半導体/.test(item.tool||""))score+=16;
  if(/発表|公開|提供開始|新モデル|規制|法案|提携|買収|資金調達|脆弱性|料金/.test(item.title||""))score+=12;
  return score;
}

(async () => {
  const out = [];
  for (const t of TOOLS) {
    let items = [];
    for (const url of t.feeds) {
      try { items = items.concat(parseFeed(await fetchText(url), isOfficial(url), sourceLabelFromUrl(url))); }
      catch (e) { console.error("  fetch fail", url, String(e.message || e).slice(0, 60)); }
    }
    const before = items.length;
    let kept = items.filter(it => keep(it, t));              // ★ノイズ除外（厳選①）
    // そのツールの記事が全部消えたら、ツール名一致だけ緩めてノイズ除外のみで救済（例: Sunoは見出しに"Suno"が無い事が多い）
    if (kept.length === 0 && before > 0) kept = items.filter(it => it.official || !NOISE.test(it.title));
    items = kept;
    const seen = new Set();
    items = items.filter(it => {
      const k=(it.link||it.title).toLowerCase().replace(/[?#].*$/,"");
      if(seen.has(k))return false;seen.add(k);return true;
    });
    items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    for (const it of items.slice(0, PER_TOOL)) {
      out.push({
        tool: t.name, title: it.title, source_url: it.link || "",
        published_at: it.date || new Date().toISOString(), raw_excerpt: it.desc || "",
        source_name: it.sourceName || (it.official ? "公式情報" : "Google ニュース掲載記事"),
        is_official: !!it.official,
      });
    }
    console.error("OK", t.name, "kept", Math.min(items.length, PER_TOOL), "/ fetched", before);
  }
  out.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));

  // URLだけでなくタイトルの類似度も見て、媒体をまたぐ同一話題を1件にまとめる。
  const uniqueOut = dedupeStories(out);

  // 一時的な通信障害で全フィード取得に失敗しても、既存ニュースを消さない。
  if (uniqueOut.length === 0) {
    console.error("NO ARTICLES FETCHED: keeping the existing data.json");
    process.exitCode = 1;
    return;
  }

  // ②要約済みの記事は再利用し、新着だけを小分けでAI要約する。
  const previous=readPreviousCompleteItems();
  const reused=[];
  const fresh=[];
  for(const item of uniqueOut){
    const match=previous.find(old=>sameStory(old,item));
    if(match)reused.push({...match,published_at:item.published_at||match.published_at});
    else fresh.push(item);
  }
  fresh.sort((a,b)=>candidateScore(b)-candidateScore(a));
  let newlyEnriched=[];
  try {
    newlyEnriched=await enrichNewItems(fresh.slice(0,AI_NEW_LIMIT));
  } catch (e) {
    console.error("AI要約に失敗:",String(e.message||e).slice(0,300));
  }

  // 今回フィードに現れなかった記事も保存期間内なら残す。
  // 一時的なRSS欠落で、良質な要約済み記事が突然消えるのを防ぐ。
  const retentionStart=Date.now()-31*86400000;
  const recentPrevious=previous.filter(item=>{
    const time=new Date(item.published_at||0).getTime();
    return Number.isFinite(time)&&time>=retentionStart;
  });
  const importanceOrder={S:4,A:3,B:2,C:1};
  const final=dedupeStories([...newlyEnriched,...reused,...recentPrevious])
    .filter(isCompleteEnrichedItem)
    .sort((a,b)=>(importanceOrder[b.importance]||0)-(importanceOrder[a.importance]||0)||
      new Date(b.published_at||0)-new Date(a.published_at||0))
    .slice(0,AI_MAX)
    .sort((a,b)=>new Date(b.published_at||0)-new Date(a.published_at||0));

  if(!newlyEnriched.length&&fresh.length){
    console.error("NO NEW ENRICHED ARTICLES: keeping the existing complete data.json");
    process.exitCode = 1;
    return;
  }
  if(final.length<Math.min(8,previous.length||8)){
    console.error("TOO FEW COMPLETE ARTICLES ("+final.length+"): keeping the existing data.json");
    process.exitCode=1;
    return;
  }

  fs.writeFileSync("data.json", JSON.stringify(final, null, 2));
  console.error("WROTE data.json with",final.length,"complete items; new",newlyEnriched.length,"reused",reused.length,"retained",recentPrevious.length);

  // GitHub Pages へ配置する直前に、同意欄をログイン・無料登録ボタンより上へ整える。
  // すでに正しい順序なら何も変更しないため、毎日の自動実行でも安全。
  const indexPath = "index.html";
  if (fs.existsSync(indexPath)) {
    const lines = fs.readFileSync(indexPath, "utf8").split(/(?<=\n)/);
    const actionIndex = lines.findIndex(line => line.includes('class="auth-actions"') && line.includes("signInMember()"));
    const consentIndex = lines.findIndex(line => line.includes('id="authConsent"'));
    if (actionIndex >= 0 && consentIndex >= 0 && actionIndex < consentIndex) {
      [lines[actionIndex], lines[consentIndex]] = [lines[consentIndex], lines[actionIndex]];
      fs.writeFileSync(indexPath, lines.join(""));
      console.error("UPDATED login consent layout");
    }
  }
})();
