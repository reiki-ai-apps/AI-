// 商品の写真。assets/products/<ID>.jpg(部材の実寸から起こしたスタジオ撮影風レンダリング)。
// 画像が無い品番のときだけ、形のアイコン + 規格文字の図に自動で戻す。
import { ICONS } from "./icons.js";
import { shelfOf } from "./catalog-data.js";

export function shapeOf(p) {
  const n = p.name, c = p.cat;
  if (c === "pipe") return /アーチ/.test(n) ? "arch" : "pipe";
  if (c === "joint") { if (/クロス|パイプバンド/.test(n)) return "cross"; if (/Tバンド/.test(n)) return "tee"; if (/内ジョイント/.test(n)) return "sleeve"; if (/スエジジョイント/.test(n)) return "angle"; if (/自在/.test(n)) return "angle"; if (/天井/.test(n)) return "joint"; return "joint"; }
  if (c === "reinforce") return /杭/.test(n) ? "anchor" : /筋交/.test(n) ? "brace" : "reinforce";
  if (c === "fastener") return /パッカー|ナイスキャッチ/.test(n) ? "packer" : /ビニペット|レール/.test(n) ? "rail" : /スプリング|ビニーバー/.test(n) ? "rail" : "fastener";
  if (c === "film") return "film";
  if (c === "door") return "door";
  if (c === "vent") return /循環扇|扇/.test(n) ? "fan" : /天窓/.test(n) ? "roof" : /制御盤/.test(n) ? "control" : /妻/.test(n) ? "door" : "crank";
  if (c === "curtain") return /装置/.test(n) ? "control" : "curtain";
  if (c === "control") return /暖房/.test(n) ? "heater" : /LED/.test(n) ? "led" : /CO/.test(n) ? "co2" : "control";
  if (c === "irrigation") return /タイマー/.test(n) ? "timer" : /フィルター/.test(n) ? "filter" : /ミスト|ノズル/.test(n) ? "irrigation" : /制御/.test(n) ? "control" : "water";
  if (c === "gutter") return "gutter";
  if (c === "mulch") return /ネット/.test(n) ? "net" : "sheet";
  if (c === "animal") return /ネット/.test(n) ? "net" : "fence";
  return "cube";
}

// 規格文字列から、図に大きく書く要点を最大2つ取り出す
export function keySpec(p) {
  const s = p.spec || "";
  const out = [];
  const dia = (p.name + " " + s).match(/φ(\d+(?:\.\d+)?)/); if (dia) out.push(`φ${dia[1]}`);
  const thick = s.match(/(\d+(?:\.\d+)?)mm/); if (thick && !dia) out.push(`${thick[1]}mm`);
  const width = s.match(/幅(\d+)cm/); if (width) out.push(`幅${width[1]}cm`);
  const upto = s.match(/(\d+)mまで/); if (upto) out.push(`${upto[1]}mまで`);
  const len = s.match(/(?:^|[^\d.])(\d+(?:\.\d+)?)m(?![m0-9])/); if (len && !upto) out.push(`${len[1]}m`);
  const cnt = s.match(/(\d+)(個|本|台|枚)入/); if (cnt) out.push(`${cnt[1]}${cnt[2]}入`);
  const size = s.match(/W(\d+(?:\.\d+)?)m\s*×\s*H(\d+(?:\.\d+)?)m/); if (size) { for (let i = out.length - 1; i >= 0; i--) if (/^\d+(\.\d+)?m$/.test(out[i])) out.splice(i, 1); out.push(`W${size[1]}×H${size[2]}m`); }
  const cm = p.name.match(/(\d+)cm/); if (cm && !out.length) out.push(`${cm[1]}cm`);
  const span = s.match(/間口(\d+(?:\.\d+)?)m/); if (span) out.unshift(`間口${span[1]}m`);
  const dedup = [...new Set(out)];
  if (!dedup.length) { const first = s.split(/[ 　/／]/)[0]; return first.length <= 10 ? first : ""; }
  return dedup.slice(0, 2).join(" / ");
}

function hexToRgba(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }

// 写真のパス
export function photoSrc(p) { return `assets/products/${encodeURIComponent(p.id)}.jpg`; }

// カード用の図(HTML断片)。big=true で詳細シート用
export function figure(p, big = false) {
  const shelf = shelfOf(p.cat);
  const key = keySpec(p);
  const shape = shapeOf(p);
  return `<div class="fig photo${big ? " big" : ""}" style="--shelf:${shelf.color};--shelf-bg:${hexToRgba(shelf.color, 0.12)};--ic-fill:${hexToRgba(shelf.color, 0.22)}">
    <img class="fig-img" src="${photoSrc(p)}" alt="${escAttr(p.name)}${key ? " " + escAttr(key) : ""} の写真" loading="lazy" decoding="async" width="1200" height="900">
    <span class="fig-ic" aria-hidden="true">${ICONS[shape] || ICONS.cube}</span>
    ${key ? `<span class="fig-key">${escHtml(key)}</span>` : ""}
    <span class="fig-shelf">${escHtml(shelf.label)}</span>
  </div>`;
}

// 写真が読めなかったカードだけ、図の表示に戻す
let wired = false;
export function watchPhotos() {
  if (wired || typeof document === "undefined") return; wired = true;
  document.addEventListener("error", e => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains("fig-img")) return;
    const fig = img.closest(".fig, .bigfig");
    if (fig) fig.classList.remove("photo");
    img.remove();
  }, true);
}

const escHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const escAttr = escHtml;
