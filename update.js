/* =====================================================================
 * AI進化レーダー — 毎日の自動取得スクリプト（GitHub Actions が実行）
 * ---------------------------------------------------------------------
 * AIツールやAI関連分野のRSS/Googleニュースフィードを取得し、ノイズを除外して
 * data.json を生成する。依存ライブラリ無し（Node 18+ の標準 fetch）。
 * 実行: node update.js  →  data.json を書き出す
 * ===================================================================== */
const fs = require("fs");
const crypto = require("crypto");
const {upgradeFriendlyExplanationItem}=require("./scripts/friendly-explanation.cjs");
const {buildHomeEdition,applyHomeEdition}=require("./scripts/home-edition.cjs");

// ホームの「主要AIアプリ・ツール」と収集対象を同じ一覧で監査する。
// 公式更新ページを毎回確認し、日本語ニュースだけでは拾いにくい製品更新も補う。
const FEATURED_RESEARCH_TOOL_NAMES = [
  "Kling AI", "Google Veo", "ChatGPT / OpenAI", "Claude / Claude Code", "Gemini",
  "Runway", "Midjourney", "Adobe Firefly", "Perplexity", "Grok / xAI", "DeepSeek",
  "Manus AI", "Genspark", "Microsoft Copilot", "GitHub Copilot", "Cursor", "Windsurf",
  "Lovable", "Replit Agent", "ElevenLabs", "HeyGen", "Notion AI", "Gamma"
];
const FEATURED_RESEARCH_SET = new Set(FEATURED_RESEARCH_TOOL_NAMES);
const FEATURED_RESEARCH_QUERY = {
  "Kling AI":"Kling AI", "Google Veo":"Google Veo", "ChatGPT / OpenAI":"OpenAI ChatGPT",
  "Claude / Claude Code":"Anthropic Claude", Gemini:"Google Gemini", Runway:"Runway AI",
  Midjourney:"Midjourney", "Adobe Firefly":"Adobe Firefly", Perplexity:"Perplexity AI",
  "Grok / xAI":"Grok xAI", DeepSeek:"DeepSeek AI", "Manus AI":"Manus AI",
  Genspark:"Genspark AI", "Microsoft Copilot":"Microsoft Copilot", "GitHub Copilot":"GitHub Copilot",
  Cursor:"Cursor AI editor", Windsurf:"Windsurf AI coding", Lovable:"Lovable AI app",
  "Replit Agent":"Replit Agent", ElevenLabs:"ElevenLabs", HeyGen:"HeyGen",
  "Notion AI":"Notion AI", Gamma:"Gamma AI presentation"
};
const OFFICIAL_UPDATE_PAGES = {
  "Kling AI":["https://klingai.com/global/"],
  "Google Veo":["https://deepmind.google/models/veo/"],
  "ChatGPT / OpenAI":["https://help.openai.com/en/articles/6825453-chatgpt-release-notes"],
  "Claude / Claude Code":["https://docs.anthropic.com/en/release-notes/overview"],
  Gemini:["https://gemini.google/release-notes/"],
  Runway:["https://runwayml.com/news/"],
  Midjourney:["https://updates.midjourney.com/"],
  "Adobe Firefly":["https://helpx.adobe.com/firefly/whats-new.html"],
  Perplexity:["https://www.perplexity.ai/hub/blog"],
  "Grok / xAI":["https://docs.x.ai/docs/release-notes"],
  DeepSeek:["https://api-docs.deepseek.com/news/"],
  "Manus AI":["https://manus.im/updates"],
  Genspark:["https://www.genspark.ai/blog"],
  "Microsoft Copilot":["https://learn.microsoft.com/en-us/microsoft-365/copilot/release-notes"],
  "GitHub Copilot":["https://github.blog/changelog/label/copilot/"],
  Cursor:["https://cursor.com/changelog"],
  Windsurf:["https://windsurf.com/changelog"],
  Lovable:["https://docs.lovable.dev/changelog"],
  "Replit Agent":["https://replit.com/blog/category/product"],
  ElevenLabs:["https://elevenlabs.io/blog/category/product"],
  HeyGen:["https://www.heygen.com/blog/category/product-updates"],
  "Notion AI":["https://www.notion.com/releases"],
  Gamma:["https://ideas.gamma.app/changelog"]
};

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
  { name: "Kling AI", match: /kling(?:\s*ai)?|可灵|クリング/i, feeds: [
    "https://news.google.com/rss/search?q=%28Kling%20AI%20OR%20%E5%8F%AF%E7%81%B5AI%29%20video%20when:3d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "Google Veo", match: /\bveo(?:\s*[0-9])?\b|google\s+veo/i, feeds: [
    "https://news.google.com/rss/search?q=Google%20Veo%20AI%20video%20when:3d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "Midjourney", match: /midjourney/i, feeds: [
    "https://news.google.com/rss/search?q=Midjourney%20AI%20when:3d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "Adobe Firefly", match: /adobe\s+firefly|firefly.*adobe/i, feeds: [
    "https://news.google.com/rss/search?q=Adobe%20Firefly%20AI%20when:3d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "Perplexity", match: /perplexity/i, feeds: [
    "https://news.google.com/rss/search?q=Perplexity%20AI%20when:3d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "Grok / xAI", match: /\bgrok(?:\s*[0-9])?\b|\bxai\b|x\.ai/i, feeds: [
    "https://news.google.com/rss/search?q=%28Grok%20OR%20xAI%29%20AI%20when:3d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "DeepSeek", match: /deepseek/i, feeds: [
    "https://news.google.com/rss/search?q=DeepSeek%20AI%20when:3d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "Manus AI", match: /\bmanus(?:\s*ai)?\b|マヌスAI/i, feeds: [
    "https://news.google.com/rss/search?q=Manus%20AI%20agent%20when:3d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "Genspark", match: /genspark/i, feeds: [
    "https://news.google.com/rss/search?q=Genspark%20AI%20when:3d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "Microsoft Copilot", match: /microsoft\s+(?:365\s+)?copilot|copilot.*microsoft|microsoft.*copilot/i, feeds: [
    "https://news.google.com/rss/search?q=Microsoft%20Copilot%20when:7d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "GitHub Copilot", match: /github\s+copilot/i, feeds: [
    "https://news.google.com/rss/search?q=GitHub%20Copilot%20when:3d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "Windsurf", match: /windsurf.*(?:AI|code|coding)|(?:AI|code|coding).*windsurf/i, feeds: [
    "https://news.google.com/rss/search?q=Windsurf%20AI%20coding%20when:3d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "Lovable", match: /lovable.*(?:AI|app)|(?:AI|app).*lovable/i, feeds: [
    "https://news.google.com/rss/search?q=Lovable%20AI%20app%20when:3d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "Replit Agent", match: /replit(?:\s+agent)?/i, feeds: [
    "https://news.google.com/rss/search?q=Replit%20Agent%20AI%20when:3d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "ElevenLabs", match: /elevenlabs/i, feeds: [
    "https://news.google.com/rss/search?q=ElevenLabs%20AI%20when:3d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "HeyGen", match: /heygen/i, feeds: [
    "https://news.google.com/rss/search?q=HeyGen%20AI%20when:3d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "Notion AI", match: /notion\s+ai/i, feeds: [
    "https://news.google.com/rss/search?q=Notion%20AI%20when:3d&hl=ja&gl=JP&ceid=JP:ja" ] },
  { name: "Gamma", match: /gamma.*(?:AI|presentation)|(?:AI|presentation).*gamma/i, feeds: [
    "https://news.google.com/rss/search?q=Gamma%20AI%20presentation%20when:3d&hl=ja&gl=JP&ceid=JP:ja" ] },
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
  // 製品名検索だけでは落ちる、AI大手・主要研究所の経営、人事、研究体制の転換を横断監視する。
  { name: "AI業界・経営重要速報", match: /(?=.*(?:openai|anthropic|google|deepmind|meta|microsoft|xai|x\.ai|nvidia|amazon|apple|deepseek|mistral|人工知能|生成AI|AI))(?=.*(?:ceo|chief|leadership|reorganiz|restructur|resign|depart|appoint|chairman|acqui|invest|partner|経営|人事|退任|退社|辞任|就任|会長|再編|組織|幹部|買収|投資|提携))/i, feeds: [
    "https://news.google.com/rss/search?q=%28AI%20OR%20%E4%BA%BA%E5%B7%A5%E7%9F%A5%E8%83%BD%20OR%20%E7%94%9F%E6%88%90AI%29%20%28CEO%20OR%20%E7%B5%8C%E5%96%B6%20OR%20%E4%BA%BA%E4%BA%8B%20OR%20%E9%80%80%E4%BB%BB%20OR%20%E5%B0%B1%E4%BB%BB%20OR%20%E5%86%8D%E7%B7%A8%20OR%20%E8%B2%B7%E5%8F%8E%20OR%20%E6%8A%95%E8%B3%87%20OR%20%E6%8F%90%E6%90%BA%29%20when:7d&hl=ja&gl=JP&ceid=JP:ja",
    "https://news.google.com/rss/search?q=%28AI%20OR%20%22artificial%20intelligence%22%29%20%28CEO%20OR%20leadership%20OR%20reorganization%20OR%20restructuring%20OR%20resigns%20OR%20departs%20OR%20acquisition%20OR%20investment%20OR%20partnership%29%20when:7d&hl=en-US&gl=US&ceid=US:en" ] },
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
const AI_MAX = 60;
const AI_BATCH_SIZE = 6;
const AI_MIGRATION_BATCH_SIZE = 2;
const AI_NEW_LIMIT = 16;
const AI_DEEP_BACKFILL_LIMIT = 24;
const AI_DAILY_UNIQUE_LIMIT = 40;
const AI_DAILY_EMERGENCY_LIMIT = 8;
const ARTICLE_CONTEXT_LIMIT = 3600;
const AI_CACHE_PATH = ".ai-cache.json";
const AI_USAGE_PATH = ".ai-usage.json";
const STORY_INDEX_PATH = ".story-index.json";
const HOME_EDITION_PATH = "home-edition.json";
const STORY_REPOST_WINDOW_MS = 31 * 86400000;
const STORY_TIMELINE_WINDOW_MS = 365 * 86400000;
// 完全一致の再掲載を公開から外す期間。表示保持(31日)より長く、365日の全面抑制はしない。
const DUPLICATE_SUPPRESS_WINDOW_MS = 45 * 86400000;
const PROMPT_VERSION = "ai-radar-2026-08-30-v13-core-depth";
const REJECTED_TTL_MS = 2 * 86400000;
const RETRY_TTL_MS = 90 * 60000;
const ENRICHED_TTL_MS = 31 * 86400000;
const ALLOWED_CATEGORIES = [
  "AIツール・モデル","政策・行政","補助金・助成金","企業・株式",
  "規制・法務","研究・技術","セキュリティ","半導体・インフラ",
  "アプリ開発・自動化","画像・動画生成","音楽・クリエイティブ",
  "営業・マーケティング","EC・業務活用","その他"
];

function readJsonFile(path, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}

function writeJsonFile(path, value) {
  const tempPath=path+"."+process.pid+".tmp";
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tempPath,path);
}

function checkpointAiState(cache,ledger) {
  cache.updated_at=new Date().toISOString();
  writeJsonFile(AI_CACHE_PATH,cache);
  writeJsonFile(AI_USAGE_PATH,ledger);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function utcDay(value = Date.now()) {
  return new Date(value).toISOString().slice(0, 10);
}

function articleContentHash(item) {
  return sha256([
    normalizedStoryTitle(item && item.title),
    String(item && item.raw_excerpt || "").replace(/\s+/g, " ").trim(),
    String(item && item.source_name || "").toLowerCase().trim()
  ].join("\n"));
}

function articleCacheKey(item) {
  const url = normalizedUrl(item && item.source_url);
  if (url) return "url:" + url;
  return "story:" + sha256([
    normalizedStoryTitle(item && item.title),
    String(item && item.source_name || "").toLowerCase().trim()
  ].join("\n"));
}

function loadAiCache(now = Date.now()) {
  const cache = readJsonFile(AI_CACHE_PATH, { version: 1, items: {} });
  cache.version = 1;
  cache.items = cache.items && typeof cache.items === "object" ? cache.items : {};
  for (const [key, entry] of Object.entries(cache.items)) {
    const processedAt = new Date(entry && entry.processed_at || 0).getTime();
    const ttl = entry && entry.status === "rejected" ? REJECTED_TTL_MS
      : entry && entry.status === "retry" ? RETRY_TTL_MS
      : ENRICHED_TTL_MS;
    if (!Number.isFinite(processedAt) || now - processedAt > ttl) delete cache.items[key];
  }
  cache.updated_at = new Date(now).toISOString();
  return cache;
}

function loadUsageLedger() {
  const ledger = readJsonFile(AI_USAGE_PATH, { version: 1, days: {} });
  ledger.version = 1;
  ledger.days = ledger.days && typeof ledger.days === "object" ? ledger.days : {};
  const cutoff = Date.now() - 45 * 86400000;
  for (const day of Object.keys(ledger.days)) {
    if (new Date(day + "T00:00:00Z").getTime() < cutoff) delete ledger.days[day];
  }
  return ledger;
}

function usageDay(ledger, day = utcDay()) {
  const defaults={
    calls: 0,
    attempts: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    regular_processed: 0,
    emergency_processed: 0,
    enriched: 0,
    rejected: 0,
    estimated_usd: 0
  };
  ledger.days[day]={...defaults,...(ledger.days[day]||{})};
  return ledger.days[day];
}

function estimatedUsageCost(usage) {
  const inputRate = Number(process.env.AI_INPUT_USD_PER_MTOK || 0);
  const outputRate = Number(process.env.AI_OUTPUT_USD_PER_MTOK || 0);
  const cacheWriteRate = Number(process.env.AI_CACHE_WRITE_USD_PER_MTOK || inputRate);
  const cacheReadRate = Number(process.env.AI_CACHE_READ_USD_PER_MTOK || inputRate);
  return (
    Number(usage.input_tokens || 0) * inputRate +
    Number(usage.output_tokens || 0) * outputRate +
    Number(usage.cache_creation_input_tokens || 0) * cacheWriteRate +
    Number(usage.cache_read_input_tokens || 0) * cacheReadRate
  ) / 1000000;
}

function addUsage(ledger, usage, meta = {}) {
  const day = usageDay(ledger);
  day.calls += Number(meta.attempts || 1);
  day.attempts += Number(meta.attempts || 1);
  for (const key of ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]) {
    day[key] += Number(usage && usage[key] || 0);
  }
  day.estimated_usd += estimatedUsageCost(usage || {});
  day.regular_processed += meta.lane === "regular" ? Number(meta.processed || 0) : 0;
  day.emergency_processed += meta.lane === "emergency" ? Number(meta.processed || 0) : 0;
  day.enriched += Number(meta.enriched || 0);
  day.rejected += Number(meta.rejected || 0);
  day.estimated_usd = Number(day.estimated_usd.toFixed(6));
  return day;
}

function cacheEntryFor(item, cache) {
  const entry = cache.items[articleCacheKey(item)];
  if (!entry) return null;
  if (entry.prompt_version !== PROMPT_VERSION) return null;
  if (entry.content_hash !== articleContentHash(item)) return null;
  return entry;
}

function rememberCacheResult(cache, source, status, result, lane = "regular", reason = "") {
  const now = new Date().toISOString();
  cache.items[articleCacheKey(source)] = {
    canonical_url: normalizedUrl(source.source_url),
    content_hash: articleContentHash(source),
    story_key: sha256(normalizedStoryTitle(source.title)),
    status,
    processed_at: now,
    model: AI_MODEL,
    prompt_version: PROMPT_VERSION,
    lane,
    reason,
    result: status === "enriched" ? result : undefined
  };
}

function appendStepSummary(ledger, extra = {}) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  const day = usageDay(ledger);
  const lines = [
    "## AI進化レーダー AI利用状況",
    "",
    `- 対象日 (UTC): ${utcDay()}`,
    `- API成功呼出: ${day.calls}回 / 試行: ${day.attempts}回`,
    `- 入力トークン: ${day.input_tokens}`,
    `- 出力トークン: ${day.output_tokens}`,
    `- 通常処理: ${day.regular_processed}/${AI_DAILY_UNIQUE_LIMIT}件`,
    `- 緊急処理: ${day.emergency_processed}/${AI_DAILY_EMERGENCY_LIMIT}件`,
    `- 採用: ${day.enriched}件 / 不採用: ${day.rejected}件`,
    `- 推定API費用: ${Number(day.estimated_usd || 0).toFixed(6)} USD`,
    `- キャッシュ再利用: ${Number(extra.cacheHits || 0)}件`,
    `- 再処理回避: ${Number(extra.rejectedHits || 0)}件`,
    `- 旧要約の深掘り再処理: ${Number(extra.migrationSelected || 0)}件`
  ];
  fs.appendFileSync(path, lines.join("\n") + "\n");
}

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
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error("Anthropic HTTP " + res.status + ": " + (await res.text()).slice(0, 300));
  const data = await res.json();
  if (data.stop_reason === "refusal") throw new Error("refusal");
  return {
    text:(data.content || []).filter(b => b.type === "text").map(b => b.text).join(""),
    stopReason:data.stop_reason || "",
    usage: {
      input_tokens: Number(data.usage && data.usage.input_tokens || 0),
      output_tokens: Number(data.usage && data.usage.output_tokens || 0),
      cache_creation_input_tokens: Number(data.usage && data.usage.cache_creation_input_tokens || 0),
      cache_read_input_tokens: Number(data.usage && data.usage.cache_read_input_tokens || 0)
    }
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
  const hasStructuredFlag=Boolean(item&&Object.prototype.hasOwnProperty.call(item,"structured_complete"));
  const legacyStructuredComplete=Boolean(item&&String(item.primary_entity||"").trim()&&
    String(item.story_subject||"").trim()&&String(item.event_type||"").trim()&&
    String(item.event_stage||"").trim()&&Object.prototype.hasOwnProperty.call(item,"event_scope")&&
    Array.isArray(item.fact_slots)&&Array.isArray(item.new_facts));
  const structuredComplete=item&&item.enrichment_version===PROMPT_VERSION
    ?(hasStructuredFlag?item.structured_complete===true:legacyStructuredComplete)
    :true;
  const deepExplanationComplete=item&&item.enrichment_version===PROMPT_VERSION
    ?hasDeepFriendlyExplanation(item.detail)
    :true;
  return !!item && structuredComplete && deepExplanationComplete &&
    ["title","raw_excerpt","detail","change_summary","impact_summary","action_suggestion","importance"]
      .every(k=>String(item[k]||"").trim()) &&
    Array.isArray(item.related_categories) && item.related_categories.length>0 &&
    isJapaneseDisplayItem(item);
}
function hasDeepFriendlyExplanation(value) {
  const raw=String(value||"").trim();
  const compact=raw.replace(/\s+/g,"");
  const paragraphs=raw.split(/\n+/).map(part=>part.trim()).filter(Boolean);
  const sentenceList=raw.split(/(?<=[。！？!?])/).map(part=>part.trim()).filter(Boolean);
  const longest=sentenceList.reduce((max,sentence)=>Math.max(max,sentence.replace(/\s+/g,"").length),0);
  return compact.length>=280&&compact.length<=440&&paragraphs.length===3&&
    sentenceList.length>=8&&sentenceList.length<=11&&longest<=85;
}
function needsDeepFriendlyMigration(item) {
  return Boolean(item)&&(item.enrichment_version!==PROMPT_VERSION||!hasDeepFriendlyExplanation(item.detail));
}
function bindLegacyMigrationIdentity(item,previousItems=[]) {
  if(!item||item.enrichment_version!==PROMPT_VERSION||item.migration_replacement_of)return item;
  const url=normalizedUrl(item.source_url);
  if(!url)return item;
  const legacy=previousItems.find(previous=>normalizedUrl(previous&&previous.source_url)===url&&
    previous.article_id&&needsDeepFriendlyMigration(previous));
  return legacy?{...item,migration_replacement_of:legacy.article_id}:item;
}
function preferCurrentEnrichment(items) {
  return items.map((item,index)=>({item,index,current:item&&item.enrichment_version===PROMPT_VERSION?1:0}))
    .sort((a,b)=>b.current-a.current||a.index-b.index)
    .map(entry=>entry.item);
}
function normalizeEventDate(value) {
  const raw=String(value||"").trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return "";
  const [year,month,day]=raw.split("-").map(Number);
  const date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?raw:"";
}
function normalizeEventStatus(value) {
  const allowed=new Set(["発表済み","開始済み","予定","継続中"]);
  const status=String(value||"").trim();
  return allowed.has(status)?status:"不明";
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
function rawDateStatus(value) {
  const raw=String(value||"").trim();
  if(!raw)return "unknown";
  return /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(raw)||/^\d{4}年\d{1,2}月\d{1,2}日$/.test(raw)
    ?"date_only":"published";
}
function explicitEventDateCandidates(text, referenceDate="") {
  const value=String(text||"");
  const matches=[];
  const referenceTime=new Date(referenceDate||"").getTime();
  const reference=Number.isFinite(referenceTime)?new Date(referenceTime):null;
  const patterns=[
    /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g,
    /(20\d{2})年(\d{1,2})月(\d{1,2})日/g
  ];
  const eventWords=/(発表|開始|公開|施行|発生|発売|提供|導入|締結|更新|予定|announc|launch|release|effective|occur|available)/i;
  const publicationWords=/(掲載日|投稿日|最終更新|published\s*(?:on|at)?|updated\s*(?:on|at)?)/i;
  const addCandidate=(date,matchIndex,matchLength,kind="explicit")=>{
    if(!date)return;
    const context=value.slice(Math.max(0,matchIndex-90),Math.min(value.length,matchIndex+matchLength+90)).replace(/\s+/g," ").trim();
    const immediate=value.slice(Math.max(0,matchIndex-28),Math.min(value.length,matchIndex+matchLength+2));
    if(!eventWords.test(context)||publicationWords.test(immediate))return;
    matches.push({date,context,kind});
  };
  for(const pattern of patterns){
    let match;
    while((match=pattern.exec(value))){
      const date=normalizeEventDate(`${match[1]}-${String(match[2]).padStart(2,"0")}-${String(match[3]).padStart(2,"0")}`);
      addCandidate(date,match.index,match[0].length);
    }
  }
  if(reference){
    const year=reference.getUTCFullYear();
    const yearlessPatterns=[
      {re:/(?<![\d年])(\d{1,2})月(\d{1,2})日/g,month:1,day:2},
      {re:/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi,english:true}
    ];
    const monthNames={january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
    for(const spec of yearlessPatterns){
      let match;
      while((match=spec.re.exec(value))){
        const month=spec.english?monthNames[String(match[1]).toLowerCase()]:Number(match[spec.month]);
        const day=Number(match[spec.english?2:spec.day]);
        const date=normalizeEventDate(`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`);
        addCandidate(date,match.index,match[0].length,"year_inferred_from_publication");
      }
    }
    const relativePatterns=[
      {re:/(?:本日|今日|同日|today)/gi,days:0},
      {re:/(?:昨日|前日|yesterday)/gi,days:-1}
    ];
    for(const spec of relativePatterns){
      let match;
      while((match=spec.re.exec(value))){
        const dateValue=new Date(Date.UTC(reference.getUTCFullYear(),reference.getUTCMonth(),reference.getUTCDate()+spec.days));
        addCandidate(dateValue.toISOString().slice(0,10),match.index,match[0].length,"relative_to_publication");
      }
    }
  }
  return [...new Map(matches.map(candidate=>[candidate.date+"|"+candidate.context,candidate])).values()].slice(0,5);
}
async function fetchArticleContext(item) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),7000);
  const fallback=()=>({
    text:item.raw_excerpt||"",source_published_at:"",source_updated_at:"",source_date_status:"unknown",
    event_date_candidates:explicitEventDateCandidates(item.raw_excerpt||"",item.source_published_at||item.published_at||"")
  });
  try{
    // Google Newsのリダイレクトページは本文の無いJSシェルを返し、汎用説明文が
    // article_contextに混入して「根拠なし」誤判定を招くため、取得せず抜粋を使う。
    try{ if(new URL(item.source_url).hostname.endsWith("news.google.com"))return fallback(); }
    catch(_invalidUrl){ return fallback(); }
    const res=await fetch(item.source_url,{redirect:"follow",signal:controller.signal,headers:{
      "User-Agent":"Mozilla/5.0 (compatible; AI-Radar/1.0; +https://reiki-ai-apps.github.io/AI-/)",
      "Accept":"text/html,application/xhtml+xml"
    }});
    if(!res.ok)return fallback();
    const type=String(res.headers.get("content-type")||"");
    if(!/html|xml|text/i.test(type))return fallback();
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
    // リダイレクト先がGoogle Newsのままなら本文は取得できていない。
    const finalHost=(()=>{try{return new URL(res.url||item.source_url).hostname;}catch(_e){return "";}})();
    if(finalHost.endsWith("news.google.com")||meta("og:site_name")==="Google News")return fallback();
    const paragraphs=[...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map(m=>stripTags(m[1])).filter(t=>t.length>=45);
    const jsonDate=(field)=>{
      const match=html.match(new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`,"i"));
      return match?match[1]:"";
    };
    const publishedRaw=meta("article:published_time")||meta("datePublished")||meta("date")||jsonDate("datePublished");
    const updatedRaw=meta("article:modified_time")||meta("dateModified")||jsonDate("dateModified");
    const openingParagraphs=paragraphs.slice(0,7);
    const endingParagraphs=paragraphs.slice(-4).filter(value=>!openingParagraphs.includes(value));
    const opening=[
      meta("og:description"),meta("description"),meta("twitter:description"),
      ...openingParagraphs
    ].filter(Boolean).join("\n");
    const ending=endingParagraphs.join("\n");
    const openingBudget=Math.floor(ARTICLE_CONTEXT_LIMIT*0.68);
    const endingBudget=ARTICLE_CONTEXT_LIMIT-openingBudget;
    const text=(
      "【記事の冒頭・要点】\n"+opening.slice(0,openingBudget)+
      (ending?"\n【記事後半・結び】\n"+ending.slice(-endingBudget):"")
    ).trim()||(item.raw_excerpt||"");
    return {
      text,
      source_published_at:toIso(publishedRaw)||"",
      source_updated_at:toIso(updatedRaw)||"",
      source_date_status:publishedRaw?rawDateStatus(publishedRaw):"unknown",
      event_date_candidates:explicitEventDateCandidates(text,toIso(publishedRaw)||item.source_published_at||item.published_at||"")
    };
  }catch(_error){
    return fallback();
  }finally{
    clearTimeout(timeout);
  }
}

async function aiEnrichBatch(items) {
  const list=items.map((it,i)=>({
    i,tool:it.tool,title:it.title,source:it.source_name||"",
    official:!!it.is_official,source_published_at:it.source_published_at||it.published_at||"",
    excerpt:String(it.raw_excerpt||"").slice(0,500),
    article_context:String(it.article_context||"").slice(0,ARTICLE_CONTEXT_LIMIT),
    event_date_candidates:Array.isArray(it.event_date_candidates)?it.event_date_candidates.slice(0,5):[]
  }));
  const system =
    "あなたは、AIに詳しくない人にも理解できる日本語で伝えるAIニュース編集者です。" +
    "製品アップデート、新機能、使い方、料金変更だけでなく、AI政策、規制、著作権、補助金・助成金、AI関連企業・株式、研究、セキュリティ、半導体など、利用者の仕事や生活に影響する情報を重視してください。" +
    "主要AI企業・研究所のCEO交代、著名研究者の退社、経営・研究体制の再編、大型買収・投資・提携は、製品名がタイトルになくても業界全体への波及を評価し、重要度SまたはAを積極的に検討してください。" +
    "記事本文の抜粋にない数字・人物・効果は作らず、不明な点は不明と明記してください。除外するのは広告・宣伝と、AIと無関係な別テーマの誤ヒットだけです。それ以外の記事は、確認できる事実の範囲で伝えることを優先してください。" +
    "要約文は元記事の論点と叙述順序を尊重し、主語と出来事から直接書き始め、元記事で確認できる事実・今後の予定・発表者の見解などで自然に結んでください。" +
    "やさしい解説は、AI業界を知らない高校生が一度で意味をつかめる言葉で書いてください。専門用語や英字略語は日常語へ言い換えるか、初出の直後に短く説明してください。一文には一つの内容だけを書き、長い修飾語や名詞を重ねた表現を避けてください。記事の核となる事実・仕組み・以前との違いを具体的に説明し、一般論で文字数を増やさないでください。" +
    "『まず、このニュースをひと言でいうと』『かんたんに言うと』『この記事では』などのメタな前置きや、元記事にない一般論・注意喚起・安心を促す定型文は使わないでください。";
  const user =
    "次のAI関連ニュース候補(JSON)を確認し、候補ごとに採用または除外を判定してください。すべての候補番号iについて必ず1件ずつ出力します。採用する場合は下記の全項目、除外する場合は {\"i\":元番号,\"skip\":true,\"reason_ja\":\"10〜40字の除外理由\"} だけを出力してください。\n" +
    "出力は次の形式のJSON配列だけ（前置き・説明・コードフェンスは一切不要）:\n" +
    '[{"i":元番号,"title_ja":"媒体名を除いた自然な日本語タイトル","summary_ja":"60〜100字で主語と結論が分かる要約","detail_ja":"300〜400字、8〜10文、空行2回で3段落。AI業界を知らない高校生向けに、一文を短くする。第1段落は、誰が何を発表・実施したか→簡単にいうと何か→以前との違い。第2段落は記事の核となる事実・数字→仕組み→なぜ重要か。第3段落は、使う人に何が変わるか→注意点→まだ発表されていないこと。元記事で確認できる具体的な情報だけを使い、従来より約5行増やしても一般論や同じ事実の言い換えで水増ししない。専門用語・英字略語・業界語は初出の直後に日常語で説明するか、日常語へ言い換える。impact_jaやaction_jaと同じ文を繰り返さない","change_ja":"何が新しいかを1〜2文","impact_ja":"日本の仕事・経営・生活への影響を1〜2文","action_ja":"元記事から具体的に確認できる次の確認事項・期限・利用条件を1〜2文。根拠がなければ行動を作らず、現時点の状況を簡潔に書く","event_date":"記事本文に出来事の年月日が明記されている場合だけYYYY-MM-DD、不明なら空文字","event_status":"発表済み|開始済み|予定|継続中|不明","story_entities":["企業名・製品名など話題を識別する固有名詞を1〜3件"],"importance":"S|A|B|C","categories":["指定カテゴリから1〜3件"],"primary_entity":"主体となる企業・組織名","story_subject":"具体的な製品・モデル・法律・事案・取引・計画の名前","event_type":"release|pricing|funding|security|policy|partnership|acquisition|research|other","event_stage":"rumor|announced|planned|beta|launched|expanded|paused|delayed|cancelled|investigating|cause_identified|fixed|restored|proposed|approved|enacted|completed|denied|corrected|other","event_scope":"API・デスクトップ・日本・全世界・影響範囲など","fact_slots":[{"type":"amount|price|region|date|availability|status|count|version|other","scope":"何についての事実か","value":"通貨・単位を含めて正規化した値"}],"new_facts_ja":["この記事で確認できる重要な事実。記事にない事実は書かない"]}]\n' +
    "指定カテゴリ:"+JSON.stringify(ALLOWED_CATEGORIES)+"\n"+
    "英語・中国語は自然な日本語に翻訳してください。article_contextを最優先の根拠にし、情報不足でもタイトルを言い換えただけの要約は作らないでください。detail_jaは、誰が何をしたか→日常語での意味→以前との違い→記事の核となる具体的事実・数字・仕組み→なぜ重要か→使う人への変化→注意点と未確定点、の順で、高校生にも読める3段落にしてください。一文は85字以内にし、一文へ複数の論点を詰め込まないでください。『相互運用性』『知識労働』『業務プロセス』のような業界語は、そのまま置かず日常語へ言い換えてください。GPU、APIなど残す必要がある英字語は、同じ文か次の文で意味を説明してください。固有名詞、数値、確認済みの条件は残し、元記事にない理由・効果・将来予測は加えないでください。impact_jaは仕事への影響、action_jaは次の確認事項に役割を分け、detail_jaとの文面重複を避けてください。説明のための定型的な導入や、どの記事にも当てはまる助言、同じ事実の言い換えで文字数を埋めてはいけません。event_date_candidatesは本文中で出来事を表す文の近くに明記された日付候補です。候補の文脈を確認し、発表日・施行日・発生日・提供開始日・予定日として明確なものだけevent_dateへ入れてください。記事の掲載日や更新日は出来事の日にしないでください。候補がない、または意味が曖昧なら空文字にしてください。skipにするのは、広告・宣伝、AIと無関係な誤ヒット、実質的な事実がひとつも確認できない記事だけです。article_contextが短い・取得できていない場合でも、タイトルと抜粋から確認できる事実の範囲で要約を作成し、不明な点は『まだ発表されていません』と平易に書いて採用してください。primary_entity以下の構造化項目は話題の同一判定に使うため、採用する記事では必ず出力してください(fact_slotsは確認できる事実だけ。なければ空配列)。モデル・製品名は正確に区別し(例: Gemini 3 FlashとGemini 3 Proは別物)、掲載日・閲覧数・四捨五入した換算金額・『5』と『5.0』の表記差を新しい進展として扱わないでください。地域や提供チャネルの違いは、同じ製品・制度が実際にそこへ拡大した場合だけ進展です。\n候補:\n" +
    JSON.stringify(list);

  let response;
  let attempts=0;
  for (let attempt = 0; attempt < 2; attempt++) {
    attempts=attempt+1;
    try { response = await callClaude(system, user); break; }
    catch (e) { console.error("AI厳選 試行" + (attempt + 1) + " 失敗:", String(e.message || e).slice(0, 200)); }
  }
  if(!response)return {ok:false,items:[],rejected:[],incomplete:[],usage:{},attempts};
  let arr = parseJsonArray(response.text);
  if (!arr && response.stopReason === "max_tokens") {
    // 出力が切り詰められた場合は、完全に閉じた要素までを部分復元してバッチ全損を避ける。
    const start = response.text.indexOf("[");
    const lastComplete = response.text.lastIndexOf("},");
    if (start >= 0 && lastComplete > start) {
      arr = parseJsonArray(response.text.slice(start, lastComplete + 1) + "]");
      if (arr) console.error("AI応答がmax_tokensで切り詰められたため、" + arr.length + "件を部分復元しました");
    }
  }
  if (!arr) {
    console.error("AI応答をJSON解析できませんでした。stop_reason="+response.stopReason+" chars="+response.text.length);
    return {ok:false,charged:true,items:[],rejected:[],incomplete:[],usage:response.usage||{},attempts};
  }

  const out = [];
  const acceptedIndexes=new Set();
  const skipReasons=new Map();
  for (const e of arr) {
    const idx = Number(e && e.i);
    if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) continue;
    if (e && e.skip === true) {
      if(!acceptedIndexes.has(idx))skipReasons.set(idx,normalizeStoryField(e.reason_ja||e.reason,160)||"理由未記載");
      continue;
    }
    const src = items[idx];
    const titleJa = cleanDisplayTitle((e.title_ja || "").toString().trim() || src.title,src.source_name);
    const sumJa = (e.summary_ja || "").toString().trim();
    const detailJa = (e.detail_ja || "").toString().trim();
    const categories=[...new Set((Array.isArray(e.categories)?e.categories:[])
      .map(String).filter(c=>ALLOWED_CATEGORIES.includes(c)))];
    const aiEventDate=normalizeEventDate(e.event_date);
    const deterministicCandidates=Array.isArray(src.event_date_candidates)?src.event_date_candidates:[];
    const eventDate=aiEventDate||((deterministicCandidates.length===1)?normalizeEventDate(deterministicCandidates[0].date):"");
    const structuredComplete=Boolean(
      String(e.primary_entity||"").trim()&&String(e.story_subject||"").trim()&&
      String(e.event_type||"").trim()&&String(e.event_stage||"").trim()&&
      Object.prototype.hasOwnProperty.call(e,"event_scope")&&
      Array.isArray(e.fact_slots)&&Array.isArray(e.new_facts_ja)
    );
    const item={
      tool: src.tool,
      title: titleJa,
      source_url: src.source_url,
      source_name: src.source_name || "",
      is_official: !!src.is_official,
      published_at: src.published_at||src.source_published_at||src.fetched_at||new Date().toISOString(),
      source_published_at: src.source_published_at||src.published_at||"",
      source_updated_at: src.source_updated_at||"",
      source_date_status: src.source_date_status||"published",
      fetched_at:src.fetched_at||new Date().toISOString(),
      event_at:eventDate,
      event_status: normalizeEventStatus(e.event_status),
      event_date_precision:eventDate?"day":"unknown",
      story_entities: Array.isArray(e.story_entities)?e.story_entities.map(String).map(v=>v.trim()).filter(Boolean).slice(0,3):[],
      primary_entity:normalizeStoryField(e.primary_entity,80),
      story_subject:normalizeStoryField(e.story_subject,120),
      event_type:normalizeEventType(e.event_type),
      event_stage:normalizeEventStage(e.event_stage),
      event_scope:normalizeStoryField(e.event_scope,120),
      fact_slots:normalizeFactSlots(e.fact_slots),
      new_facts:Array.isArray(e.new_facts_ja)?e.new_facts_ja.map(value=>normalizeStoryField(value,240)).filter(Boolean).slice(0,5):[],
      structured_complete:structuredComplete,
      raw_excerpt: sumJa || src.raw_excerpt,
      detail: detailJa,
      change_summary: (e.change_ja || "").toString().trim(),
      impact_summary: (e.impact_ja || "").toString().trim(),
      action_suggestion: (e.action_ja || "").toString().trim(),
      importance: ["S","A","B","C"].includes(String(e.importance||"").toUpperCase())?String(e.importance).toUpperCase():"B",
      related_categories:categories.length?categories:fallbackCategoryForTool(src.tool),
      enrichment_version:PROMPT_VERSION
    };
    if(isCompleteEnrichedItem(item)){
      out.push(item);
      acceptedIndexes.add(idx);
    }
  }
  // モデルが明示的にskipした記事だけを「不採用」として記録し、
  // 応答から漏れた・必須項目が欠けた記事は「retry」(後で再挑戦)に回す。
  const rejected=[];
  const rejectedReasons=[];
  const incomplete=[];
  items.forEach((source,index)=>{
    if(acceptedIndexes.has(index))return;
    if(skipReasons.has(index)){
      rejected.push(source);
      rejectedReasons.push("ai_skip: "+skipReasons.get(index));
    }else{
      incomplete.push(source);
    }
  });
  console.error("AI要約: "+out.length+"/"+items.length+"件（skip "+rejected.length+" / retry "+incomplete.length+" / model="+AI_MODEL+"）");
  return {ok:true,charged:true,items:out,rejected,rejectedReasons,incomplete,usage:response.usage||{},attempts};
}

async function enrichNewItems(items,cache,ledger,lane="regular",batchSize=AI_BATCH_SIZE) {
  if(!items.length)return {items:[],processed:0,rejected:0};
  if(!process.env.ANTHROPIC_API_KEY)throw new Error("ANTHROPIC_API_KEY 未設定");
  const enriched=[];
  let processed=0;
  let rejectedCount=0;
  for(let start=0;start<items.length;start+=batchSize){
    const dailyBudget=Number(process.env.AI_DAILY_BUDGET_USD||0);
    if(dailyBudget>0&&usageDay(ledger).estimated_usd>=dailyBudget){
      console.error("AI DAILY BUDGET REACHED: batch skipped");
      break;
    }
    const batch=items.slice(start,start+batchSize);
    const withContext=await Promise.all(batch.map(async item=>{
      const context=await fetchArticleContext(item);
      return {
        ...item,
        article_context:context.text,
        event_date_candidates:context.event_date_candidates,
        source_published_at:item.source_published_at||context.source_published_at||item.published_at||"",
        source_updated_at:item.source_updated_at||context.source_updated_at||"",
        source_date_status:item.source_date_status&&item.source_date_status!=="unknown"
          ?item.source_date_status:(context.source_date_status||"unknown")
      };
    }));
    const result=await aiEnrichBatch(withContext);
    addUsage(ledger,result.usage||{}, {
      lane,
      attempts:result.attempts,
      processed:result.charged?batch.length:0,
      enriched:result.items.length,
      rejected:result.rejected.length+((result.incomplete||[]).length)
    });
    if(!result.ok){
      if(result.charged){
        for(const source of batch)rememberCacheResult(cache,source,"retry",null,lane,"invalid_ai_response");
      }
      checkpointAiState(cache,ledger);
      continue;
    }
    processed+=batch.length;
    for(const item of result.items){
      const source=batch.find(candidate=>normalizedUrl(candidate.source_url)===normalizedUrl(item.source_url))
        || batch.find(candidate=>normalizedStoryTitle(candidate.title)===normalizedStoryTitle(item.title));
      const ready=source&&source.article_id&&needsDeepFriendlyMigration(source)
        ?{...item,migration_replacement_of:source.article_id}:item;
      enriched.push(ready);
      if(source)rememberCacheResult(cache,source,"enriched",ready,lane);
    }
    result.rejected.forEach((source,index)=>{
      rememberCacheResult(cache,source,"rejected",null,lane,
        (result.rejectedReasons&&result.rejectedReasons[index])||"ai_filtered");
      rejectedCount++;
    });
    // 応答漏れ・必須項目不足はRETRY_TTL経過後に自動で再挑戦する。
    for(const source of (result.incomplete||[])){
      rememberCacheResult(cache,source,"retry",null,lane,"missing_or_incomplete_ai_output");
      rejectedCount++;
    }
    checkpointAiState(cache,ledger);
  }
  return {items:enriched,processed,rejected:rejectedCount};
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
    const publishedRaw = tag(b, "pubDate") || tag(b, "published");
    const updatedRaw = tag(b, "updated");
    const desc = stripTags(tag(b, "description") || tag(b, "summary") || tag(b, "content")).slice(0, 500);
    out.push({
      title,link,
      date:toIso(publishedRaw),
      updatedAt:toIso(updatedRaw),
      dateSource:publishedRaw?rawDateStatus(publishedRaw):updatedRaw?"updated_only":"unknown",
      desc,official,sourceName
    });
  }
  return out;
}

function decodeHtmlText(value) {
  return stripTags(String(value||""))
    .replace(/\s+/g," ")
    .trim();
}

// RSSを提供しない公式変更履歴も、見出しと概要を根拠として候補化する。
// URLと内容ハッシュはAIキャッシュで照合され、内容が変わった時だけ再要約される。
function parseOfficialUpdatePage(html, url, toolName) {
  const source=String(html||"")
    .replace(/<script\b[\s\S]*?<\/script>/gi,"")
    .replace(/<style\b[\s\S]*?<\/style>/gi,"")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi,"")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi,"");
  const metaMatch=source.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/i)
    || source.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i);
  const headings=[...source.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map(match=>decodeHtmlText(match[1]))
    .filter(text=>text.length>=4&&text.length<=180&&!/^(menu|navigation|resources|footer|product updates?)$/i.test(text));
  const uniqueHeadings=[...new Set(headings)].slice(0,8);
  const description=decodeHtmlText(metaMatch&&metaMatch[1]||"");
  const excerpt=[description,...uniqueHeadings].filter(Boolean).join(" / ").slice(0,500);
  if(!excerpt)return null;
  const title=`${toolName} 公式更新: ${uniqueHeadings[0]||"最新の変更内容"}`.slice(0,220);
  return {
    title,link:url,date:"",updatedAt:"",dateSource:"unknown",desc:excerpt,
    official:true,sourceName:`${toolName} 公式更新情報`
  };
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
    .replace(/ハッキング|無断アクセス|不正アクセス|侵入/g,"不正侵入")
    .replace(/安全性検証|性能評価|テスト|評価|検証/g,"検証")
    .replace(/実在する(?:企業|組織)|企業システム|企業|組織|社/g,"組織")
    .replace(/[「」『』【】()[\]（）!?！？。、・:：'"“”‘’\-–—|｜]/g,"")
    .replace(/\s+/g,"")
    .replace(/(発表|公開|提供開始|明らかに|について|とは|ニュース)$/,"");
}
function storyText(item) {
  return `${item?.title||""} ${item?.raw_excerpt||item?.summary||item?.detail||""}`.toLowerCase();
}
function eventFamily(item) {
  const text=storyText(item);
  if(/資金調達|調達|出資|評価額|企業価値|上場|ipo|funding|valuation|investment/.test(text))return "funding";
  if(/規制|法案|行政命令|著作権|policy|regulation|law|copyright/.test(text))return "policy";
  if(/脆弱性|情報漏えい|攻撃|セキュリティ|ハッキング|侵入|無断アクセス|不正アクセス|外部アクセス|アクセス問題|security|vulnerability|breach|hack|unauthorized access/.test(text))return "security";
  if(/新モデル|モデルを発表|提供開始|発売|リリース|launch|release|new model/.test(text))return "release";
  if(/提携|協業|買収|合併|partnership|acquisition|merger/.test(text))return "corporate";
  return "";
}
function entityTokens(item) {
  const text=storyText(item);
  const aliases=(Array.isArray(item&&item.story_entities)?item.story_entities:[])
    .map(value=>String(value||"").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}.-]+/gu,""))
    .filter(value=>value.length>=3);
  const known=[
    [/\bopenai\b|\bchatgpt\b/,"openai"],[/\banthropic\b|\bclaude\b|アンソロピック/,"anthropic"],
    [/\bgoogle\b|\bgemini\b/,"google-gemini"],[/\bmoonshot\b|\bkimi\b|月之暗面/,"moonshot-ai"],
    [/\bdeepseek\b/,"deepseek"],[/\bminimax\b/,"minimax"],[/\bnvidia\b/,"nvidia"],
    [/\bnotebooklm\b/,"notebooklm"],[/\bcursor\b/,"cursor"],[/\brunway\b/,"runway"],
    [/\bsuno\b/,"suno"],[/\bcanva\b/,"canva"],[/\bperplexity\b/,"perplexity"],
    [/\bmicrosoft\b|マイクロソフト/,"microsoft"],[/\bapple\b|アップル/,"apple"],
    [/\bamazon\b|アマゾン/,"amazon"],[/\bmeta\b|メタ社/,"meta"]
  ];
  for(const [pattern,key] of known)if(pattern.test(text))aliases.push(key);
  const ignored=new Set([
    "the","and","for","with","from","into","about","this","that","new","news",
    "ai","api","agent","agents","model","models","tech","technology","company",
    "funding","launch","release","security","global","japan","china","chinese"
  ]);
  const latin=(text.match(/[a-z][a-z0-9.-]{2,}/g)||[])
    .map(token=>token.replace(/^[.-]+|[.-]+$/g,""))
    .filter(token=>token.length>=4&&!ignored.has(token)&&!/^https?$/.test(token));
  return new Set([...aliases,...latin]);
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
  const familyA=eventFamily(a),familyB=eventFamily(b);
  if(familyA&&familyA===familyB){
    const entitiesA=entityTokens(a),entitiesB=entityTokens(b);
    for(const entity of entitiesA)if(entitiesB.has(entity))return true;
  }
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
      if(timeGap>STORY_TIMELINE_WINDOW_MS)return false;
      const existingStructured=Boolean(existing.primary_entity&&existing.story_subject);
      const itemStructured=Boolean(item.primary_entity&&item.story_subject);
      if(existingStructured&&itemStructured)return classifyStoryRelation(existing,item).decision==="duplicate";
      // Old articles do not have the structured story fields introduced in v7.
      // Compare two legacy reports conservatively so cross-media paraphrases of
      // the same announcement disappear, without letting an incomplete legacy
      // record suppress a structured follow-up.
      if(!existingStructured&&!itemStructured){
        return isCertainRawDuplicate(existing,item)||isDuplicateReport(existing,item);
      }
      return isCertainRawDuplicate(existing,item);
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
  if(FEATURED_RESEARCH_SET.has(item.tool))score+=22;
  if(item.tool==="AI業界・経営重要速報")score+=34;
  if(/中国AI|世界の新モデル|政策|規制|補助金|セキュリティ|半導体/.test(item.tool||""))score+=16;
  if(/発表|公開|提供開始|新モデル|規制|法案|提携|買収|資金調達|脆弱性|料金/.test(item.title||""))score+=12;
  if(/CEO|最高経営責任者|会長|チーフサイエンティスト|経営体制|研究体制|人事|退任|退社|辞任|就任|再編|幹部/.test(item.title||""))score+=28;
  return score;
}

function criticalBucket(item) {
  const text=storyText(item)+" "+String(item&&item.tool||"").toLowerCase();
  if(/policy|regulation|law|government|政策|規制|政府|法律|法案|著作権/.test(text))return "policy";
  if(/security|vulnerability|breach|cyber|セキュリティ|脆弱性|情報漏えい|攻撃/.test(text))return "security";
  if(/moonshot|kimi|deepseek|qwen|zhipu|minimax|world.{0,4}model|new model|中国ai|新モデル|基盤モデル/.test(text))return "frontier";
  if(/nvidia|gpu|semiconductor|半導体|データセンター|aiインフラ/.test(text))return "semiconductor";
  if(/ceo|chief scientist|leadership|reorganiz|restructur|resign|depart|chairman|経営体制|研究体制|最高経営責任者|チーフサイエンティスト|退任|退社|辞任|就任|会長|再編|幹部/.test(text))return "leadership";
  return "";
}

function selectProtectedCandidates(items,limit) {
  const sorted=[...items].sort((a,b)=>candidateScore(b)-candidateScore(a));
  const selected=[];
  const selectedKeys=new Set();
  const toolCounts=new Map();
  const add=item=>{
    const key=articleCacheKey(item);
    if(selectedKeys.has(key)||selected.length>=limit)return false;
    selected.push(item);
    selectedKeys.add(key);
    toolCounts.set(item.tool,(toolCounts.get(item.tool)||0)+1);
    return true;
  };
  for(const bucket of ["policy","security","frontier","semiconductor","leadership"]){
    const item=sorted.find(candidate=>criticalBucket(candidate)===bucket&&!selectedKeys.has(articleCacheKey(candidate)));
    if(item)add(item);
  }
  // 主要ツールの候補を最低1件ずつ巡回させ、人気製品だけへの偏りを防ぐ。
  for(const toolName of FEATURED_RESEARCH_TOOL_NAMES){
    if(selected.length>=limit)break;
    const item=sorted.find(candidate=>candidate.tool===toolName&&!selectedKeys.has(articleCacheKey(candidate)));
    if(item)add(item);
  }
  for(const item of sorted){
    if(selected.length>=limit)break;
    if((toolCounts.get(item.tool)||0)>=2)continue;
    add(item);
  }
  for(const item of sorted){
    if(selected.length>=limit)break;
    add(item);
  }
  return selected;
}

const EVENT_TYPES=new Set(["release","pricing","funding","security","policy","partnership","acquisition","research","other"]);
const EVENT_STAGES=new Set(["rumor","announced","planned","beta","launched","expanded","paused","delayed","cancelled","investigating","cause_identified","fixed","restored","proposed","approved","enacted","completed","denied","corrected","other"]);

function normalizeStoryField(value,maxLength=160) {
  return String(value||"").normalize("NFKC").replace(/\s+/g," ").trim().slice(0,maxLength);
}

function normalizeEventType(value) {
  const normalized=normalizeStoryField(value,40).toLowerCase().replace(/[\s-]+/g,"_");
  return EVENT_TYPES.has(normalized)?normalized:"other";
}

function normalizeEventStage(value) {
  const normalized=normalizeStoryField(value,40).toLowerCase().replace(/[\s-]+/g,"_");
  return EVENT_STAGES.has(normalized)?normalized:"other";
}

function normalizeComparableText(value) {
  return normalizeStoryField(value,240).toLowerCase()
    .replace(/オープンai/g,"openai")
    .replace(/日本/g,"japan")
    .replace(/chat\s*gpt/g,"chatgpt")
    .replace(/gpt[-\s]?(\d+(?:\.\d+)?)/g,"gpt$1")
    .replace(/gemini[-\s]?(\d+(?:\.\d+)?)/g,"gemini$1")
    .replace(/claude[-\s]?(\d+(?:\.\d+)?)/g,"claude$1")
    .replace(/[^\p{L}\p{N}.]+/gu,"");
}

function canonicalNumericValue(value,type="other") {
  const text=normalizeStoryField(value,160).toLowerCase().replace(/,/g,"");
  if(type==="date"){
    const iso=text.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
    const ja=text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    const parts=iso||ja;
    if(parts){
      const normalized=`${parts[1]}-${String(parts[2]).padStart(2,"0")}-${String(parts[3]).padStart(2,"0")}`;
      return normalizeEventDate(normalized)||normalizeComparableText(text);
    }
    return normalizeComparableText(text);
  }
  if(type==="version"){
    return normalizeComparableText(text)
      .replace(/^version/,"v")
      .replace(/^ver/,"v");
  }
  const match=text.match(/(-?\d+(?:\.\d+)?)\s*(千億|兆|億|万|千|trillion|billion|million|thousand|bn|mn|k)?/i);
  if(!match)return normalizeComparableText(text);
  let number=Number(match[1]);
  if(!Number.isFinite(number))return normalizeComparableText(text);
  const unit=String(match[2]||"").toLowerCase();
  const multipliers={"千億":1e11,"兆":1e12,"億":1e8,"万":1e4,"千":1e3,trillion:1e12,billion:1e9,million:1e6,thousand:1e3,bn:1e9,mn:1e6,k:1e3};
  number*=multipliers[unit]||1;
  const currency=/usd|us\$|\$|dollars?|ドル/.test(text)?"USD":/jpy|yen|円|￥|¥/.test(text)?"JPY":"";
  const suffix=/%/.test(text)?"%":currency;
  return `${Number(number.toPrecision(12))}${suffix}`;
}

function fundingRoundSignature(...values) {
  const text=values.map(value=>normalizeStoryField(value,160).toLowerCase()).join(" ");
  const match=text.match(/(?:series|シリーズ)\s*[-:]?\s*([a-z]|\d+)/i);
  return match?`series-${match[1].toLowerCase()}`:"";
}

function canonicalFactScope(type,scope,item={}) {
  const round=fundingRoundSignature(scope,item.event_scope,item.story_subject);
  if(type==="amount"&&round)return round;
  let value=normalizeComparableText(scope)
    .replace(/\b(?:the|this|that|for|of)\b/g,"")
    .replace(/(?:fundinground|financinground|資金調達ラウンド)/g,"funding");
  if(/api/.test(value)&&/avail|提供|利用/.test(value))return "api-availability";
  if(/desktop|デスクトップ/.test(value))return "desktop";
  if(/mobile|スマホ|モバイル/.test(value))return "mobile";
  if(/web|ウェブ/.test(value))return "web";
  return value;
}

function normalizeFactSlots(value) {
  if(!Array.isArray(value))return [];
  const allowed=new Set(["amount","price","region","date","availability","status","count","version","other"]);
  const slots=[];
  for(const entry of value){
    if(!entry||typeof entry!=="object")continue;
    const type=normalizeStoryField(entry.type,30).toLowerCase();
    const scope=normalizeStoryField(entry.scope,120);
    const rawValue=normalizeStoryField(entry.value,160);
    if(!rawValue)continue;
    slots.push({
      type:allowed.has(type)?type:"other",
      scope,
      value:rawValue,
      normalized_value:canonicalNumericValue(rawValue,allowed.has(type)?type:"other")
    });
  }
  return slots.slice(0,12);
}

function structuredStoryProfile(item) {
  const entities=storyEntitiesFor(item);
  const primary=normalizeComparableText(item&&item.primary_entity||entities[0]||"");
  const subject=normalizeComparableText(item&&item.story_subject||entities.find(value=>normalizeComparableText(value)!==primary)||"");
  const type=normalizeEventType(item&&item.event_type||eventFamily(item)||"other");
  const stage=normalizeEventStage(item&&item.event_stage||"other");
  const scope=normalizeComparableText(item&&item.event_scope||"");
  return {primary,subject,type,stage,scope,entities:new Set(entities.map(normalizeComparableText).filter(Boolean))};
}

function modelSignature(value) {
  const text=String(value||"").toLowerCase();
  // Preview/beta/general-availability are lifecycle stages, not model IDs.
  const variants=(text.match(/(?:flash|pro|ultra|mini|max|nano|turbo|thinking)/g)||[]).sort();
  const versions=(text.match(/\d+(?:\.\d+)?/g)||[]).map(value=>String(Number(value))).sort();
  return [...variants,...versions].join("|");
}

function subjectRelation(a,b) {
  if(!a||!b)return "unknown";
  if(a===b)return "same";
  const signatureA=modelSignature(a),signatureB=modelSignature(b);
  if(signatureA&&signatureB&&signatureA!==signatureB)return "conflict";
  if(signatureA&&signatureA===signatureB){
    const productPattern=/(?:gpt|gemini|claude|llama|kimi|deepseek|veo|kling)\d+(?:\.\d+)?/u;
    const productA=a.match(productPattern);
    const productB=b.match(productPattern);
    if(a.includes(b)||b.includes(a)||(productA&&productB&&productA[0]===productB[0]))return "same";
  }
  if(a.includes(b)||b.includes(a))return Math.min(a.length,b.length)>=5?"same":"unknown";
  const gramsA=titleGrams(a),gramsB=titleGrams(b);
  if(!gramsA.size||!gramsB.size)return "different";
  let overlap=0;for(const gram of gramsA)if(gramsB.has(gram))overlap++;
  const ratio=overlap/Math.max(gramsA.size,gramsB.size);
  return ratio>=0.7?"same":ratio>=0.35?"uncertain":"different";
}

function storyMatchScore(previous,current) {
  const a=structuredStoryProfile(previous),b=structuredStoryProfile(current);
  const reasons=[];
  let score=0;
  const urlA=normalizedUrl(previous&&previous.source_url),urlB=normalizedUrl(current&&current.source_url);
  if(urlA&&urlB&&urlA===urlB){score+=0.18;reasons.push("same_url");}
  if(a.primary&&b.primary&&a.primary===b.primary){score+=0.22;reasons.push("same_primary_entity");}
  else if(setsShareValue(a.entities,b.entities)){score+=0.12;reasons.push("shared_entity");}
  const subject=subjectRelation(a.subject,b.subject);
  if(subject==="conflict")return {score:0,reasons:["conflicting_subject"],subject};
  if(subject==="same"){score+=0.38;reasons.push("same_subject");}
  else if(subject==="uncertain"){score+=0.14;reasons.push("uncertain_subject");}
  else if(subject==="different"){score-=0.18;reasons.push("different_subject");}
  if(a.type!=="other"&&a.type===b.type){score+=0.16;reasons.push("same_event_type");}
  else if(a.type!=="other"&&b.type!=="other"&&a.type!==b.type)score-=0.12;
  if(a.type==="funding"&&b.type==="funding"){
    const roundA=fundingRoundSignature(previous&&previous.event_scope,previous&&previous.story_subject,
      ...((previous&&previous.fact_slots)||[]).map(slot=>slot&&slot.scope));
    const roundB=fundingRoundSignature(current&&current.event_scope,current&&current.story_subject,
      ...((current&&current.fact_slots)||[]).map(slot=>slot&&slot.scope));
    if(roundA&&roundB&&roundA!==roundB)return {score:0,reasons:["conflicting_funding_round"],subject:"conflict"};
  }
  const similarity=titleSimilarity(previous&&previous.title,current&&current.title);
  score+=Math.min(0.18,similarity*0.18);
  if(similarity>=0.65)reasons.push("similar_title");
  if(a.scope&&b.scope&&a.scope===b.scope){score+=0.06;reasons.push("same_scope");}
  return {score:Math.max(0,Math.min(1,score)),reasons,subject};
}

function factSlotKey(slot,item={}) {
  return `${slot.type}|${canonicalFactScope(slot.type,slot.scope,item)}`;
}

function approximatelyEquivalentAmount(a,b) {
  const parse=value=>{
    const match=String(value||"").match(/^(-?\d+(?:\.\d+)?)(USD|JPY)?$/);
    return match?{number:Number(match[1]),currency:match[2]||""}:null;
  };
  const left=parse(a),right=parse(b);
  if(!left||!right||!left.number||!right.number)return false;
  if(left.currency===right.currency)return Math.abs(left.number-right.number)/Math.max(Math.abs(left.number),Math.abs(right.number))<=0.01;
  if(new Set([left.currency,right.currency]).size===2&&left.currency&&right.currency){
    const usd=left.currency==="USD"?left.number:right.number;
    const jpy=left.currency==="JPY"?left.number:right.number;
    const rate=jpy/usd;
    return rate>=120&&rate<=190;
  }
  return false;
}

function compareMaterialFacts(previous,current) {
  const before=normalizeFactSlots(previous&&previous.fact_slots);
  const after=normalizeFactSlots(current&&current.fact_slots);
  const beforeByKey=new Map(before.map(slot=>[factSlotKey(slot,previous),slot]));
  const changes=[];
  for(const slot of after){
    if(slot.type==="other"){
      // 許可外タイプが潰された"other"スロットも、同一キーで値が変わった場合は進展として扱う。
      // (スコープが雑多なotherの新規追加は偽続報を生みやすいため、addedにはしない)
      const old=beforeByKey.get(factSlotKey(slot,current));
      if(old&&old.normalized_value!==slot.normalized_value)changes.push({kind:"changed",before:old,slot});
      continue;
    }
    let old=beforeByKey.get(factSlotKey(slot,current));
    if(!old){
      old=before.find(candidate=>candidate.type===slot.type&&
        (candidate.normalized_value===slot.normalized_value||
          ((slot.type==="amount"||slot.type==="price")&&approximatelyEquivalentAmount(candidate.normalized_value,slot.normalized_value))));
    }
    if(!old){changes.push({kind:"added",slot});continue;}
    if(old.normalized_value===slot.normalized_value)continue;
    if((slot.type==="amount"||slot.type==="price")&&approximatelyEquivalentAmount(old.normalized_value,slot.normalized_value))continue;
    changes.push({kind:"changed",before:old,slot});
  }
  return changes;
}

function meaningfulNewFacts(previous,current) {
  const before=new Set((Array.isArray(previous&&previous.new_facts)?previous.new_facts:[])
    .map(normalizeComparableText).filter(Boolean));
  return (Array.isArray(current&&current.new_facts)?current.new_facts:[])
    .map(value=>String(value||"").trim())
    .filter(value=>value&&!before.has(normalizeComparableText(value)))
    .filter(value=>/開始|公開|提供|拡大|追加|変更|値上げ|値下げ|承認|施行|修正|復旧|原因|停止|延期|中止|否定|撤回|launch|release|expand|add|change|approve|enact|fix|restore|pause|delay|cancel|deny|withdraw/i.test(value));
}

function isForwardStageTransition(type,before,after) {
  if(!before||!after||before==="other"||after==="other"||before===after)return false;
  if(after==="corrected")return true;
  const terminal=new Set(["cancelled","denied"]);
  if(terminal.has(after))return true;
  const paths={
    release:{
      rumor:["announced","planned","beta","launched"],announced:["planned","beta","launched"],
      planned:["beta","launched","delayed"],beta:["launched","expanded","paused"],
      launched:["expanded","paused"],expanded:["paused"],paused:["restored"],delayed:["beta","launched"]
    },
    security:{
      rumor:["announced","investigating","denied"],announced:["investigating","cause_identified","fixed"],
      investigating:["cause_identified","fixed","restored","denied"],cause_identified:["fixed","restored"],
      fixed:["restored"]
    },
    policy:{
      rumor:["announced","proposed","denied"],announced:["proposed","approved","enacted"],
      proposed:["approved","enacted","denied"],approved:["enacted","denied"]
    },
    funding:{
      rumor:["announced","planned","denied"],planned:["announced","completed","delayed"],
      announced:["completed","delayed","denied"],delayed:["completed","denied"]
    },
    partnership:{rumor:["announced","planned","denied"],planned:["announced","completed"],announced:["completed","denied"]},
    acquisition:{rumor:["announced","planned","denied"],planned:["announced","completed"],announced:["completed","denied"]},
    pricing:{planned:["announced","launched","delayed"],announced:["launched","delayed"],delayed:["launched"]},
    research:{planned:["announced","completed"],announced:["completed"]},
    other:{planned:["announced","completed","delayed"],announced:["completed"],investigating:["cause_identified","fixed","restored"]}
  };
  return Boolean(paths[type]&&paths[type][before]&&paths[type][before].includes(after));
}

function deliveryChannel(value) {
  const text=normalizeComparableText(value);
  if(/desktop|デスクトップ/.test(text))return "desktop";
  if(/mobile|スマホ|モバイル/.test(text))return "mobile";
  if(/web|ウェブ/.test(text))return "web";
  if(/api/.test(text))return "api";
  return "";
}

function classifyStoryRelation(previous,current,matchResult=storyMatchScore(previous,current)) {
  if(!previous)return {decision:"new",confidence:1,reasons:["no_previous_story"],changes:[]};
  if(matchResult.score<0.5)return {decision:"new",confidence:1-matchResult.score,reasons:matchResult.reasons,changes:[]};
  if(matchResult.score<0.72)return {decision:"uncertain",confidence:matchResult.score,reasons:matchResult.reasons,changes:[]};
  const changes=compareMaterialFacts(previous,current);
  const before=structuredStoryProfile(previous),after=structuredStoryProfile(current);
  const stageChanged=isForwardStageTransition(after.type,before.stage,after.stage);
  const invalidStageChange=before.stage!=="other"&&after.stage!=="other"&&before.stage!==after.stage&&!stageChanged;
  const beforeChannel=deliveryChannel(previous&&previous.event_scope);
  const afterChannel=deliveryChannel(current&&current.event_scope);
  const conflictingChannel=after.type==="release"&&beforeChannel&&afterChannel&&beforeChannel!==afterChannel&&after.stage!=="expanded";
  const sameUrl=normalizedUrl(previous&&previous.source_url)&&
    normalizedUrl(previous&&previous.source_url)===normalizedUrl(current&&current.source_url);
  const sameUrlChangedContent=sameUrl&&articleContentHash(previous)!==articleContentHash(current);
  const editorialText=`${storyText(current)} ${current&&current.change_summary||""} ${
    Array.isArray(current&&current.new_facts)?current.new_facts.join(" "):""}`;
  const correction=after.stage==="corrected"||/correction|訂正|撤回|誤報/.test(editorialText);
  if(correction)return {decision:"correction",confidence:Math.max(0.82,matchResult.score),reasons:[...matchResult.reasons,"correction"],changes};
  if(invalidStageChange||conflictingChannel){
    if(invalidStageChange&&!changes.length){
      return {decision:"duplicate",confidence:matchResult.score,reasons:[...matchResult.reasons,"non_forward_stage_wording"],changes:[]};
    }
    return {decision:"uncertain",confidence:matchResult.score,reasons:[...matchResult.reasons,invalidStageChange?"non_forward_stage_change":"conflicting_delivery_channel"],changes};
  }
  const scopeChanged=before.scope&&after.scope&&before.scope!==after.scope&&after.stage==="expanded";
  const textFacts=meaningfulNewFacts(previous,current);
  if(stageChanged||scopeChanged||changes.length||textFacts.length){
    return {decision:"follow_up",confidence:Math.max(0.82,matchResult.score),reasons:[...matchResult.reasons,...(stageChanged?["stage_changed"]:[]),...(scopeChanged?["scope_expanded"]:[]),...(changes.length?["material_fact_changed"]:[])],changes};
  }
  if(sameUrlChangedContent)return {decision:"uncertain",confidence:matchResult.score,reasons:[...matchResult.reasons,"same_url_content_changed"],changes:[]};
  return {decision:"duplicate",confidence:matchResult.score,reasons:[...matchResult.reasons,"no_material_change"],changes:[]};
}

function titleSimilarity(a,b) {
  const ag=titleGrams(a),bg=titleGrams(b);
  if(!ag.size||!bg.size)return 0;
  let overlap=0;
  for(const gram of ag)if(bg.has(gram))overlap++;
  return overlap/Math.max(ag.size,bg.size);
}

function numericTokens(item) {
  return new Set((storyText(item).match(/\d+(?:[.,]\d+)?(?:%|億|兆|万|billion|million)?/gi)||[])
    .map(value=>value.toLowerCase().replace(/,/g,"")));
}

function setsShareValue(a,b) {
  for(const value of a)if(b.has(value))return true;
  return false;
}

function eventSignalTokens(item) {
  const text=storyText(item);
  const rules=[
    [/ハッキング|不正アクセス|無断アクセス|不正侵入|侵入|hack|unauthorized access/,"unauthorized-access"],
    [/安全性検証|性能評価|テスト|試験|評価|検証|実験|test|evaluation|experiment/,"evaluation"],
    [/脆弱性|ぜい弱性|vulnerability/,"vulnerability"],
    [/修正|対策|更新|fix|patch|mitigation/,"remediation"],
    [/資金調達|調達|出資|funding|investment/,"funding"],
    [/新モデル|提供開始|発売|リリース|launch|release|new model/,"release"],
    [/提携|協業|partnership|collaboration/,"partnership"],
    [/規制|法案|行政命令|regulation|law|executive order/,"regulation"],
    [/要請|要求|求めた|request|urge|ask/,"request"],
    [/価格|料金|値上げ|値下げ|pricing|price/,"pricing"]
  ];
  return new Set(rules.filter(([pattern])=>pattern.test(text)).map(([,key])=>key));
}

function sharedValueCount(a,b) {
  let count=0;
  for(const value of a)if(b.has(value))count++;
  return count;
}

function numbersConflict(a,b) {
  const an=numericTokens(a),bn=numericTokens(b);
  return an.size>0&&bn.size>0&&
    (an.size!==bn.size||[...an].some(value=>!bn.has(value)));
}

// 同じ会社を扱うだけの記事は消さない。同じ発表の転載・言い換えだけを重複とする。
function isDuplicateReport(a,b) {
  const au=normalizedUrl(a.source_url),bu=normalizedUrl(b.source_url);
  if(au&&bu&&au===bu)return true;
  const similarity=titleSimilarity(a.title,b.title);
  if(numbersConflict(a,b))return false;
  if(similarity>=0.82)return true;
  // Long Japanese headlines from different media commonly replace only the
  // audience or location phrase. A high trigram overlap is strong evidence of
  // the same announcement even when legacy data has no event/entity fields.
  const titleA=normalizedStoryTitle(a.title),titleB=normalizedStoryTitle(b.title);
  if(Math.min(titleA.length,titleB.length)>=18&&similarity>=0.68)return true;
  const familyA=eventFamily(a),familyB=eventFamily(b);
  if(!familyA||familyA!==familyB)return false;
  if(!setsShareValue(entityTokens(a),entityTokens(b)))return false;
  if(similarity>=0.52)return true;
  return sharedValueCount(eventSignalTokens(a),eventSignalTokens(b))>=2;
}

function stableArticleId(item) {
  return "article_"+sha256(normalizedUrl(item.source_url)||
    `${normalizedStoryTitle(item.title)}|${item.source_published_at||item.published_at||""}`).slice(0,20);
}

function storyEntitiesFor(item) {
  const values=[...(Array.isArray(item.story_entities)?item.story_entities:[]),...entityTokens(item)];
  const normalized=values.map(value=>String(value||"").normalize("NFKC").trim()).filter(value=>value.length>=3);
  if(!normalized.length&&item.tool)normalized.push(String(item.tool));
  return [...new Set(normalized)].slice(0,5);
}

function sameContinuingTopic(previous,current) {
  return storyMatchScore(previous,current).score>=0.72;
}

function progressStage(item) {
  const text=storyText(item);
  const family=eventFamily(item);
  const stages={
    release:[
      [/予告|計画|予定|開発中|announc|plan|preview|coming soon/,1],
      [/試験|テスト|ベータ|pilot|test|beta/,2],
      [/提供開始|公開|発売|正式リリース|利用可能|launch|release|available|general availability/,3],
      [/拡大|追加提供|対応地域.*増|展開.*拡|expand|rollout|additional regions/,4]
    ],
    security:[
      [/疑い|可能性|報告|発見|判明|disclos|discover|report/,1],
      [/確認|調査|検証|investigat|confirm/,2],
      [/修正|パッチ|対策|緩和|fix|patch|mitigat/,3],
      [/復旧|解決|完了|収束|resolved|restored|completed/,4]
    ],
    policy:[
      [/要請|提案|方針|request|proposal|guideline/,1],
      [/提出|審議|協議|filed|introduced|deliberat/,2],
      [/承認|可決|成立|署名|approved|passed|signed/,3],
      [/施行|適用開始|発効|enforced|effective|takes effect/,4]
    ],
    funding:[
      [/検討|交渉|計画|見込み|talks|seeking|plans?/,1],
      [/調達|出資|投資|raises?|funding|investment/,2],
      [/完了|確定|クローズ|completed|closed|finalized/,3]
    ],
    corporate:[
      [/協議|交渉|検討|talks|considering/,1],
      [/合意|契約|提携|agreement|partnership|deal/,2],
      [/完了|買収完了|統合|completed|acquired|merged/,3]
    ]
  };
  let rank=0;
  for(const [pattern,value] of stages[family]||[])if(pattern.test(text))rank=Math.max(rank,value);
  return {family,rank};
}

function textCoverage(needle,haystack) {
  const grams=titleGrams(needle),known=titleGrams(haystack);
  if(!grams.size||!known.size)return 0;
  let overlap=0;
  for(const gram of grams)if(known.has(gram))overlap++;
  return overlap/grams.size;
}

function meaningfulFactCandidates(item) {
  const facts=[
    ...(Array.isArray(item&&item.new_facts)?item.new_facts:[]),
    item&&item.change_summary
  ];
  return facts.map(value=>String(value||"").trim()).filter(value=>
    value.length>=12&&/新たに|追加|拡大|開始|公開|発売|承認|可決|成立|施行|修正|パッチ|復旧|解決|完了|確定|合意|延期|中止|撤回|判明|確認|調達|買収|new|additional|expand|launch|release|approve|pass|enforce|fix|patch|resolve|complete|confirm|delay|cancel|raise|acquir/i.test(value)
  );
}

// 掲載日や媒体が変わっただけでは進捗とみなさない。事実・数値・状態の変化だけを続報の根拠にする。
function hasMeaningfulProgress(previous,current) {
  const relation=classifyStoryRelation(previous,current);
  return relation.decision==="follow_up"||relation.decision==="correction";
}

function findBestStoryMatch(history,current,maxGap=STORY_TIMELINE_WINDOW_MS) {
  const currentTime=articleTime(current);
  let best=null;
  for(const candidate of history){
    if(!candidate)continue;
    const sameArticleId=Boolean(candidate.article_id&&current.article_id&&candidate.article_id===current.article_id);
    // A retained article is present in both data.json and the story index on the
    // next run.  Do not compare that article with itself.  When the publisher
    // changes the content at the same URL, however, keep it as a revision
    // candidate so corrections and genuine progress can still be detected.
    if(sameArticleId&&articleContentHash(candidate)===articleContentHash(current))continue;
    const candidateTime=articleTime(candidate);
    const gap=currentTime-candidateTime;
    if(!Number.isFinite(gap)||gap<0||gap>maxGap)continue;
    const match=storyMatchScore(candidate,current);
    if(match.score<0.5)continue;
    if(!best||match.score>best.match.score||
      (match.score===best.match.score&&candidateTime>articleTime(best.candidate))){
      best={candidate,match,gap};
    }
  }
  return best;
}

function findPreviousStory(history,current,maxGap=STORY_TIMELINE_WINDOW_MS) {
  const best=findBestStoryMatch(history,current,maxGap);
  return best?best.candidate:null;
}

function rawDuplicateFingerprint(item) {
  return sha256([
    normalizedStoryTitle(item&&item.title),
    normalizeComparableText(item&&item.raw_excerpt||"")
  ].join("\n"));
}

function isCertainRawDuplicate(previous,current) {
  const urlA=normalizedUrl(previous&&previous.source_url),urlB=normalizedUrl(current&&current.source_url);
  if(urlA&&urlB&&urlA===urlB&&articleContentHash(previous)===articleContentHash(current))return true;
  return normalizedStoryTitle(previous&&previous.title)===normalizedStoryTitle(current&&current.title)&&
    rawDuplicateFingerprint(previous)===rawDuplicateFingerprint(current);
}

function filterStaleRawCandidates(items,historyItems=[]) {
  const kept=[];
  for(const item of items){
    if([...historyItems,...kept].some(previous=>isCertainRawDuplicate(previous,item)))continue;
    kept.push(item);
  }
  return kept;
}

function articleTime(item) {
  for(const value of [item&&item.source_published_at,item&&item.published_at,item&&item.fetched_at]){
    const time=new Date(value||"").getTime();
    if(Number.isFinite(time))return time;
  }
  return 0;
}

function normalizeTimelineItem(item) {
  const sourcePublished=String(item.source_published_at||item.published_at||"").trim();
  const eventAt=normalizeEventDate(item.event_at||item.event_date);
  const sequence=Number(item.story_sequence);
  return {
    ...item,
    article_id:item.article_id||stableArticleId(item),
    source_published_at:sourcePublished,
    source_updated_at:String(item.source_updated_at||"").trim(),
    source_date_status:item.source_date_status||(sourcePublished?"published":"unknown"),
    fetched_at:String(item.fetched_at||new Date().toISOString()),
    event_at:eventAt,
    event_status:normalizeEventStatus(item.event_status),
    event_date_precision:eventAt?"day":"unknown",
    story_entities:storyEntitiesFor(item),
    primary_entity:normalizeStoryField(item.primary_entity,80),
    story_subject:normalizeStoryField(item.story_subject,120),
    event_type:normalizeEventType(item.event_type||eventFamily(item)||"other"),
    event_stage:normalizeEventStage(item.event_stage),
    event_scope:normalizeStoryField(item.event_scope,120),
    fact_slots:normalizeFactSlots(item.fact_slots),
    story_id:String(item.story_id||""),
    story_sequence:Number.isFinite(sequence)&&sequence>=1?Math.floor(sequence):1,
    relation_type:["new","follow_up","correction"].includes(item.relation_type)?item.relation_type:"new",
    relation_confidence:Number(item.relation_confidence||0),
    previous_article_id:String(item.previous_article_id||""),
    previous_title:String(item.previous_title||""),
    previous_source_published_at:String(item.previous_source_published_at||""),
    continuation_lead:String(item.continuation_lead||""),
    new_facts:Array.isArray(item.new_facts)?item.new_facts.map(value=>normalizeStoryField(value,240)).filter(Boolean).slice(0,5):[],
    dedupe_decision:["new","duplicate","follow_up","correction","uncertain"].includes(item.dedupe_decision)?item.dedupe_decision:"new",
    dedupe_reasons:Array.isArray(item.dedupe_reasons)?item.dedupe_reasons.map(String).slice(0,8):[]
  };
}

function connectStoryTimeline(items,historyItems=[],publishedIds=null) {
  const history=historyItems.map(normalizeTimelineItem).sort((a,b)=>articleTime(a)-articleTime(b));
  const result=[];
  const ordered=[...items].map(normalizeTimelineItem).sort((a,b)=>articleTime(a)-articleTime(b));
  for(const raw of ordered){
    // 現在の記事だけ関連付けを再判定し、履歴側に保存した連番は保持する。
    const source={...normalizeTimelineItem(raw),story_id:"",story_sequence:1,relation_type:"new",
      relation_confidence:0,previous_article_id:"",previous_title:"",previous_source_published_at:"",
      continuation_lead:"",dedupe_decision:"new",dedupe_reasons:[]};
    const versionHistory=[...history,...result];
    const sourceUrl=normalizedUrl(source.source_url);
    const sourceHash=articleContentHash(source);
    if(sourceUrl){
      const migrationReplacement=source.migration_replacement_of&&versionHistory.find(candidate=>
        candidate.article_id===source.migration_replacement_of&&normalizedUrl(candidate.source_url)===sourceUrl);
      const exactVersion=versionHistory.find(candidate=>normalizedUrl(candidate&&candidate.source_url)===sourceUrl&&
        articleContentHash(candidate)===sourceHash);
      if(migrationReplacement){
        // 要約の品質移行はニュースの訂正ではない。同じ公開URLと記事IDを保ったまま本文だけ置換する。
        source.article_id=migrationReplacement.article_id;
      }else if(exactVersion&&exactVersion.article_id){
        // Preserve the identity of a version already present in the story index.
        source.article_id=exactVersion.article_id;
      }else if(versionHistory.some(candidate=>normalizedUrl(candidate&&candidate.source_url)===sourceUrl)){
        // Publishers may correct the same URL multiple times, or reuse a rolling
        // URL for a different announcement. Give every distinct body a stable
        // revision ID while keeping the canonical URL unchanged.
        source.article_id=`${stableArticleId(source)}_rev_${sourceHash.slice(0,12)}`;
      }
    }
    const best=findBestStoryMatch(versionHistory,source,STORY_TIMELINE_WINDOW_MS);
    const previous=best&&best.candidate;
    const relation=previous?classifyStoryRelation(previous,source,best.match):
      {decision:"new",confidence:1,reasons:["no_previous_story"],changes:[]};
    // CI検証ゲート(確信度0.85)を満たさない続報・訂正は、公開全体を止めないよう
    // 続報リンクなしの通常記事へ降格する(記事自体は公開される)。
    if((relation.decision==="follow_up"||relation.decision==="correction")&&relation.confidence<0.85){
      relation.decision="uncertain";
      relation.reasons=[...relation.reasons,"low_confidence_follow_up_demoted"];
    }
    // 完全一致の再掲載は直近ウィンドウ内だけ抑制する。公開済み記事は再判定で消さない。
    if(relation.decision==="duplicate"){
      const alreadyPublished=Boolean(publishedIds&&source.article_id&&publishedIds.has(source.article_id));
      const gap=best&&Number.isFinite(best.gap)?best.gap:0;
      if(!alreadyPublished&&gap<=DUPLICATE_SUPPRESS_WINDOW_MS)continue;
      relation.decision="uncertain";
      relation.reasons=[...relation.reasons,alreadyPublished?"published_item_protected":"stale_duplicate_kept_as_uncertain"];
    }
    source.dedupe_decision=relation.decision;
    source.dedupe_reasons=relation.reasons;
    source.relation_confidence=relation.confidence;
    if(previous&&(relation.decision==="follow_up"||relation.decision==="correction")){
      const shared=[...new Set(storyEntitiesFor(previous).map(value=>value.toLowerCase()))]
        .find(value=>new Set(storyEntitiesFor(source).map(v=>v.toLowerCase())).has(value))||"topic";
      const profile=structuredStoryProfile(source);
      source.story_id=previous.story_id||("story_"+sha256(`${profile.type}|${profile.primary}|${profile.subject}|${shared}`).slice(0,18));
      const previousSequence=Number(previous.story_sequence);
      source.story_sequence=Math.max(2,(Number.isFinite(previousSequence)?Math.floor(previousSequence):1)+1);
      source.relation_type=relation.decision;
      source.previous_article_id=previous.article_id;
      source.previous_title=previous.title;
      source.previous_source_published_at=previous.source_published_at||previous.published_at||"";
      const currentFact=String(source.change_summary||source.raw_excerpt||"").trim();
      const relationLead=source.relation_type==="correction"?"この話題の訂正・状況変更です":"この話題の続報です";
      source.continuation_lead=`${relationLead}。前回は「${previous.title}」まで進んでいましたが、今回は${currentFact}`;
    }else{
      const profile=structuredStoryProfile(source);
      source.story_id="story_"+sha256(`${profile.type}|${profile.primary}|${profile.subject||source.article_id}`).slice(0,18);
      if(relation.decision==="uncertain")source.relation_confidence=relation.confidence;
    }
    delete source.migration_replacement_of;
    result.push(source);
  }
  return result.sort((a,b)=>articleTime(b)-articleTime(a));
}

function loadStoryIndex() {
  const parsed=readJsonFile(STORY_INDEX_PATH,{version:1,items:[]});
  const cutoff=Date.now()-365*86400000;
  parsed.version=1;
  parsed.items=(Array.isArray(parsed.items)?parsed.items:[]).filter(item=>{
    const time=articleTime(item);
    return Number.isFinite(time)&&time>=cutoff;
  });
  return parsed;
}

function updateStoryIndex(index,items) {
  const byId=new Map((index.items||[]).map(item=>[item.article_id,item]));
  for(const item of items)byId.set(item.article_id,{
    article_id:item.article_id,story_id:item.story_id,story_sequence:item.story_sequence,
    relation_type:item.relation_type,relation_confidence:item.relation_confidence,title:item.title,source_published_at:item.source_published_at,
    published_at:item.published_at||"",fetched_at:item.fetched_at||"",
    event_at:item.event_at,event_status:item.event_status,raw_excerpt:item.raw_excerpt,
    source_name:item.source_name,source_url:item.source_url,story_entities:item.story_entities,
    primary_entity:item.primary_entity,story_subject:item.story_subject,
    event_type:item.event_type,event_stage:item.event_stage,event_scope:item.event_scope,
    fact_slots:item.fact_slots,structured_complete:item.structured_complete===true,
    dedupe_decision:item.dedupe_decision,dedupe_reasons:item.dedupe_reasons,
    change_summary:item.change_summary,detail:item.detail,new_facts:item.new_facts,
    event_date_precision:item.event_date_precision
  });
  index.items=[...byId.values()].sort((a,b)=>articleTime(b)-articleTime(a));
  return index;
}

function findReusablePrevious(previous,item) {
  const itemTime=new Date(item.published_at||0).getTime();
  if(!Number.isFinite(itemTime))return null;
  return previous.find(old=>{
    const oldTime=new Date(old.published_at||0).getTime();
    if(!Number.isFinite(oldTime)||Math.abs(itemTime-oldTime)>72*3600000)return false;
    const oldUrl=normalizedUrl(old.source_url),newUrl=normalizedUrl(item.source_url);
    if(oldUrl&&newUrl&&oldUrl===newUrl)return articleContentHash(old)===articleContentHash(item);
    const structured=Boolean(old.primary_entity&&old.story_subject&&item.primary_entity&&item.story_subject);
    return structured&&classifyStoryRelation(old,item).decision==="duplicate";
  })||null;
}

function bootstrapCacheResult(cache,source,result) {
  const key=articleCacheKey(source);
  if(cache.items[key])return;
  cache.items[key]={
    canonical_url:normalizedUrl(source.source_url),
    content_hash:articleContentHash(source),
    story_key:sha256(normalizedStoryTitle(source.title)),
    status:"enriched",
    processed_at:result.fetched_at||result.published_at||new Date().toISOString(),
    model:"legacy",
    prompt_version:result.enrichment_version===PROMPT_VERSION?PROMPT_VERSION:"legacy-before-event-date-v5",
    lane:"bootstrap",
    reason:"existing_complete_article",
    result
  };
}

(async () => {
  // 更新区間の終点は処理完了時ではなく実行開始時に固定する。
  // 処理中に公開された記事は次回へ回り、更新区間の隙間を作らない。
  const editionWindowEnd=new Date().toISOString();
  const out = [];
  for (const t of TOOLS) {
    let items = [];
    const feeds=[...t.feeds];
    if(FEATURED_RESEARCH_SET.has(t.name)){
      const query=FEATURED_RESEARCH_QUERY[t.name]||t.name;
      feeds.push(`https://news.google.com/rss/search?q=${encodeURIComponent(`"${query}" (release OR update OR "new feature") when:14d`)}&hl=en-US&gl=US&ceid=US:en`);
    }
    for (const url of feeds) {
      try { items = items.concat(parseFeed(await fetchText(url), isOfficial(url), sourceLabelFromUrl(url))); }
      catch (e) { console.error("  fetch fail", url, String(e.message || e).slice(0, 60)); }
    }
    for(const url of OFFICIAL_UPDATE_PAGES[t.name]||[]){
      try{
        const officialItem=parseOfficialUpdatePage(await fetchText(url),url,t.name);
        if(officialItem)items.push(officialItem);
      }catch(e){ console.error("  official page fail",url,String(e.message||e).slice(0,60)); }
    }
    const before = items.length;
    let kept = items.filter(it => keep(it, t));              // ★ノイズ除外（厳選①）
    // 一致候補がない場合も第三者ニュースは復活させず、対象が明確な公式フィードだけを残す。
    if (kept.length === 0 && before > 0) kept = items.filter(it => it.official && !NOISE.test(it.title));
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
        published_at: it.date || "",
        source_published_at:it.date||"",
        source_updated_at:it.updatedAt||"",
        source_date_status:it.dateSource||"unknown",
        fetched_at:new Date().toISOString(),
        raw_excerpt: it.desc || "",
        source_name: it.sourceName || (it.official ? "公式情報" : "Google ニュース掲載記事"),
        is_official: !!it.official,
      });
    }
    console.error("OK", t.name, "kept", Math.min(items.length, PER_TOOL), "/ fetched", before);
  }
  out.sort((a, b) => articleTime(b)-articleTime(a));

  // URLだけでなくタイトルの類似度も見て、媒体をまたぐ同一話題を1件にまとめる。
  const uniqueOut = dedupeStories(out);

  // 一時的な通信障害で全フィード取得に失敗しても、既存ニュースを消さない。
  if (uniqueOut.length === 0) {
    console.error("NO ARTICLES FETCHED: keeping the existing data.json");
    process.exitCode = 1;
    return;
  }

  // 公開用の記事とAI処理履歴を分離する。公開上限から外れた記事や不採用記事も、
  // 保存期間内は再処理せず、同じ候補への重複課金を防ぐ。
  const previous=readPreviousCompleteItems();
  const storyIndex=loadStoryIndex();
  const filteredOut=filterStaleRawCandidates(uniqueOut,[...storyIndex.items,...previous]);
  const cache=loadAiCache();
  const ledger=loadUsageLedger();
  for(const item of previous)bootstrapCacheResult(cache,item,item);

  const reused=[];
  const fresh=[];
  let cacheHits=0;
  let rejectedHits=0;
  for(const item of filteredOut){
    const cached=cacheEntryFor(item,cache);
    if(cached&&cached.status==="enriched"&&isCompleteEnrichedItem(cached.result)){
      reused.push(cached.result);
      cacheHits++;
      continue;
    }
    if(cached&&cached.status==="rejected"){
      rejectedHits++;
      continue;
    }
    if(cached&&cached.status==="retry"){
      rejectedHits++;
      continue;
    }
    const match=findReusablePrevious(previous,item);
    if(match&&match.enrichment_version===PROMPT_VERSION){
      reused.push(match);
      bootstrapCacheResult(cache,item,match);
      cacheHits++;
    }else{
      fresh.push(item);
    }
  }
  fresh.sort((a,b)=>candidateScore(b)-candidateScore(a));

  const today=usageDay(ledger);
  const dailyBudget=Number(process.env.AI_DAILY_BUDGET_USD||0);
  const budgetExhausted=dailyBudget>0&&today.estimated_usd>=dailyBudget;
  const regularRemaining=budgetExhausted?0:Math.max(0,AI_DAILY_UNIQUE_LIMIT-today.regular_processed);
  // プロンプト更新だけでは既存記事が「処理済み」のまま残るため、毎日24件を上限に
  // 旧要約へ再度一次情報の文脈を付け、記事固有の深い3段落へ安全に移行する。
  const migrationFresh=previous.filter(needsDeepFriendlyMigration)
    .filter(item=>!cacheEntryFor(item,cache));
  const migrationCandidates=selectProtectedCandidates(migrationFresh,
    Math.min(AI_DEEP_BACKFILL_LIMIT,regularRemaining));
  const migrationKeys=new Set(migrationCandidates.map(articleCacheKey));
  const regularNewCandidates=selectProtectedCandidates(
    fresh.filter(item=>!migrationKeys.has(articleCacheKey(item))),
    Math.min(AI_NEW_LIMIT,Math.max(0,regularRemaining-migrationCandidates.length)));
  const regularCandidates=[...migrationCandidates,...regularNewCandidates];
  const regularKeys=new Set(regularCandidates.map(articleCacheKey));
  const emergencyRemaining=Math.max(0,AI_DAILY_EMERGENCY_LIMIT-today.emergency_processed);
  const emergencySlots=Math.min(Math.max(0,AI_NEW_LIMIT-regularCandidates.length),emergencyRemaining);
  const emergencyCandidates=(!budgetExhausted&&regularRemaining<AI_NEW_LIMIT)
    ?selectProtectedCandidates(fresh.filter(item=>criticalBucket(item)&&!regularKeys.has(articleCacheKey(item))),emergencySlots)
    :[];

  let migrationResult={items:[],processed:0,rejected:0};
  let regularResult={items:[],processed:0,rejected:0};
  let emergencyResult={items:[],processed:0,rejected:0};
  try {
    migrationResult=await enrichNewItems(migrationCandidates,cache,ledger,"regular",AI_MIGRATION_BATCH_SIZE);
    regularResult=await enrichNewItems(regularNewCandidates,cache,ledger,"regular",AI_BATCH_SIZE);
    emergencyResult=await enrichNewItems(emergencyCandidates,cache,ledger,"emergency");
  } catch (e) {
    console.error("AI要約に失敗:",String(e.message||e).slice(0,300));
  }
  const newlyEnriched=[...migrationResult.items,...regularResult.items,...emergencyResult.items];
  const selectedCount=regularCandidates.length+emergencyCandidates.length;
  if(dailyBudget>0&&usageDay(ledger).estimated_usd>=dailyBudget*0.8){
    console.error("AI DAILY BUDGET WARNING:",usageDay(ledger).estimated_usd,"/",dailyBudget,"USD");
  }

  writeJsonFile(AI_CACHE_PATH,cache);
  writeJsonFile(AI_USAGE_PATH,ledger);
  appendStepSummary(ledger,{cacheHits,rejectedHits,fresh:fresh.length,selected:selectedCount,
    migrationSelected:migrationCandidates.length});

  // 新着候補があるのに予算・API障害で1件も処理できなかった回は、更新成功にしない。
  // チェックポイントを進めず、次の回で同じ期間を再審査する。
  if(fresh.length>0&&selectedCount===0){
    console.error("NEW ARTICLES ARE WAITING: keeping the previous public edition until AI processing resumes");
    process.exitCode=1;
    return;
  }

  // 今回フィードに現れなかった記事も保存期間内なら残す。
  // 一時的なRSS欠落で、良質な要約済み記事が突然消えるのを防ぐ。
  const retentionStart=Date.now()-31*86400000;
  const recentPrevious=previous.filter(item=>{
    const time=articleTime(item);
    return Number.isFinite(time)&&time>=retentionStart;
  });
  const cachedEnriched=Object.values(cache.items)
    .filter(entry=>entry&&entry.status==="enriched"&&isCompleteEnrichedItem(entry.result))
    .map(entry=>bindLegacyMigrationIdentity(entry.result,previous));
  const importanceOrder={S:4,A:3,B:2,C:1};
  // 既存の正本を先に残す。新しい転載を先に残してから履歴照合すると、
  // 「既存原記事を消す → 転載も履歴重複で消す」という二重除外が起きる。
  const rankedPool=dedupeStories(preferCurrentEnrichment(
    [...recentPrevious,...cachedEnriched,...reused,...newlyEnriched]))
    .filter(isCompleteEnrichedItem);
  // 主要ツールは各1件を優先確保し、画面にあるのに進化情報が出ない状態を防ぐ。
  const featuredPicks=[];
  for(const toolName of FEATURED_RESEARCH_TOOL_NAMES){
    const item=rankedPool.filter(candidate=>candidate.tool===toolName)
      .sort((a,b)=>articleTime(b)-articleTime(a))[0];
    if(item)featuredPicks.push(item);
  }
  const featuredKeys=new Set(featuredPicks.map(item=>item.article_id||stableArticleId(item)));
  // 新着保証枠: 主要ツール枠を除いた残りから直近72時間の記事を最大12件確保する。
  const freshCutoff=Date.now()-72*3600000;
  const freshPicks=rankedPool.filter(item=>!featuredKeys.has(item.article_id||stableArticleId(item))&&articleTime(item)>=freshCutoff)
    .sort((a,b)=>articleTime(b)-articleTime(a)).slice(0,Math.min(12,Math.max(0,AI_MAX-featuredPicks.length)));
  const reservedKeys=new Set([...featuredKeys,...freshPicks.map(item=>item.article_id||stableArticleId(item))]);
  const restPicks=rankedPool.filter(item=>!reservedKeys.has(item.article_id||stableArticleId(item)))
    .sort((a,b)=>(importanceOrder[b.importance]||0)-(importanceOrder[a.importance]||0)||
      articleTime(b)-articleTime(a))
    .slice(0,Math.max(0,AI_MAX-featuredPicks.length-freshPicks.length));
  const capDropped=rankedPool.length-featuredPicks.length-freshPicks.length-restPicks.length;
  if(capDropped>0)console.error("PUBLISH CAP: 完成記事のうち"+capDropped+"件が60件枠から漏れました");
  const baseFinal=[...featuredPicks,...freshPicks,...restPicks].sort((a,b)=>articleTime(b)-articleTime(a));
  const publishedIds=new Set(previous.map(item=>item&&item.article_id).filter(Boolean));
  const connectedFinal=connectStoryTimeline(baseFinal,storyIndex.items,publishedIds);
  // During the v7 migration, a legacy summary and its newly structured version
  // can share the same stable article ID while having different content hashes.
  // Never publish both; prefer the current structured representation.
  const finalByArticleId=new Map();
  for(const item of connectedFinal){
    const key=item.article_id||stableArticleId(item);
    const existing=finalByArticleId.get(key);
    const itemIsCurrent=item.enrichment_version===PROMPT_VERSION;
    const existingIsCurrent=existing&&existing.enrichment_version===PROMPT_VERSION;
    if(!existing||(itemIsCurrent&&!existingIsCurrent))finalByArticleId.set(key,item);
  }
  const final=[...finalByArticleId.values()].sort((a,b)=>articleTime(b)-articleTime(a));

  if(selectedCount&&migrationResult.processed+regularResult.processed+emergencyResult.processed===0){
    console.error("NO NEW ENRICHED ARTICLES: keeping the existing complete data.json");
    process.exitCode = 1;
    return;
  }
  if(final.length<Math.min(8,previous.length||8)){
    console.error("TOO FEW COMPLETE ARTICLES ("+final.length+"): keeping the existing data.json");
    process.exitCode=1;
    return;
  }

  const publicationReadyFinal=final.map(upgradeFriendlyExplanationItem);
  const safelyExpanded=publicationReadyFinal.filter((item,index)=>item!==final[index]).length;
  const previousEdition=readJsonFile(HOME_EDITION_PATH,{});
  const homeEdition=buildHomeEdition(publicationReadyFinal,previousEdition,{windowEnd:editionWindowEnd});
  const editionReadyFinal=applyHomeEdition(publicationReadyFinal,homeEdition);
  writeJsonFile("data.json",editionReadyFinal);
  writeJsonFile(HOME_EDITION_PATH,homeEdition);
  writeJsonFile(STORY_INDEX_PATH,updateStoryIndex(storyIndex,editionReadyFinal));
  console.error("WROTE data.json with",editionReadyFinal.length,"complete items; home",homeEdition.selected_count,"of",homeEdition.candidate_count,"new candidates; candidates",uniqueOut.length,"after recent-story filter",filteredOut.length,"new",newlyEnriched.length,"reused",reused.length,"cache",cachedEnriched.length,"retained",recentPrevious.length,"safe-expanded",safelyExpanded);

})();
