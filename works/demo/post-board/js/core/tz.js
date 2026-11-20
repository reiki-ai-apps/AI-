// UTC保存 + IANAタイムゾーン表示 (§12 Schedule / §13 / §36「月跨ぎ・DSTを正しく表示する」)。
// Intl.DateTimeFormat のみを使い、独自のオフセット表は持たない。

const partsCache = new Map();

function formatterFor(timeZone) {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * UTCの瞬間を、指定タイムゾーンでのカレンダー上の値へ分解する。
 * @param {number} instantMs
 * @param {string} timeZone IANAタイムゾーン名
 * @returns {{year:number,month:number,day:number,hour:number,minute:number,second:number,weekday:number}}
 */
export function zonedParts(instantMs, timeZone) {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const out = {};
  for (const p of parts) {
    if (p.type === 'weekday') out.weekday = WEEKDAY_INDEX[p.value];
    else if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  // en-US の hour12:false は 24時を "24" と出す環境があるため 0 に寄せる。
  if (out.hour === 24) out.hour = 0;
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour,
    minute: out.minute,
    second: out.second,
    weekday: out.weekday,
  };
}

function offsetMsAt(utcMs, timeZone) {
  const p = zonedParts(utcMs, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - utcMs;
}

/**
 * 「そのタイムゾーンでのカレンダー時刻」からUTCの瞬間を求める。
 * DST境界でもオフセットを2回補正して収束させる。
 */
export function instantFromZoned({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  let ms = naive - offsetMsAt(naive, timeZone);
  ms = naive - offsetMsAt(ms, timeZone);
  return ms;
}

/** そのタイムゾーンでの日付キー "YYYY-MM-DD"。カレンダーの日セル割り当てに使う。 */
export function dateKey(instantMs, timeZone) {
  const p = zonedParts(instantMs, timeZone);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** "YYYY-MM-DD" を分解する。 */
export function parseDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) throw new RangeError(`日付キーの形式が不正です: ${key}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** 日付キーの前後移動。月跨ぎ・年跨ぎを含む。 */
export function shiftDateKey(key, days) {
  const { year, month, day } = parseDateKey(key);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** その月の日数。 */
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 月の1日が何曜日か (0=日)。 */
export function firstWeekdayOfMonth(year, month) {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

/** そのタイムゾーンでの "HH:MM"。 */
export function timeLabel(instantMs, timeZone) {
  const p = zonedParts(instantMs, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** ブラウザ/実行環境の既定タイムゾーン。 */
export function systemTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';
}

/** <input type="datetime-local"> の値 ("YYYY-MM-DDTHH:MM") へ。 */
export function toLocalInputValue(instantMs, timeZone) {
  const p = zonedParts(instantMs, timeZone);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** <input type="datetime-local"> の値からUTCの瞬間へ。 */
export function fromLocalInputValue(value, timeZone) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value ?? '');
  if (!m) return NaN;
  return instantFromZoned(
    { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5] },
    timeZone,
  );
}
