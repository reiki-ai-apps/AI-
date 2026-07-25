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
];
const PER_TOOL = 6; // 1ツールあたり最新何件まで残すか

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
 * ②AI厳選（Claude API・任意）
 * GitHub Secret の ANTHROPIC_API_KEY があれば、Claudeが各記事を
 * 「一般の利用者に役立つか」判定→不要を除外→日本語に翻訳＋要約。
 * 鍵が無い/失敗した場合は静かにスキップし、ルール厳選の結果をそのまま使う。
 * ===================================================================== */
const AI_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8"; // 安く済ませたいなら "claude-haiku-4-5"
const AI_MAX = 12; // AIが選ぶ最大件数

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
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
}

function parseJsonArray(text) {
  if (!text) return null;
  const a = text.indexOf("["), b = text.lastIndexOf("]");
  if (a < 0 || b <= a) return null;
  try { const arr = JSON.parse(text.slice(a, b + 1)); return Array.isArray(arr) ? arr : null; }
  catch (e) { return null; }
}

async function aiCurate(items) {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY 未設定 → AI厳選スキップ（ルール厳選のまま）"); return null; }
  const list = items.map((it, i) => ({ i, tool: it.tool, title: it.title, excerpt: (it.raw_excerpt || "").toString().slice(0, 180) }));
  const system =
    "あなたは、AIに詳しくない人にも理解できる日本語で伝えるAIニュース編集者です。" +
    "製品アップデート、新機能、使い方、料金変更だけでなく、AI政策、規制、著作権、補助金・助成金、AI関連企業・株式、研究、セキュリティ、半導体など、利用者の仕事や生活に影響する情報を重視してください。" +
    "広告、別テーマの誤ヒット、根拠の薄い記事、同じ内容の重複記事は除外してください。専門用語をそのまま使わず、必要な場合は短い説明を添えてください。";
  const user =
    "次のAI関連ニュース候補(JSON)から、一般の利用者が知っておく価値のあるものだけを重要な順に最大" + AI_MAX + "件選んでください。\n" +
    "出力は次の形式のJSON配列だけ（前置き・説明・コードフェンスは一切不要）:\n" +
    '[{"i":元番号, "title_ja":"日本語の短いタイトル", "summary_ja":"30〜70字の日本語の一言要約", "detail_ja":"180〜300字、5〜7文のやさしい日本語で説明。①何のニュースか ②以前と何が違うか ③専門用語の意味 ④利用者にどんな影響があるか ⑤まず何を確認・試せばよいか、の順に書く。中学生が初めて読んでも分かる言葉を使い、1文を短くする", "importance":"S|A|B"}]\n' +
    "英語は必ず自然な日本語に翻訳。detail_jaは題名とexcerptを根拠に書く。元記事に無い具体的な数字・日付・固有名詞・効果は創作しない。分からない点は断定しない。役立たないものは選ばない。\n候補:\n" +
    JSON.stringify(list);

  let text;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { text = await callClaude(system, user); break; }
    catch (e) { console.error("AI厳選 試行" + (attempt + 1) + " 失敗:", String(e.message || e).slice(0, 200)); }
  }
  const arr = parseJsonArray(text);
  if (!arr || !arr.length) return null;

  const out = [];
  for (const e of arr) {
    const idx = Number(e && e.i);
    if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) continue;
    const src = items[idx];
    const titleJa = (e.title_ja || "").toString().trim() || src.title;
    const sumJa = (e.summary_ja || "").toString().trim();
    const detailJa = (e.detail_ja || "").toString().trim();
    out.push({ tool: src.tool, title: titleJa, source_url: src.source_url, published_at: src.published_at, raw_excerpt: sumJa || src.raw_excerpt, detail: detailJa });
  }
  console.error("AI厳選: " + out.length + "件に厳選・翻訳（model=" + AI_MODEL + "）");
  return out.length ? out : null;
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

function parseFeed(xml, official) {
  let blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi);
  if (!blocks) blocks = xml.match(/<entry\b[\s\S]*?<\/entry>/gi);
  if (!blocks) return [];
  const out = [];
  for (const b of blocks) {
    const title = stripTags(tag(b, "title"));
    if (!title) continue;
    const link = tag(b, "link") || atomLink(b);
    const dateRaw = tag(b, "pubDate") || tag(b, "published") || tag(b, "updated");
    const desc = stripTags(tag(b, "description") || tag(b, "summary") || tag(b, "content")).slice(0, 500);
    out.push({ title, link, date: toIso(dateRaw), desc, official });
  }
  return out;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (AI-Radar bot)" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return await res.text();
}

(async () => {
  const out = [];
  for (const t of TOOLS) {
    let items = [];
    for (const url of t.feeds) {
      try { items = items.concat(parseFeed(await fetchText(url), isOfficial(url))); }
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
        source_name: it.official ? "公式情報" : "Google ニュース掲載記事",
        is_official: !!it.official,
      });
    }
    console.error("OK", t.name, "kept", Math.min(items.length, PER_TOOL), "/ fetched", before);
  }
  out.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));

  // ②AI厳選（任意・失敗時はルール厳選のまま）
  let final = out;
  try {
    const curated = await aiCurate(out);
    if (curated && curated.length) {
      curated.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
      final = curated;
    }
  } catch (e) {
    console.error("AI厳選で例外（ルール厳選のまま）:", String(e.message || e).slice(0, 200));
  }

  fs.writeFileSync("data.json", JSON.stringify(final, null, 2));
  console.error("WROTE data.json with", final.length, "items");
})();
  // GitHub Pagesへ配置する直前に、同意欄をログイン・無料登録ボタンより上へ整える。
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

const layoutLines = fs.readFileSync("index.html", "utf8").split(/(?<=\n)/);
let layoutChanged = false;
for (let i = 0; i < layoutLines.length - 1; i++) {
  if (layoutLines[i].includes('class="auth-actions"') && layoutLines[i].includes("signInMember()") && layoutLines[i + 1].includes('id="authConsent"')) {
    [layoutLines[i], layoutLines[i + 1]] = [layoutLines[i + 1], layoutLines[i]];
    layoutChanged = true;
    i++;
  }
}
if (layoutChanged) fs.writeFileSync("index.html", layoutLines.join(""));
