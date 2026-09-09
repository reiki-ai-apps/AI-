// 見積依頼フォーム: シミュレーター内容とカタログ見積リストをまとめて送信
// 送信先の設定(正式運用時にここを変更):
//   endpoint: フォーム受付API(Supabase Edge Function / Formspree など)のURL。空ならメール送信にフォールバック。
//   mailTo:   見積依頼を受け取るメールアドレス。
export const CONFIG = { endpoint: "", mailTo: "info@example.com" };

import { initSite, toast, copyText, getQuoteList, quoteListText, esc } from "./site.js";
import { decodeParams, estimate, summarize, encodeParams } from "./pricing.js";

export function buildMail(subject, body) {
  return `mailto:${CONFIG.mailTo}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

if (document.getElementById("quote-form")) {
  initSite();
  const params = decodeParams(location.search);
  const est = params ? estimate(params) : null;
  const simBox = document.getElementById("sim-summary"), listBox = document.getElementById("list-summary"), emptyBox = document.getElementById("empty-summary");
  if (est) {
    simBox.hidden = false;
    simBox.querySelector("pre").textContent = summarize(est);
    simBox.querySelector("a").href = "simulator.html?" + encodeParams(est.params);
  }
  const list = getQuoteList();
  if (list.length) {
    listBox.hidden = false;
    listBox.querySelector("pre").textContent = quoteListText(list);
  }
  emptyBox.hidden = !!(est || list.length);

  const form = document.getElementById("quote-form"), result = document.getElementById("q-result");
  const FIELDS = [["お名前", "name"], ["農園名・法人名", "farm"], ["電話番号", "tel"], ["メールアドレス", "email"], ["設置予定地", "place"], ["ご希望時期", "timing"], ["栽培作物", "crop"], ["ご希望の連絡方法", "contact"], ["ご相談内容", "message"]];
  const buildText = () => {
    const d = new FormData(form);
    const parts = ["【見積依頼】", ...FIELDS.map(([k, n]) => `${k}: ${d.get(n) || ""}`), ""];
    if (est) parts.push(summarize(est), `シミュレーターURL: ${location.origin}${location.pathname.replace(/quote\.html$/, "simulator.html")}?${encodeParams(est.params)}`, "");
    if (list.length) parts.push(quoteListText(list), "");
    parts.push(`送信日時: ${new Date().toLocaleString("ja-JP")}`);
    return parts.join("\n");
  };
  const showText = (text, lead) => {
    result.hidden = false;
    result.innerHTML = `${lead}<pre style="white-space:pre-wrap;margin:.6rem 0 0;font-size:.85rem">${esc(text)}</pre>`;
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const text = buildText();
    if (CONFIG.endpoint) {
      try {
        const d = Object.fromEntries(new FormData(form).entries());
        const r = await fetch(CONFIG.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...d, simulator: est ? est.params : null, estimate: est ? { subtotal: est.subtotal, total: est.total } : null, items: list, text }) });
        if (!r.ok) throw new Error(String(r.status));
        showText(text, "<strong>送信しました。</strong>担当者から折り返しご連絡します。送信内容は以下のとおりです。");
        return;
      } catch (err) {
        toast("送信に失敗したため、メール送信に切り替えます");
      }
    }
    location.href = buildMail(`見積依頼: ${new FormData(form).get("name") || ""} 様`, text);
    showText(text, "<strong>メールソフトが開きます。</strong>開かない場合は「内容をコピー」して、電話・FAX・メールでお送りください。");
  });
  document.getElementById("q-copy").addEventListener("click", async () => toast((await copyText(buildText())) ? "内容をコピーしました" : "コピーできませんでした"));
}
