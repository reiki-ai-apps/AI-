// 地理院タイルの簡易マップ。複数のピンを入れて、収まる縮尺を自動で選ぶ。
const R = 256;
const toXY = (lat, lng, z) => { const n = 2 ** z, x = (lng + 180) / 360 * n, r = lat * Math.PI / 180; return { x, y: (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n }; };

export function renderMap(el, points, opts = {}) {
  const pts = points.filter(p => isFinite(p.lat) && isFinite(p.lng));
  if (!pts.length) { el.innerHTML = `<div class="map-empty">圃場の位置が登録されていません。カルテ登録のときに「現在地をピンにする」を押すと入ります。</div>`; return; }
  const w = el.clientWidth || 600, h = el.clientHeight || 360, pad = opts.pad ?? 48;
  const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng);
  const bounds = { n: Math.max(...lats), s: Math.min(...lats), e: Math.max(...lngs), w: Math.min(...lngs) };
  const center = { lat: (bounds.n + bounds.s) / 2, lng: (bounds.e + bounds.w) / 2 };
  let z = opts.zoom ?? 16;
  if (opts.zoom == null) {
    for (z = 16; z > 8; z--) {
      const a = toXY(bounds.n, bounds.w, z), b = toXY(bounds.s, bounds.e, z);
      if (Math.abs(b.x - a.x) * R < w - pad * 2 && Math.abs(b.y - a.y) * R < h - pad * 2) break;
    }
  }
  const c = toXY(center.lat, center.lng, z);
  const cols = Math.ceil(w / R) + 2, rows = Math.ceil(h / R) + 2;
  const x0 = Math.floor(c.x) - Math.floor(cols / 2), y0 = Math.floor(c.y) - Math.floor(rows / 2);
  const offX = w / 2 - (c.x - x0) * R, offY = h / 2 - (c.y - y0) * R;
  const tiles = document.createElement("div");
  tiles.className = "map-tiles";
  tiles.style.cssText = `left:${offX}px;top:${offY}px;width:${cols * R}px;height:${rows * R}px;grid-template-columns:repeat(${cols}, ${R}px)`;
  for (let dy = 0; dy < rows; dy++) for (let dx = 0; dx < cols; dx++) {
    const img = document.createElement("img"); img.alt = ""; img.loading = "lazy"; img.width = R; img.height = R;
    img.src = `https://cyberjapandata.gsi.go.jp/xyz/pale/${z}/${x0 + dx}/${y0 + dy}.png`;
    img.onerror = () => { img.style.visibility = "hidden"; };
    tiles.appendChild(img);
  }
  el.innerHTML = ""; el.appendChild(tiles);
  for (const p of pts) {
    const q = toXY(p.lat, p.lng, z);
    const pin = document.createElement("button");
    pin.type = "button"; pin.className = "map-pin"; pin.title = p.label || "";
    pin.style.cssText = `left:${w / 2 + (q.x - c.x) * R}px;top:${h / 2 + (q.y - c.y) * R}px;--pin:${p.color || "#E8622A"}`;
    pin.innerHTML = `<span class="cnt">${p.count ?? ""}</span>`;
    if (p.onClick) pin.addEventListener("click", p.onClick);
    if (p.label) { const lb = document.createElement("span"); lb.className = "map-label"; lb.textContent = p.label; pin.appendChild(lb); }
    el.appendChild(pin);
  }
  const attr = document.createElement("div"); attr.className = "map-attr"; attr.textContent = "地理院タイル"; el.appendChild(attr);
}
