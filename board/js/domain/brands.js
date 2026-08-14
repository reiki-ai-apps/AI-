// §12 Brand — AIニュース / AIクリエイティブ の2系統だけ。
// 月セルの行順は必ず「ニュース」→「クリエイティブ」で固定する (§06)。

export const BRANDS = Object.freeze([
  Object.freeze({
    id: 'news',
    /** 月セル・右詳細の短い表記 (図2) */
    cellLabel: 'ニュース',
    /** 正式名。登録・履歴・読み上げではこちらを使う。 */
    name: 'AIニュース',
    tone: 'news',
  }),
  Object.freeze({
    id: 'creative',
    cellLabel: 'クリエイティブ',
    name: 'AIクリエイティブ',
    tone: 'creative',
  }),
]);

/** 表示順。この配列の順序が月セルの行順そのもの。 */
export const BRAND_ORDER = Object.freeze(BRANDS.map((b) => b.id));

const BY_ID = new Map(BRANDS.map((b) => [b.id, b]));

export function brand(id) {
  const found = BY_ID.get(id);
  if (!found) throw new RangeError(`未知のブランドです: ${id}`);
  return found;
}

export function isBrandId(id) {
  return BY_ID.has(id);
}

export function brandName(id) {
  return brand(id).name;
}

export function brandCellLabel(id) {
  return brand(id).cellLabel;
}
