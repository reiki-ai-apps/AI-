// 商品カテゴリ・目的別のイラスト(SVG)。写真が用意できるまでの視覚素材。
// すべて 64x64、stroke は currentColor、塗りは --ic-fill(CSS変数)で色を変えられる。
const svg = (body) => `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const F = 'fill="var(--ic-fill,#e6f2ea)" stroke="none"';

export const ICONS = {
  // カテゴリ
  pipe: svg(`<rect x="6" y="20" width="52" height="10" rx="5" ${F}/><rect x="6" y="20" width="52" height="10" rx="5"/><rect x="6" y="36" width="52" height="10" rx="5" ${F}/><rect x="6" y="36" width="52" height="10" rx="5"/><path d="M14 20v-6M50 20v-6M14 46v6M50 46v6"/>`),
  joint: svg(`<rect x="27" y="6" width="10" height="52" rx="5" ${F}/><rect x="6" y="27" width="52" height="10" rx="5" ${F}/><rect x="27" y="6" width="10" height="52" rx="5"/><rect x="6" y="27" width="52" height="10" rx="5"/><circle cx="32" cy="32" r="7" fill="#fff"/><circle cx="32" cy="32" r="7"/>`),
  reinforce: svg(`<path d="M8 54 L32 10 L56 54 Z" ${F}/><path d="M8 54 L32 10 L56 54 Z"/><path d="M20 54 L32 30 L44 54M32 30V54"/>`),
  fastener: svg(`<path d="M10 40c0-16 8-24 22-24s22 8 22 24" ${F}/><path d="M10 40c0-16 8-24 22-24s22 8 22 24"/><rect x="6" y="40" width="52" height="10" rx="4" fill="#fff"/><rect x="6" y="40" width="52" height="10" rx="4"/><path d="M18 45h6M30 45h6M42 45h6"/>`),
  film: svg(`<rect x="10" y="14" width="44" height="36" rx="18" ${F}/><rect x="10" y="14" width="44" height="36" rx="18"/><ellipse cx="46" cy="32" rx="8" ry="18" fill="#fff"/><ellipse cx="46" cy="32" rx="8" ry="18"/><ellipse cx="46" cy="32" rx="3" ry="7"/>`),
  door: svg(`<path d="M8 56V26a24 24 0 0 1 48 0v30" ${F}/><path d="M8 56V26a24 24 0 0 1 48 0v30"/><rect x="24" y="30" width="16" height="26" rx="2" fill="#fff"/><rect x="24" y="30" width="16" height="26" rx="2"/><path d="M8 56h48M36 44v4"/>`),
  vent: svg(`<circle cx="32" cy="32" r="24" ${F}/><circle cx="32" cy="32" r="24"/><path d="M32 32c-2-10 2-18 8-20-6 8-4 14-8 20zM32 32c10-2 18 2 20 8-8-6-14-4-20-8zM32 32c2 10-2 18-8 20 6-8 4-14 8-20zM32 32c-10 2-18-2-20-8 8 6 14 4 20 8z"/><circle cx="32" cy="32" r="3" fill="#fff"/>`),
  curtain: svg(`<rect x="6" y="10" width="52" height="8" rx="4" ${F}/><rect x="6" y="10" width="52" height="8" rx="4"/><path d="M12 18c0 14 4 26 6 36M24 18c0 14-2 26 0 36M40 18c0 14 2 26 0 36M52 18c0 14-4 26-6 36"/><path d="M12 54h40"/>`),
  control: svg(`<rect x="8" y="10" width="48" height="36" rx="6" ${F}/><rect x="8" y="10" width="48" height="36" rx="6"/><path d="M16 36l8-10 8 6 8-14 8 8" stroke-width="3.6"/><path d="M24 54h16M32 46v8"/>`),
  irrigation: svg(`<path d="M32 8c10 14 16 22 16 30a16 16 0 0 1-32 0c0-8 6-16 16-30z" ${F}/><path d="M32 8c10 14 16 22 16 30a16 16 0 0 1-32 0c0-8 6-16 16-30z"/><path d="M26 40a6 6 0 0 0 6 6"/>`),
  gutter: svg(`<path d="M6 22c10 20 22 20 26 0 4 20 16 20 26 0" ${F}/><path d="M6 22c10 20 22 20 26 0 4 20 16 20 26 0"/><path d="M28 34v14a4 4 0 0 0 8 0V34" fill="#fff"/><path d="M28 34v14a4 4 0 0 0 8 0V34"/>`),
  mulch: svg(`<rect x="6" y="12" width="52" height="40" rx="6" ${F}/><rect x="6" y="12" width="52" height="40" rx="6"/><path d="M6 25h52M6 38h52M19 12v40M32 12v40M45 12v40"/>`),
  animal: svg(`<path d="M8 54V22M22 54V14M42 54V14M56 54V22" /><path d="M8 26h48M8 40h48" ${F.replace('fill="var(--ic-fill,#e6f2ea)"', 'fill="none"')}/><path d="M8 26h48M8 40h48"/><path d="M26 6l6 6 6-6" stroke-width="3.6"/><circle cx="32" cy="10" r="4" fill="var(--ic-fill,#e6f2ea)"/>`),
  // 目的別
  recover: svg(`<path d="M8 56V30a24 24 0 0 1 48 0v26" ${F}/><path d="M8 56V30a24 24 0 0 1 48 0v26"/><path d="M8 56h48"/><path d="M40 10l10 4-4 10" /><path d="M50 14c-8-6-20-6-26 2"/>`),
  storm: svg(`<path d="M12 22c-8 0-8 12 0 12h36c10 0 10-16 0-16-2-10-18-10-20-2-8-4-16 0-16 6z" ${F}/><path d="M12 22c-8 0-8 12 0 12h36c10 0 10-16 0-16-2-10-18-10-20-2-8-4-16 0-16 6z"/><path d="M34 38l-6 10h8l-6 10" stroke-width="3.6"/><path d="M14 40l-2 6M50 40l2 6"/>`),
  heat: svg(`<circle cx="32" cy="28" r="12" ${F}/><circle cx="32" cy="28" r="12"/><path d="M32 6v6M32 44v6M10 28h6M48 28h6M16 12l4 4M44 12l-4 4M16 44l4-4M44 44l-4-4"/><path d="M10 58c6-6 10 0 16-4M36 58c6-6 10 0 16-4"/>`),
  repair: svg(`<path d="M40 8a12 12 0 0 0-14 14L10 38l6 6 16-16a12 12 0 0 0 14-14l-6 6-6-6z" ${F}/><path d="M40 8a12 12 0 0 0-14 14L10 38l6 6 16-16a12 12 0 0 0 14-14l-6 6-6-6z"/><path d="M36 42l12 12 6-6-12-12"/>`),
  build: svg(`<path d="M8 56V30a24 24 0 0 1 48 0v26" ${F}/><path d="M8 56V30a24 24 0 0 1 48 0v26M8 56h48"/><path d="M20 56V34M32 56V26M44 56V34"/><path d="M50 8l6 6M56 8l-6 6"/>`),
  water: svg(`<path d="M8 48h48" /><path d="M14 48v-8M26 48v-14M38 48v-10M50 48v-16"/><path d="M14 32c3 4 3 6 0 8M26 26c3 4 3 6 0 8M38 30c3 4 3 6 0 8M50 24c3 4 3 6 0 8" ${F}/><path d="M6 20h52" stroke-width="4"/>`),
  pest: svg(`<circle cx="32" cy="34" r="14" ${F}/><circle cx="32" cy="34" r="14"/><path d="M32 20v-8M24 16l4 6M40 16l-4 6M18 34H8M46 34h10M20 44l-8 6M44 44l8 6"/><path d="M8 8l48 48" stroke-width="4"/>`),
  basket: svg(`<path d="M8 26h48l-6 26H14z" ${F}/><path d="M8 26h48l-6 26H14z"/><path d="M20 26l8-16M44 26l-8-16M24 34v10M32 34v10M40 34v10"/>`),
  mic: svg(`<rect x="22" y="6" width="20" height="32" rx="10" ${F}/><rect x="22" y="6" width="20" height="32" rx="10"/><path d="M14 30a18 18 0 0 0 36 0M32 48v10M22 58h20"/>`),
  chat: svg(`<path d="M8 12h48v30H26L12 54V42H8z" ${F}/><path d="M8 12h48v30H26L12 54V42H8z"/><path d="M18 24h28M18 32h18"/>`),
  phone: svg(`<path d="M14 8h12l6 12-8 6c4 8 10 14 18 18l6-8 12 6v12c0 4-4 6-8 6C30 60 4 34 4 12c0-2 2-4 4-4z" ${F}/><path d="M14 8h12l6 12-8 6c4 8 10 14 18 18l6-8 12 6v12c0 4-4 6-8 6C30 60 4 34 4 12c0-2 2-4 4-4z"/>`),
  camera: svg(`<rect x="6" y="18" width="52" height="36" rx="6" ${F}/><rect x="6" y="18" width="52" height="36" rx="6"/><path d="M22 18l4-8h12l4 8"/><circle cx="32" cy="36" r="10" fill="#fff"/><circle cx="32" cy="36" r="10"/>`),
  cube: svg(`<path d="M32 6l24 12v28L32 58 8 46V18z" ${F}/><path d="M32 6l24 12v28L32 58 8 46V18z"/><path d="M8 18l24 12 24-12M32 30v28"/>`),
  star: svg(`<path d="M32 6l8 16 18 3-13 12 3 18-16-8-16 8 3-18L6 25l18-3z" ${F}/><path d="M32 6l8 16 18 3-13 12 3 18-16-8-16 8 3-18L6 25l18-3z"/>`),
  bell: svg(`<path d="M16 44V28a16 16 0 0 1 32 0v16l6 6H10z" ${F}/><path d="M16 44V28a16 16 0 0 1 32 0v16l6 6H10z"/><path d="M26 56a6 6 0 0 0 12 0M32 6v6"/>`),
  truck: svg(`<path d="M6 16h32v28H6z" ${F}/><path d="M6 16h32v28H6zM38 26h12l8 10v8H38z"/><circle cx="16" cy="48" r="5" fill="#fff"/><circle cx="16" cy="48" r="5"/><circle cx="48" cy="48" r="5" fill="#fff"/><circle cx="48" cy="48" r="5"/>`)
};
export const icon = (name, cls = "") => `<span class="ic ${cls}">${ICONS[name] || ICONS.cube}</span>`;
