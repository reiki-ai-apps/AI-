// トップページ: 朝の光のヒーロー(リアルタイム3D + 時刻スライダー + スクロールで軒下・内部へ)
import { CONFIG } from "./config.js";
import { initSite, esc } from "./site.js";
import { ICONS } from "./icons.js";
import { SHELVES, PRODUCTS } from "./catalog-data.js";
import { SEKKI, currentSekki } from "./sekki.js";
import { landscapeSvg } from "./scene.js";
import { estimate, normalizeParams } from "./pricing.js";

initSite();
document.documentElement.classList.add("js");
const $ = s => document.querySelector(s);
document.querySelectorAll("[data-icon]").forEach(el => { el.innerHTML = ICONS[el.dataset.icon] || ""; });
if (CONFIG.tel) { const t = $("#tel-cta"); t.href = `tel:${CONFIG.tel}`; }

// ---- 棚・節気 ----
$("#shelf-rail").innerHTML = SHELVES.map(s => `<a class="s" href="catalog.html#shelf=${s.id}" style="--shelf:${s.color}"><span class="ic">${ICONS[s.icon]}</span><h3>${esc(s.label)}</h3><p>${esc(s.sub)}</p><span class="n">${PRODUCTS.filter(p => s.cats.includes(p.cat)).length}点を見る →</span></a>`).join("");
const now = currentSekki();
const idx = SEKKI.findIndex(t => t.name === now.name);
$("#works").innerHTML = [0, 1, 2].map(i => { const t = SEKKI[(idx + i) % SEKKI.length]; return `<a class="work${i === 0 ? " now" : ""}" href="catalog.html"><div class="term">${esc(t.name)}</div><div class="date">${t.month}月${t.day}日ごろ${i === 0 ? " ・ いま" : ""}</div><p>${esc(t.task)}</p></a>`; }).join("");

// ---- 出現 ----
const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { e.target.classList.add("in"); e.target.classList.remove("pre"); io.unobserve(e.target); } }, { rootMargin: "0px 0px 40% 0px" });
document.querySelectorAll(".reveal, .phone").forEach(el => io.observe(el));
setTimeout(() => document.querySelectorAll(".reveal:not(.in), .phone.pre").forEach(el => { el.classList.add("in"); el.classList.remove("pre"); }), 1500); // 保険: 何があっても表示する
// 数字のカウントアップ
const cio = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { count(e.target); cio.unobserve(e.target); } }, { threshold: 0.4 });
document.querySelectorAll("[data-count]").forEach(el => cio.observe(el));
function count(el) {
  const to = Number(el.dataset.count), small = el.querySelector("small"), t0 = performance.now(), dur = matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 900;
  const step = now => { const k = Math.min(1, (now - t0) / dur), v = Math.round(to * (1 - Math.pow(1 - k, 3))); el.firstChild.textContent = v.toLocaleString("ja-JP"); if (k < 1) requestAnimationFrame(step); };
  el.firstChild.textContent = "0"; if (small) el.append(small); requestAnimationFrame(step);
}

// ---- ヒーロー ----
const hero = $("#hero"), land = $("#hero-land");
const lowPower = matchMedia("(prefers-reduced-motion: reduce)").matches || (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4);
land.innerHTML = landscapeSvg({ mode: "dawn", clouds: false, houses: 0 });
land.querySelector("svg").querySelectorAll("rect, circle").forEach(el => el.remove()); // 空と太陽はCSSで描くので風景だけ残す

let viewer = null, poses = null, target = 0, current = 0;
async function setupHero() {
  if (lowPower) { hero.classList.add("static"); $("#timebar").hidden = true; return; }
  const { createViewer } = await import("./house3d.js");
  viewer = createViewer($("#hero3d"), { showcase: true, transparent: true, fog: 0, fov: 32, exposure: 0.95, maxPixelRatio: 1.5, interactive: false, cameraMs: 900, zoomFactor: innerWidth > 760 ? 1.22 : 0.82 });
  if (!viewer.ok) { hero.classList.add("static"); $("#timebar").hidden = true; return; }
  const est = estimate(normalizeParams({ span: 6, length: 24, eave: 1.7, ridge: 3.2, pitch: 0.5, pipe: 25.4, film: "po015", doors: 2, sideVent: "both", ventDrive: "manual", insectNet: true, irrigation: "drip", curtain: "none" }));
  viewer.update(est, { refit: false });
  computePoses();
  applyTime(Number($("#time").value));
  addEventListener("resize", debounce(computePoses, 200));
  addEventListener("scroll", () => { target = Math.min(1, Math.max(0, window.scrollY / (hero.offsetHeight * 0.9))); }, { passive: true });
  requestAnimationFrame(tick);
}
function computePoses() {
  if (!viewer) return;
  const ext = viewer.getPose("exterior"), eave = viewer.getPose("eave"), inn = viewer.getPose("interior");
  if (!ext) return;
  // ヒーローでは家を画面の右上寄りに置く(文字は左下)。カメラ座標系の右方向・上方向にずらす
  const dir = ext.target.clone().sub(ext.pos), dist = dir.length(); dir.normalize();
  const up = ext.pos.clone().set(0, 1, 0), right = dir.clone().cross(up).normalize(), camUp = right.clone().cross(dir).normalize();
  const kx = innerWidth > 760 ? -0.26 : 0, ky = innerWidth > 760 ? -0.06 : -0.1; // 負=カメラを左/下へ → 家は右/上へ
  const off = right.multiplyScalar(kx * dist * 0.6).add(camUp.multiplyScalar(ky * dist * 0.6));
  ext.pos.add(off); ext.target.add(off);
  poses = [ext, eave, inn];
  viewer.setPose(lerpPose(0).pos, lerpPose(0).target);
}
const lerpV = (a, b, t) => a.clone().lerp(b, t);
function lerpPose(t) {
  const [a, b, c] = poses; const s = t < 0.55 ? t / 0.55 : (t - 0.55) / 0.45; const ease = k => k * k * (3 - 2 * k);
  const [p, q] = t < 0.55 ? [a, b] : [b, c];
  return { pos: lerpV(p.pos, q.pos, ease(s)), target: lerpV(p.target, q.target, ease(s)) };
}
function tick() {
  if (poses && Math.abs(target - current) > 0.0005) { current += (target - current) * 0.08; const p = lerpPose(current); viewer.setPose(p.pos, p.target); $(".hero .copy").style.opacity = String(Math.max(0, 1 - current * 1.6)); }
  requestAnimationFrame(tick);
}
function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

// ---- 時刻スライダー: 空・太陽・影 ----
const SKY = [ // [時, 5色]
  [5, ["#0B1F16", "#12233A", "#4A3450", "#B4552E", "#E8933F"]],
  [7, ["#1C3B5A", "#4E7FA8", "#A9C7DE", "#EBD3B4", "#F3D9B8"]],
  [12, ["#2E6FB0", "#7FB6E0", "#C7E1F2", "#EAF3F9", "#F7F3EA"]],
  [16.5, ["#2A4E7A", "#6F8FB5", "#D9B8A0", "#E8A06A", "#F2C48C"]],
  [18, ["#101B2E", "#3A2C4E", "#8E3E3A", "#D97A3E", "#E8B47A"]]
];
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => { const A = hex2rgb(a), B = hex2rgb(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",")})`; };
function skyAt(h) {
  let i = 0; while (i < SKY.length - 2 && h > SKY[i + 1][0]) i++;
  const [h0, c0] = SKY[i], [h1, c1] = SKY[i + 1], t = Math.min(1, Math.max(0, (h - h0) / (h1 - h0)));
  return c0.map((c, k) => mix(c, c1[k], t));
}
function applyTime(h) {
  const sky = skyAt(h); sky.forEach((c, i) => hero.style.setProperty(`--sky${i + 1}`, c));
  const f = (h - 5) / 13; // 0..1
  const elevation = Math.max(0.12, Math.sin(Math.PI * f) * 1.1), azimuth = Math.PI * (1 - f) - 0.4;
  const warm = 1 - Math.sin(Math.PI * f); // 朝夕ほど暖色
  const color = mix("#FFF6E8", "#FFC38A", warm), intensity = 1.5 + Math.sin(Math.PI * f) * 0.9;
  if (viewer) viewer.setLight({ color: parseInt(color.match(/\d+/g).map(v => (+v).toString(16).padStart(2, "0")).join(""), 16), intensity, azimuth, elevation });
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  $("#time-label").textContent = `${h < 10 ? "朝" : h < 15 ? "昼" : "夕"} ${hh}:${String(mm).padStart(2, "0")}`;
  const lm = land.querySelector("svg"); if (lm) lm.style.filter = `brightness(${0.55 + Math.sin(Math.PI * f) * 0.7})`;
}
$("#time").addEventListener("input", e => applyTime(Number(e.target.value)));
applyTime(6);
setupHero();
