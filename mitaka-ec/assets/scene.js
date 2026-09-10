// 桐生の朝の風景(SVG)。赤城山の稜線・田畑・ハウスの列・雲。ヒーローや区切りの背景に使う。
// mode: "dawn"(朝焼け) | "day"(昼) | "dusk"(夕)
const PALETTES = {
  dawn: { sky: ["#1b2a44", "#6b4a6e", "#e58a5a", "#f6c88f"], mountain: ["#2f4a3f", "#4a6a55"], field: ["#5d7f4a", "#7ba05c", "#9db86f"], house: "#dfe9e4", sun: "#ffd9a0", soil: "#6b5137" },
  day: { sky: ["#8fc4e8", "#bfe0f3", "#e8f4fb", "#f7fbfd"], mountain: ["#4d6e5b", "#6f8f78"], field: ["#6f9a55", "#8fb46a", "#b1c98a"], house: "#f2f7f5", sun: "#fff3cf", soil: "#7a5c3f" },
  dusk: { sky: ["#2a2740", "#7a3f5a", "#d9663f", "#f2b27a"], mountain: ["#30403a", "#4b5f52"], field: ["#4e6a42", "#6a8a52", "#8aa466"], house: "#e9dcd4", sun: "#ffc27a", soil: "#5e4632" }
};
export function landscapeSvg({ mode = "dawn", width = 1600, height = 700, houses = 7, clouds = true, id = "ls" } = {}) {
  const P = PALETTES[mode] || PALETTES.dawn;
  const W = width, H = height;
  // 赤城山っぽい、なだらかで裾の長い稜線
  const ridge = (y0, amp, seed) => { let d = `M0 ${H}`; for (let x = 0; x <= W; x += W / 24) { const t = x / W; const y = y0 - amp * (Math.sin(t * 3.1 + seed) * 0.5 + Math.sin(t * 7.3 + seed * 2) * 0.25 + Math.exp(-Math.pow((t - 0.62) * 4.2, 2)) * 1.6); d += ` L${x.toFixed(0)} ${y.toFixed(0)}`; } return d + ` L${W} ${H} Z`; };
  const rows = [0.62, 0.7, 0.8].map((f, i) => `<path d="M0 ${H * f} Q ${W * 0.5} ${H * (f - 0.03)} ${W} ${H * f} L${W} ${H} L0 ${H} Z" fill="${P.field[i]}"/>`).join("");
  const houseRow = Array.from({ length: houses }, (_, i) => {
    const x = W * 0.08 + i * (W * 0.84 / houses), w = W * 0.84 / houses * 0.78, y = H * 0.74, h = w * 0.28;
    return `<g opacity="0.95"><path d="M${x} ${y} v${-h * 0.45} a${w / 2} ${h * 0.75} 0 0 1 ${w} 0 v${h * 0.45} z" fill="${P.house}" stroke="#9fb3a8" stroke-width="1.5"/><path d="M${x} ${y} h${w}" stroke="${P.soil}" stroke-width="3"/>${Array.from({ length: 6 }, (_, k) => `<path d="M${x + (k + 1) * w / 7} ${y} v${-h * 0.45}" stroke="#aebfb6" stroke-width="1"/>`).join("")}</g>`;
  }).join("");
  const cloud = (cx, cy, s, o) => `<g opacity="${o}" class="cloud" style="--dx:${(Math.random() * 60 - 30).toFixed(0)}px"><ellipse cx="${cx}" cy="${cy}" rx="${90 * s}" ry="${22 * s}" fill="#fff"/><ellipse cx="${cx - 40 * s}" cy="${cy + 6 * s}" rx="${50 * s}" ry="${18 * s}" fill="#fff"/><ellipse cx="${cx + 45 * s}" cy="${cy + 4 * s}" rx="${60 * s}" ry="${20 * s}" fill="#fff"/></g>`;
  return `<svg class="landscape" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <defs>
    <linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.sky[0]}"/><stop offset="0.45" stop-color="${P.sky[1]}"/><stop offset="0.75" stop-color="${P.sky[2]}"/><stop offset="1" stop-color="${P.sky[3]}"/></linearGradient>
    <radialGradient id="${id}-sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${P.sun}" stop-opacity="1"/><stop offset="0.5" stop-color="${P.sun}" stop-opacity="0.35"/><stop offset="1" stop-color="${P.sun}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#${id}-sky)"/>
  <circle cx="${W * 0.66}" cy="${H * 0.5}" r="${H * 0.28}" fill="url(#${id}-sun)"/>
  <circle cx="${W * 0.66}" cy="${H * 0.5}" r="${H * 0.075}" fill="${P.sun}"/>
  ${clouds ? cloud(W * 0.2, H * 0.28, 1.1, 0.55) + cloud(W * 0.55, H * 0.2, 0.8, 0.4) + cloud(W * 0.85, H * 0.33, 0.9, 0.5) : ""}
  <path d="${ridge(H * 0.62, H * 0.12, 0.4)}" fill="${P.mountain[1]}" opacity="0.9"/>
  <path d="${ridge(H * 0.66, H * 0.09, 2.1)}" fill="${P.mountain[0]}"/>
  ${rows}
  ${houseRow}
</svg>`;
}
