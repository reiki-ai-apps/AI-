// 見積依頼フォーム: シミュレーター内容とカタログ見積リストをまとめて送信
// 送信先は config.js の mailTo / quoteEndpoint で設定します。
import { CONFIG as SITE } from "./config.js";
import { initSite, toast, copyText, getQuoteList, quoteListText, esc } from "./site.js";
import { OPTIONS, decodeParams, estimate, summarize, encodeParams, estimateRecover, yen, PRICING_VERSION } from "./pricing.js";
import { store, logEc, normTel } from "./store.js";
const CONFIG = { endpoint: SITE.quoteEndpoint, mailTo: SITE.mailTo };

export function buildMail(subject, body) {
  return `mailto:${CONFIG.mailTo}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

if (document.getElementById("quote-form")) (async () => {
  initSite();
  const sp = new URLSearchParams(location.search);
  const params = decodeParams(location.search);
  const est = params ? estimate(params) : null;
  const simBox = document.getElementById("sim-summary"), listBox = document.getElementById("list-summary"), emptyBox = document.getElementById("empty-summary");
  // ハウスカルテからの依頼: 対象ハウスと張り替え概算を添える
  let houseText = "";
  if (sp.get("house")) {
    try {
      const houses = await store.listAllHouses();
      const h = houses.find(x => x.id === sp.get("house"));
      if (h) {
        const c = await store.getCustomer(h.customerId);
        const filmLabel = (OPTIONS.films.find(f => f.id === h.params.film) || {}).label || h.params.film;
        const lines = ["【対象ハウス(ハウスカルテ)】", `${c ? c.farmName || c.name : ""} ${h.name}  間口${h.params.span}m × 奥行${h.params.length}m / 被覆材 ${filmLabel} / 張った年 ${h.filmYear || "不明"} / 作物 ${h.crop || "-"}`];
        if (sp.get("mode") === "recover") { const r = estimateRecover(h.params); lines.push(`張り替え概算(税抜): ${yen(r.subtotal)}  税込: ${yen(r.total)}`); }
        houseText = lines.join("\n");
        simBox.hidden = false; simBox.querySelector("h3").textContent = "対象のハウス";
        simBox.querySelector("pre").textContent = houseText; simBox.querySelector("a").href = `karte.html?c=${encodeURIComponent(c ? c.code : "")}`; simBox.querySelector("a").textContent = "カルテに戻る";
        const f = document.getElementById("quote-form"); if (c) { f.name.value = c.name || ""; f.farm.value = c.farmName || ""; f.tel.value = c.tel || ""; f.place.value = c.address || c.area || ""; f.crop.value = h.crop || ""; }
        if (sp.get("mode") === "recover") f.message.value = `${h.name} の被覆材張り替えを検討しています。`;
      }
    } catch (e) { console.warn(e); }
  }
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
  emptyBox.hidden = !!(est || list.length || houseText);

  const form = document.getElementById("quote-form"), result = document.getElementById("q-result");
  const FIELDS = [["お名前", "name"], ["農園名・法人名", "farm"], ["電話番号", "tel"], ["メールアドレス", "email"], ["設置予定地", "place"], ["ご希望時期", "timing"], ["栽培作物", "crop"], ["ご希望の連絡方法", "contact"], ["ご相談内容", "message"]];
  const buildText = () => {
    const d = new FormData(form);
    const parts = ["【見積依頼】", ...FIELDS.map(([k, n]) => `${k}: ${d.get(n) || ""}`), ""];
    if (houseText) parts.push(houseText, "");
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
    // まずDBに残す(メールが届かなくても、依頼は消えない)
    let savedQuote = null;
    try {
      const d = Object.fromEntries(new FormData(form).entries());
      const tel = String(d.tel || "");
      let customerId = null;
      const hit = (await store.findByTel(tel))[0];
      if (hit) customerId = hit.id;
      else if (tel) customerId = (await store.saveCustomer({ name: d.name || "お名前未記入", farmName: d.farm || "", tel, address: d.place || "", crop: d.crop || "", status: "prospect" })).id;
      savedQuote = await store.saveQuote({
        customerId, houseId: sp.get("house") || null,
        source: sp.get("house") ? "karte" : est ? "simulator" : list.length ? "catalog" : "form",
        status: "requested", simParams: est ? est.params : null, pricingVersion: est ? PRICING_VERSION : null,
        subtotal: est ? est.subtotal : list.reduce((s, x) => s + (x.price || 0) * x.qty, 0),
        total: est ? est.total : null,
        name: d.name || "", tel, email: d.email || "", place: d.place || "",
        message: (d.message || "").trim() || (houseText ? "カルテのハウスについて" : est ? `3Dで作成 間口${est.params.span}m×奥行${est.params.length}m` : list.length ? `かごの資材 ${list.length}点` : "お問い合わせ")
      });
      if (customerId) await store.saveInteraction({ customerId, channel: "ec", topic: "見積", body: `ECから見積依頼(${savedQuote.quoteNo || ""})\n${d.message || ""}`.trim(), nextActionOn: null });
      await logEc("quote_request", { customerId, ref: savedQuote.quoteNo || "" });
    } catch (err) { console.warn("見積の保存に失敗", err); }
    if (CONFIG.endpoint) {
      try {
        const d = Object.fromEntries(new FormData(form).entries());
        const r = await fetch(CONFIG.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...d, simulator: est ? est.params : null, estimate: est ? { subtotal: est.subtotal, total: est.total } : null, items: list, text }) });
        if (!r.ok) throw new Error(String(r.status));
        showText(text, `<strong>受け付けました。</strong>担当の者から翌営業日までにご連絡します。${savedQuote ? `受付番号 ${esc(savedQuote.quoteNo)}。` : ""}送信内容は以下のとおりです。`);
        return;
      } catch (err) {
        toast("送信に失敗したため、メール送信に切り替えます");
      }
    }
    location.href = buildMail(`見積依頼: ${new FormData(form).get("name") || ""} 様`, text);
    showText(text, `<strong>受け付けました。</strong>${savedQuote ? `受付番号 ${esc(savedQuote.quoteNo)}。` : ""}メールソフトも開きます。開かない場合は「内容をコピー」して、電話・FAX・メールでもお送りいただけます。`);
  });
  document.getElementById("q-copy").addEventListener("click", async () => toast((await copyText(buildText())) ? "内容をコピーしました" : "コピーできませんでした"));
})();
