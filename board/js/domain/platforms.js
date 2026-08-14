// §21 / §38 出す先の媒体。画面には正式名だけを出す。
// §06「セル禁止: SNS略称」を守るため、このモジュールは略称を返す関数を持たない。
//
// note は SNS ではないが、実際の運用では本数がいちばん多い出し先なので同じ台帳に載せる。
// 公式の投稿APIが公開されていないため、経路は手動投稿Fallback (§16) だけになる。

export const PLATFORMS = Object.freeze([
  Object.freeze({ id: 'NOTE', name: 'note', tone: 'note' }),
  Object.freeze({ id: 'YOUTUBE', name: 'YouTube', tone: 'youtube' }),
  Object.freeze({ id: 'INSTAGRAM', name: 'Instagram', tone: 'instagram' }),
  Object.freeze({ id: 'TIKTOK', name: 'TikTok', tone: 'tiktok' }),
  Object.freeze({ id: 'X', name: 'X', tone: 'x' }),
]);

export const PLATFORM_ORDER = Object.freeze(PLATFORMS.map((p) => p.id));

const BY_ID = new Map(PLATFORMS.map((p) => [p.id, p]));

export function platform(id) {
  const found = BY_ID.get(id);
  if (!found) throw new RangeError(`未知のSNSです: ${id}`);
  return found;
}

export function isPlatformId(id) {
  return BY_ID.has(id);
}

/** 正式名。略称は存在しない。 */
export function platformName(id) {
  return platform(id).name;
}

/** 表示順に並べ替える。 */
export function sortPlatforms(ids) {
  return [...ids].sort((a, b) => PLATFORM_ORDER.indexOf(a) - PLATFORM_ORDER.indexOf(b));
}
