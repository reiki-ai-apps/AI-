// §06 カレンダーの表示契約 — 月セルの文言を作る唯一の場所。
//
// ここが構造的に守ること (G02):
//   ・1セルは最大2行。行はブランド1つにつき1行で、順序は常に ニュース → クリエイティブ
//   ・出力できるのは日本語の「状態＋件数」だけ。SNS名・時刻・タイトル・記号の凡例は
//     この関数の出力に現れる余地がない (入力から捨てている)
//   ・件数ゼロ(予定なし)と意図的休止は別の文言にする。色だけで区別しない
//
// UIはここが返した文字列をそのまま置くだけにする。UI側で文言を組み立てない。

import { BRANDS } from './brands.js';
import { sortPlatforms, platformName } from './platforms.js';
import { displayLabel } from './state.js';
import { dateKey as dateKeyOf, daysInMonth, shiftDateKey } from '../core/tz.js';
import { WEEKDAY_JA, monthTitle, weekdayOf } from '../core/fmt.js';

/** セルに出す短い状態語。図2の「投稿1」「予約2」「承認1」に対応する。 */
const CELL_TERMS = Object.freeze({
  PUBLISHED: '投稿',
  SCHEDULED: '予約',
  PENDING_APPROVAL: '承認',
  ACTION_REQUIRED: '要対応',
  PUBLISHING: '投稿中',
  QUALITY_REVIEW: '確認中',
  DRAFT: '下書き',
});

/** セル内での並び順。図2の「投稿1・承認1」を再現する。 */
const TERM_DISPLAY_ORDER = Object.freeze([
  'PUBLISHED',
  'SCHEDULED',
  'PENDING_APPROVAL',
  'ACTION_REQUIRED',
  'PUBLISHING',
  'QUALITY_REVIEW',
  'DRAFT',
]);

/** 3語以上になったとき、視覚的に残す語の優先度 (対応が必要なものを残す)。 */
const TERM_KEEP_PRIORITY = Object.freeze([
  'ACTION_REQUIRED',
  'PENDING_APPROVAL',
  'PUBLISHING',
  'SCHEDULED',
  'PUBLISHED',
  'QUALITY_REVIEW',
  'DRAFT',
]);

/**
 * SNSバッジに乗せる進捗の優先度。
 * 1つのSNSにその日いくつも投稿があるとき、**対応が必要なほう**を代表にする。
 * （「1件でも承認待ちが残っているならバッジは承認待ち」という読み方にする）
 */
const BADGE_STATE_PRIORITY = Object.freeze([
  'ACTION_REQUIRED',
  'PENDING_APPROVAL',
  'QUALITY_REVIEW',
  'DRAFT',
  'PUBLISHING',
  'SCHEDULED',
  'PUBLISHED',
]);

/** 1行に見せる語の上限。超えた分は読み上げ・ツールチップ側に残す。 */
export const MAX_TERMS_PER_ROW = 2;
/** 1セルの行数上限 (§06「月セル 最大2行」)。ブランドが2つなので構造的に2。 */
export const MAX_ROWS_PER_CELL = BRANDS.length;

export const EMPTY_LABEL = '予定なし';
export const PAUSED_LABEL = '休止';

/**
 * 投稿1件がカレンダー上のどの日に載るか。
 * 公開済みは実際に公開された日、それ以外は公開予定日。
 */
export function calendarInstantOf(item) {
  return item.publishedAtMs ?? item.scheduledAtMs;
}

function termsFor(counts) {
  const present = TERM_DISPLAY_ORDER.filter((k) => (counts[k] ?? 0) > 0);
  return present.map((k) => ({
    key: k,
    label: CELL_TERMS[k],
    fullLabel: displayLabel(k),
    count: counts[k],
  }));
}

function visibleTerms(terms) {
  if (terms.length <= MAX_TERMS_PER_ROW) return terms;
  const keep = new Set(
    TERM_KEEP_PRIORITY.filter((k) => terms.some((t) => t.key === k)).slice(0, MAX_TERMS_PER_ROW),
  );
  return terms.filter((t) => keep.has(t.key));
}

function rowText(terms) {
  return terms.map((t) => `${t.label}${t.count}`).join('・');
}

/**
 * 月間カレンダーのRead Modelを組み立てる。
 *
 * @param {object} input
 * @param {number} input.year
 * @param {number} input.month 1-12
 * @param {string} input.timeZone IANAタイムゾーン
 * @param {string} input.todayKey "YYYY-MM-DD"
 * @param {Array<{id:string,brandId:string,platform?:string,displayState:string,scheduledAtMs:number,publishedAtMs?:number}>} input.items
 * @param {Array<{dateKey:string,paused:boolean,reason?:string,setBy?:string,setAtIso?:string}>} [input.dayPlans]
 */
export function buildMonthView({ year, month, timeZone, todayKey, items = [], dayPlans = [] }) {
  const byDay = new Map();
  for (const item of items) {
    const key = dateKeyOf(calendarInstantOf(item), timeZone);
    let day = byDay.get(key);
    if (!day) {
      day = new Map();
      byDay.set(key, day);
    }
    let entry = day.get(item.brandId);
    if (!entry) {
      entry = { counts: {}, platforms: new Map() };
      day.set(item.brandId, entry);
    }
    entry.counts[item.displayState] = (entry.counts[item.displayState] ?? 0) + 1;
    if (item.platform) {
      let p = entry.platforms.get(item.platform);
      if (!p) {
        p = { counts: {}, total: 0 };
        entry.platforms.set(item.platform, p);
      }
      p.counts[item.displayState] = (p.counts[item.displayState] ?? 0) + 1;
      p.total += 1;
    }
  }

  const plans = new Map(dayPlans.map((p) => [p.dateKey, p]));

  const total = daysInMonth(year, month);
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const firstKey = `${monthPrefix}-01`;

  // 月曜始まり (図2)。JSの getUTCDay は 0=日 なので月曜基準へ寄せる。
  const leading = (weekdayOf(firstKey) + 6) % 7;

  const cells = [];
  for (let i = 0; i < leading; i += 1) {
    cells.push(outsideCell(shiftDateKey(firstKey, i - leading)));
  }
  for (let d = 1; d <= total; d += 1) {
    const key = `${monthPrefix}-${String(d).padStart(2, '0')}`;
    cells.push(buildCell(key, byDay.get(key), plans.get(key), todayKey));
  }
  const lastKey = `${monthPrefix}-${String(total).padStart(2, '0')}`;
  let after = 1;
  while (cells.length % 7 !== 0) {
    cells.push(outsideCell(shiftDateKey(lastKey, after)));
    after += 1;
  }

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return {
    year,
    month,
    title: monthTitle(year, month),
    weeks,
    cells: cells.filter((c) => c.inMonth),
    summary: summarize(cells.filter((c) => c.inMonth)),
  };
}

// ---------------------------------------------------------------------------
// 週表示 (§05 の派生)
//
// 1週間なら1日あたりの面積が月表示の6倍以上になる。そこで月セルのような
// 「状態＋件数」の要約ではなく、**投稿を1件ずつ**時刻順に出す。
// 月表示の §06 制約（最大2行・SNS/時刻/タイトルを置かない）は月セル用の契約なので、
// 週表示には適用しない。ここでは読めることを優先する。
// ---------------------------------------------------------------------------

/** その日付が属する週の月曜日。 */
export function weekStartKey(dateKey) {
  const wd = weekdayOf(dateKey); // 0=日
  return shiftDateKey(dateKey, -((wd + 6) % 7));
}

/**
 * 今日を基準にした7日単位の表示開始日。
 * 今日〜6日後を最初の窓にし、その外を選んだときだけ前後の7日へ移る。
 */
export function rollingWeekStartKey(dateKey, todayKey) {
  const dayMs = 86_400_000;
  const selectedMs = Date.parse(`${dateKey}T00:00:00Z`);
  const todayMs = Date.parse(`${todayKey}T00:00:00Z`);
  if (!Number.isFinite(selectedMs) || !Number.isFinite(todayMs)) return todayKey;
  const offsetDays = Math.round((selectedMs - todayMs) / dayMs);
  return shiftDateKey(todayKey, Math.floor(offsetDays / 7) * 7);
}

/** "8月10日〜16日" のような週の見出し。月をまたぐ場合は両方出す。 */
export function weekTitle(startKey) {
  const endKey = shiftDateKey(startKey, 6);
  const s = { m: Number(startKey.slice(5, 7)), d: Number(startKey.slice(8, 10)), y: Number(startKey.slice(0, 4)) };
  const e = { m: Number(endKey.slice(5, 7)), d: Number(endKey.slice(8, 10)), y: Number(endKey.slice(0, 4)) };
  if (s.y !== e.y) return `${s.y}年${s.m}月${s.d}日 〜 ${e.y}年${e.m}月${e.d}日`;
  if (s.m !== e.m) return `${s.y}年${s.m}月${s.d}日 〜 ${e.m}月${e.d}日`;
  return `${s.y}年${s.m}月${s.d}日 〜 ${e.d}日`;
}

/**
 * 週表示のRead Model。
 *
 * @param {object} input
 * @param {string} input.startDateKey 7日表示の起点
 * @param {string} input.timeZone
 * @param {string} input.todayKey
 * @param {Array<{id,brandId,platform,displayState,title,scheduledAtMs,publishedAtMs?}>} input.items
 * @param {Array} [input.dayPlans]
 */
export function buildWeekView({ startDateKey, timeZone, todayKey, items = [], dayPlans = [] }) {
  const start = startDateKey;
  const keys = Array.from({ length: 7 }, (_, i) => shiftDateKey(start, i));
  const plans = new Map(dayPlans.map((p) => [p.dateKey, p]));

  const byDay = new Map(keys.map((k) => [k, []]));
  for (const item of items) {
    const key = dateKeyOf(calendarInstantOf(item), timeZone);
    if (!byDay.has(key)) continue;
    byDay.get(key).push(item);
  }

  const counts = {};
  let emptyDays = 0;
  let pausedDays = 0;

  const days = keys.map((key) => {
    const list = byDay.get(key).slice().sort((a, b) => calendarInstantOf(a) - calendarInstantOf(b));
    const plan = plans.get(key);
    const paused = plan?.paused === true;

    const entries = list.map((item) => {
      const b = BY_BRAND.get(item.brandId);
      const state = displayLabel(item.displayState);
      counts[item.displayState] = (counts[item.displayState] ?? 0) + 1;
      return {
        id: item.id,
        atMs: calendarInstantOf(item),
        brandId: item.brandId,
        brandLabel: b?.cellLabel ?? item.brandId,
        brandName: b?.name ?? item.brandId,
        brandTone: b?.tone ?? 'neutral',
        platform: item.platform ?? null,
        platformName: item.platform ? platformName(item.platform) : '',
        displayState: item.displayState,
        stateLabel: state,
        title: item.title ?? '',
      };
    });

    if (entries.length === 0) {
      if (paused) pausedDays += 1;
      else emptyDays += 1;
    }

    return {
      dateKey: key,
      day: Number(key.slice(8, 10)),
      month: Number(key.slice(5, 7)),
      weekday: weekdayOf(key),
      weekdayLabel: WEEKDAY_JA[weekdayOf(key)],
      isToday: key === todayKey,
      entries,
      totalCount: entries.length,
      emptyLabel: entries.length > 0 ? null : paused ? PAUSED_LABEL : EMPTY_LABEL,
      paused: paused
        ? { reason: plan.reason ?? '', setBy: plan.setBy ?? '', setAtIso: plan.setAtIso ?? null }
        : null,
      ariaLabel: dayAriaLabel(key, entries, entries.length > 0 ? null : paused ? PAUSED_LABEL : EMPTY_LABEL),
    };
  });

  return {
    startDateKey: start,
    endDateKey: shiftDateKey(start, 6),
    title: weekTitle(start),
    days,
    summary: { counts, emptyDays, pausedDays },
  };
}

/** 読み上げ: 日付 → 曜日 → 件数 → 各件（時刻・SNS・系統・状態）。 */
function dayAriaLabel(key, entries, emptyLabel) {
  const month = Number(key.slice(5, 7));
  const day = Number(key.slice(8, 10));
  const head = `${month}月${day}日 ${WEEKDAY_JA[weekdayOf(key)]}曜日`;
  if (emptyLabel) return `${head}、${emptyLabel}`;
  return `${head}、${entries.length}件`;
}

const BY_BRAND = new Map(BRANDS.map((b) => [b.id, b]));

function outsideCell(key) {
  const day = Number(key.slice(8, 10));
  return {
    dateKey: key,
    day,
    inMonth: false,
    isToday: false,
    rows: [],
    platforms: [],
    emptyLabel: null,
    paused: null,
    counts: {},
    totalCount: 0,
    ariaLabel: '',
  };
}

/** そのSNSを代表する進捗を1つ選ぶ。 */
function dominantState(counts) {
  return BADGE_STATE_PRIORITY.find((s) => (counts[s] ?? 0) > 0) ?? null;
}

/** 同じSNSが両系統で使われている日は、件数を足して代表状態を選び直す。 */
function mergePlatformStates(list) {
  const byPlatform = new Map();
  for (const entry of list) {
    const found = byPlatform.get(entry.platform);
    if (!found) {
      byPlatform.set(entry.platform, { platform: entry.platform, counts: { ...entry.counts }, total: entry.total });
      continue;
    }
    for (const [k, v] of Object.entries(entry.counts)) found.counts[k] = (found.counts[k] ?? 0) + v;
    found.total += entry.total;
  }
  return sortPlatforms([...byPlatform.keys()]).map((p) => {
    const e = byPlatform.get(p);
    const state = dominantState(e.counts);
    return {
      platform: p,
      platformName: platformName(p),
      /** バッジに乗せる代表の進捗（対応が必要なものを優先）。 */
      displayState: state,
      stateLabel: state ? displayLabel(state) : '',
      /** そのSNSのその日の合計件数。 */
      count: e.total,
      counts: e.counts,
      /** 状態ごとの内訳。読み上げとツールチップはこちらを使う（代表状態だけにしない）。 */
      terms: TERM_DISPLAY_ORDER.filter((k) => (e.counts[k] ?? 0) > 0).map((k) => ({
        key: k,
        fullLabel: displayLabel(k),
        count: e.counts[k],
      })),
    };
  });
}

function buildCell(key, brandEntries, plan, todayKey) {
  const rows = [];
  const counts = {};
  const allPlatformStates = [];
  let totalCount = 0;

  // 行順はブランドの定義順で固定する。データの到着順に影響されない (§06)。
  for (const b of BRANDS) {
    const entry = brandEntries?.get(b.id);
    if (!entry) continue;
    const terms = termsFor(entry.counts);
    if (!terms.length) continue;
    const shown = visibleTerms(terms);
    const rowPlatformStates = mergePlatformStates(
      [...entry.platforms].map(([platform, v]) => ({ platform, counts: v.counts, total: v.total })),
    );
    allPlatformStates.push(...rowPlatformStates.map((s) => ({ ...s, counts: s.counts, total: s.count })));
    rows.push({
      brandId: b.id,
      brandLabel: b.cellLabel,
      brandName: b.name,
      tone: b.tone,
      terms: shown,
      allTerms: terms,
      text: rowText(shown),
      truncated: shown.length < terms.length,
      platforms: rowPlatformStates.map((s) => s.platform),
      platformStates: rowPlatformStates,
    });
    for (const t of terms) {
      counts[t.key] = (counts[t.key] ?? 0) + t.count;
      totalCount += t.count;
    }
  }

  const platformStates = mergePlatformStates(allPlatformStates);

  const paused = plan?.paused === true;
  const emptyLabel = totalCount > 0 ? null : paused ? PAUSED_LABEL : EMPTY_LABEL;

  return {
    dateKey: key,
    day: Number(key.slice(8, 10)),
    inMonth: true,
    isToday: key === todayKey,
    rows: rows.slice(0, MAX_ROWS_PER_CELL),
    /**
     * その日に投稿があるSNSと、そのSNSの進捗。バッジとして出す。
     * セルの「文言」には入れない — 文字はあくまで日本語の状態＋件数だけ (§06)。
     */
    platformStates,
    platforms: platformStates.map((s) => s.platform),
    emptyLabel,
    paused: paused
      ? { reason: plan.reason ?? '', setBy: plan.setBy ?? '', setAtIso: plan.setAtIso ?? null }
      : null,
    counts,
    totalCount,
    ariaLabel: cellAriaLabel(key, rows, emptyLabel),
  };
}

/**
 * 読み上げ順は 日付 → 系統 → SNSごとの状態と件数 (§32)。
 * 視覚的に省略した語も、バッジでしか出していない「SNS名＋進捗」も、ここには必ず残す。
 */
function cellAriaLabel(key, rows, emptyLabel) {
  const month = Number(key.slice(5, 7));
  const day = Number(key.slice(8, 10));
  const head = `${month}月${day}日 ${WEEKDAY_JA[weekdayOf(key)]}曜日`;
  if (emptyLabel) return `${head}、${emptyLabel}`;
  const parts = rows.map((r) => {
    // SNSごとの進捗が分かる形にする。バッジが伝えている内容と一致させる。
    if (r.platformStates?.length) {
      const per = r.platformStates
        .map((s) => `${s.platformName} ${s.terms.map((t) => `${t.fullLabel}${t.count}件`).join(' ')}`)
        .join('、');
      return `${r.brandName} ${per}`;
    }
    return `${r.brandName} ${r.allTerms.map((t) => `${t.fullLabel}${t.count}件`).join(' ')}`;
  });
  return `${head}、${parts.join('、')}`;
}

/** 上部の状況行 (図2「8月の投稿状況 投稿済み13 予約済み26 承認待ち3 予定なし2日」)。 */
function summarize(monthCells) {
  const counts = {};
  let emptyDays = 0;
  let pausedDays = 0;
  for (const cell of monthCells) {
    if (cell.emptyLabel === EMPTY_LABEL) emptyDays += 1;
    if (cell.emptyLabel === PAUSED_LABEL) pausedDays += 1;
    for (const [k, v] of Object.entries(cell.counts)) {
      counts[k] = (counts[k] ?? 0) + v;
    }
  }
  return { counts, emptyDays, pausedDays };
}

/**
 * 状況行の表示要素を作る。0件の項目は出さない (数字の羅列にしない)。
 * @returns {Array<{key:string,label:string,count:number,unit:string}>}
 */
export function summaryEntries(summary) {
  const out = [];
  for (const key of ['PUBLISHED', 'SCHEDULED', 'PENDING_APPROVAL', 'ACTION_REQUIRED']) {
    const count = summary.counts[key] ?? 0;
    if (count > 0) out.push({ key, label: displayLabel(key), count, unit: '' });
  }
  if (summary.emptyDays > 0) {
    out.push({ key: 'EMPTY', label: EMPTY_LABEL, count: summary.emptyDays, unit: '日' });
  }
  if (summary.pausedDays > 0) {
    out.push({ key: 'PAUSED', label: PAUSED_LABEL, count: summary.pausedDays, unit: '日' });
  }
  return out;
}
