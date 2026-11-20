// SNSバッジ — 月セルの日付行に置く小さな印。
//
// §06 は月セルの「文言」に SNS略称 を置くことを禁じている。
// バッジは文言ではなく図形で示し、SNS名は aria-label / title で必ず伝える。
// 形が違うので色が見えない環境でも区別できる（§32 色だけで伝えない）。
//
// 図形の定義は BADGE_SPEC 1か所だけ。DOMを組む platformBadge() と、
// 静的プレビューを書き出す scripts/make-preview.mjs が同じ定義を読む。

import { platformName, PLATFORM_ORDER } from '../domain/platforms.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * バッジの見た目。16×16のviewBox上に描く。
 * fill = 背景色、glyph = 白で重ねる図形。
 */
export const BADGE_SPEC = Object.freeze({
  NOTE: Object.freeze({
    fill: '#1f7a63',
    // 記事＝横罫のページ
    glyph: Object.freeze([
      { tag: 'path', attrs: { d: 'M4.8 5.2h6.4M4.8 8h6.4M4.8 10.8h4.1', stroke: '#fff', 'stroke-width': 1.4, 'stroke-linecap': 'round' } },
    ]),
  }),
  YOUTUBE: Object.freeze({
    fill: '#e8262a',
    // 再生の三角
    glyph: Object.freeze([{ tag: 'path', attrs: { d: 'M6.4 4.7 11.5 8 6.4 11.3z', fill: '#fff' } }]),
  }),
  YOUTUBE_SHORTS: Object.freeze({
    fill: '#e8262a',
    glyph: Object.freeze([
      { tag: 'path', attrs: { d: 'M6.4 4.7 11.5 8 6.4 11.3z', fill: '#fff' } },
      { tag: 'path', attrs: { d: 'M12.6 3.7v3.1M11 5.2h3.2', stroke: '#fff', 'stroke-width': 1.1, 'stroke-linecap': 'round' } },
    ]),
  }),
  INSTAGRAM: Object.freeze({
    fill: '#b8358b',
    // 角丸の四角＋レンズ
    glyph: Object.freeze([
      { tag: 'rect', attrs: { x: 4.1, y: 4.1, width: 7.8, height: 7.8, rx: 2.5, fill: 'none', stroke: '#fff', 'stroke-width': 1.4 } },
      { tag: 'circle', attrs: { cx: 8, cy: 8, r: 2.05, fill: 'none', stroke: '#fff', 'stroke-width': 1.4 } },
    ]),
  }),
  TIKTOK: Object.freeze({
    fill: '#17212b',
    // 音符
    glyph: Object.freeze([
      { tag: 'circle', attrs: { cx: 6.3, cy: 10.7, r: 1.95, fill: '#fff' } },
      { tag: 'path', attrs: { d: 'M8.25 10.7V4.5l3.4-1v1.7l-2.2.65v4.85z', fill: '#fff' } },
    ]),
  }),
  X: Object.freeze({
    fill: '#3f4a56',
    glyph: Object.freeze([
      { tag: 'path', attrs: { d: 'M4.7 4.5 11.3 11.5M11.3 4.5 4.7 11.5', stroke: '#fff', 'stroke-width': 1.8, 'stroke-linecap': 'round' } },
    ]),
  }),
});

/**
 * 進捗の印。バッジの右下に重ねる小さな円。
 * 色だけでなく**形も変える**ので、色が読めなくても区別できる（§32）。
 *
 *   投稿済み   緑 ＋ チェック
 *   予約済み   青 ＋ 点
 *   投稿中     青 ＋ 三角（送信中）
 *   承認待ち   琥珀 ＋ 感嘆符   ← 内容確認待ち
 *   確認中     琥珀 ＋ 中黒     ← 品質確認中
 *   下書き     灰 ＋ 白抜き円
 *   要対応     赤 ＋ バツ
 *
 * 円の中心は (14.5, 14.5)、半径 4.4。viewBox は 0 0 20 20。
 */
export const STATE_SPEC = Object.freeze({
  PUBLISHED: Object.freeze({
    fill: '#1e7b54',
    glyph: Object.freeze([{ tag: 'path', attrs: { d: 'M12.3 14.6 13.9 16.2 16.8 12.9', fill: 'none', stroke: '#fff', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } }]),
  }),
  SCHEDULED: Object.freeze({
    fill: '#2e63e9',
    glyph: Object.freeze([{ tag: 'circle', attrs: { cx: 14.5, cy: 14.5, r: 1.7, fill: '#fff' } }]),
  }),
  PUBLISHING: Object.freeze({
    fill: '#2e63e9',
    glyph: Object.freeze([{ tag: 'path', attrs: { d: 'M12.9 12.2 17.1 14.5 12.9 16.8z', fill: '#fff' } }]),
  }),
  PENDING_APPROVAL: Object.freeze({
    fill: '#a55d00',
    glyph: Object.freeze([
      { tag: 'path', attrs: { d: 'M14.5 11.8v3.1', stroke: '#fff', 'stroke-width': 1.7, 'stroke-linecap': 'round' } },
      { tag: 'circle', attrs: { cx: 14.5, cy: 17.1, r: 0.95, fill: '#fff' } },
    ]),
  }),
  QUALITY_REVIEW: Object.freeze({
    fill: '#a55d00',
    glyph: Object.freeze([{ tag: 'circle', attrs: { cx: 14.5, cy: 14.5, r: 1.7, fill: '#fff' } }]),
  }),
  DRAFT: Object.freeze({
    fill: '#66717d',
    glyph: Object.freeze([{ tag: 'circle', attrs: { cx: 14.5, cy: 14.5, r: 1.8, fill: 'none', stroke: '#fff', 'stroke-width': 1.4 } }]),
  }),
  ACTION_REQUIRED: Object.freeze({
    fill: '#c23b2d',
    glyph: Object.freeze([
      { tag: 'path', attrs: { d: 'M12.6 12.6 16.4 16.4M16.4 12.6 12.6 16.4', stroke: '#fff', 'stroke-width': 1.6, 'stroke-linecap': 'round' } },
    ]),
  }),
});

/** バッジと重なる部分を白く抜くための縁取り。 */
const STATE_HALO = Object.freeze({ tag: 'circle', attrs: { cx: 14.5, cy: 14.5, r: 5.6, fill: '#fff' } });

function svg(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** バッジ1つが伝える内容を文にする。ツールチップと読み上げに使う。 */
function badgeText(platform, state) {
  const name = platformName(platform);
  if (!state?.displayState) return name;
  const breakdown = state.terms?.length
    ? state.terms.map((t) => `${t.fullLabel}${t.count}件`).join(' ')
    : state.stateLabel;
  return `${name} ${breakdown}`;
}

/**
 * 1つのSNSバッジを作る。
 * @param {string} platform
 * @param {object} [options]
 * @param {number} [options.size] 表示サイズ(px)
 * @param {boolean} [options.decorative] true なら読み上げから外す（親がaria-labelを持つ場合）
 * @param {object} [options.state] {displayState, stateLabel, terms} — 進捗の印を重ねる
 */
export function platformBadge(platform, { size = 20, decorative = false, state = null } = {}) {
  const spec = BADGE_SPEC[platform];
  if (!spec) throw new RangeError(`未知のSNSです: ${platform}`);
  const text = badgeText(platform, state);

  const node = svg('svg', {
    viewBox: '0 0 20 20',
    width: size,
    height: size,
    class: 'sns-badge',
    focusable: 'false',
  });
  if (decorative) {
    node.setAttribute('aria-hidden', 'true');
  } else {
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', text);
  }
  // マウスを乗せればSNS名と進捗が読める。
  const title = svg('title', {});
  title.textContent = text;
  node.appendChild(title);

  node.appendChild(svg('rect', { width: 16, height: 16, rx: 4.4, fill: spec.fill }));
  for (const g of spec.glyph) node.appendChild(svg(g.tag, g.attrs));

  const stateSpec = state?.displayState ? STATE_SPEC[state.displayState] : null;
  if (stateSpec) {
    node.appendChild(svg(STATE_HALO.tag, STATE_HALO.attrs));
    node.appendChild(svg('circle', { cx: 14.5, cy: 14.5, r: 4.4, fill: stateSpec.fill }));
    for (const g of stateSpec.glyph) node.appendChild(svg(g.tag, g.attrs));
  }
  return node;
}

/**
 * SNSバッジを並べたコンテナ。表示順は常に YouTube → Instagram → TikTok → X。
 * @param {Array<string|{platform:string}>} platforms 進捗つきなら platformStates をそのまま渡す
 */
export function platformBadges(platforms, options = {}) {
  const wrap = document.createElement('span');
  wrap.className = 'sns-badges';
  const byId = new Map(
    platforms.map((p) => (typeof p === 'string' ? [p, null] : [p.platform, p])),
  );
  for (const id of PLATFORM_ORDER) {
    if (!byId.has(id)) continue;
    wrap.appendChild(platformBadge(id, { ...options, state: byId.get(id) }));
  }
  return wrap;
}

/** SNSバッジの凡例（どの図形がどのSNSか）。 */
export function badgeLegend() {
  const wrap = document.createElement('span');
  wrap.className = 'sns-legend';
  for (const p of PLATFORM_ORDER) {
    const item = document.createElement('span');
    item.className = 'sns-legend-item';
    item.appendChild(platformBadge(p, { decorative: true, size: 18 }));
    item.appendChild(document.createTextNode(platformName(p)));
    wrap.appendChild(item);
  }
  return wrap;
}

/** 凡例に出す進捗の順序。 */
export const LEGEND_STATES = Object.freeze([
  'PUBLISHED',
  'SCHEDULED',
  'PENDING_APPROVAL',
  'ACTION_REQUIRED',
  'DRAFT',
]);

/** 進捗の印だけの凡例（SNSの図形は入れない）。 */
export function stateLegend(labelOf) {
  const wrap = document.createElement('span');
  wrap.className = 'sns-legend';
  for (const s of LEGEND_STATES) {
    const spec = STATE_SPEC[s];
    const item = document.createElement('span');
    item.className = 'sns-legend-item';
    const mark = svg('svg', { viewBox: '9 9 11 11', width: 13, height: 13, class: 'state-mark', 'aria-hidden': 'true', focusable: 'false' });
    mark.appendChild(svg('circle', { cx: 14.5, cy: 14.5, r: 4.4, fill: spec.fill }));
    for (const g of spec.glyph) mark.appendChild(svg(g.tag, g.attrs));
    item.appendChild(mark);
    item.appendChild(document.createTextNode(labelOf(s)));
    wrap.appendChild(item);
  }
  return wrap;
}

/**
 * 同じ定義からSVG文字列を作る（DOMのない環境向け）。
 * 静的プレビューの書き出しだけに使う。アプリ本体はDOM版を使うこと。
 */
export function badgeMarkup(platform, { size = 20, state = null } = {}) {
  const spec = BADGE_SPEC[platform];
  if (!spec) throw new RangeError(`未知のSNSです: ${platform}`);
  const attrs = (o) => Object.entries(o).map(([k, v]) => `${k}="${v}"`).join(' ');
  const draw = (list) => list.map((g) => `<${g.tag} ${attrs(g.attrs)}/>`).join('');

  const stateSpec = state?.displayState ? STATE_SPEC[state.displayState] : null;
  const overlay = stateSpec
    ? `<circle ${attrs(STATE_HALO.attrs)}/><circle cx="14.5" cy="14.5" r="4.4" fill="${stateSpec.fill}"/>${draw(stateSpec.glyph)}`
    : '';

  return (
    `<svg viewBox="0 0 20 20" width="${size}" height="${size}" class="sns-badge" aria-hidden="true">` +
    `<title>${badgeText(platform, state)}</title>` +
    `<rect width="16" height="16" rx="4.4" fill="${spec.fill}"/>${draw(spec.glyph)}${overlay}</svg>`
  );
}

/** 進捗の印だけのSVG文字列（凡例用）。 */
export function stateMarkMarkup(stateId, { size = 13 } = {}) {
  const spec = STATE_SPEC[stateId];
  if (!spec) throw new RangeError(`未知の状態です: ${stateId}`);
  const attrs = (o) => Object.entries(o).map(([k, v]) => `${k}="${v}"`).join(' ');
  const shapes = spec.glyph.map((g) => `<${g.tag} ${attrs(g.attrs)}/>`).join('');
  return (
    `<svg viewBox="9 9 11 11" width="${size}" height="${size}" class="state-mark" aria-hidden="true">` +
    `<circle cx="14.5" cy="14.5" r="4.4" fill="${spec.fill}"/>${shapes}</svg>`
  );
}
