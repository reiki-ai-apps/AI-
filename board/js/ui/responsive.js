// §09 レスポンシブ契約 — 3段階。7列カレンダーを縮小して読めなくしない。
//
// CSSのメディアクエリと、この宣言は必ず同じ境界値を使う (G14)。
// app.css の --bp-wide / --bp-medium と一致していること。

export const BREAKPOINT_WIDE = 1280;
export const BREAKPOINT_MEDIUM = 768;

export const RESPONSIVE_TIERS = Object.freeze([
  Object.freeze({
    id: 'WIDE',
    minWidth: BREAKPOINT_WIDE,
    label: '1280px以上',
    contract: '月間カレンダー＋右詳細を横並び',
    /** 右詳細を常設パネルとして出す */
    detail: 'SIDE_PANEL',
    calendar: 'MONTH_GRID',
  }),
  Object.freeze({
    id: 'MEDIUM',
    minWidth: BREAKPOINT_MEDIUM,
    label: '768–1279px',
    contract: '月間カレンダー＋詳細ドロワー',
    detail: 'DRAWER',
    calendar: 'MONTH_GRID',
  }),
  Object.freeze({
    id: 'NARROW',
    minWidth: 0,
    label: '767px以下',
    contract: '今日／次対応／時刻順リストを先頭。7日ストリップと月切替',
    detail: 'INLINE_FIRST',
    calendar: 'WEEK_STRIP',
  }),
]);

/** その幅で適用される段階を返す。 */
export function tierForWidth(width) {
  return RESPONSIVE_TIERS.find((t) => width >= t.minWidth) ?? RESPONSIVE_TIERS.at(-1);
}

/** いまのウィンドウ幅の段階。 */
export function currentTier() {
  return tierForWidth(globalThis.innerWidth ?? BREAKPOINT_WIDE);
}

/**
 * 幅の変化を監視する。段階が変わったときだけ通知する。
 * @param {(tier:object)=>void} onChange
 * @returns {()=>void} 解除する関数
 */
export function observeTier(onChange) {
  let current = currentTier();
  onChange(current);
  const handler = () => {
    const next = currentTier();
    if (next.id === current.id) return;
    current = next;
    onChange(next);
  };
  globalThis.addEventListener?.('resize', handler, { passive: true });
  return () => globalThis.removeEventListener?.('resize', handler);
}
