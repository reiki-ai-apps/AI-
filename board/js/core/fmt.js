// 日本語文言の出口。画面に出る日付・時刻・件数の表記はここだけで作る。
// §06「セル文言は日本語で直書き」/ §32「日付・系統・件数・状態を自然な順で読み上げる」

import { parseDateKey, zonedParts, timeLabel } from './tz.js';
import { MINUTE_MS } from './clock.js';

export const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];
/** カレンダーの列見出し。月曜始まり (図2)。 */
export const WEEK_COLUMNS_JA = ['月', '火', '水', '木', '金', '土', '日'];

/** "2026年8月" */
export function monthTitle(year, month) {
  return `${year}年${month}月`;
}

/** その日付キーの曜日 (0=日)。 */
export function weekdayOf(dateKey) {
  const { year, month, day } = parseDateKey(dateKey);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** "8月11日（火）" — 選択日の見出し (図2)。 */
export function dayHeading(dateKey) {
  const { month, day } = parseDateKey(dateKey);
  return `${month}月${day}日（${WEEKDAY_JA[weekdayOf(dateKey)]}）`;
}

/** "2026年8月11日（火）" — 読み上げ・監査表示用の完全形。 */
export function fullDayLabel(dateKey) {
  const { year, month, day } = parseDateKey(dateKey);
  return `${year}年${month}月${day}日（${WEEKDAY_JA[weekdayOf(dateKey)]}）`;
}

/** "18:30" */
export function clockLabel(instantMs, timeZone) {
  if (!Number.isFinite(instantMs)) return '時刻未定';
  return timeLabel(instantMs, timeZone);
}

/** "8月11日 18:30" — 履歴・通知で日付をまたぐときに使う。 */
export function stampLabel(instantMs, timeZone) {
  if (!Number.isFinite(instantMs)) return '日時未定';
  const p = zonedParts(instantMs, timeZone);
  return `${p.month}月${p.day}日 ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/**
 * 「3分前」「2時間前」。最終同期時刻の補助表示に使う。
 * 未来や1分未満は「たった今」。
 */
export function relativeLabel(instantMs, nowMs) {
  const diff = nowMs - instantMs;
  if (diff < MINUTE_MS) return 'たった今';
  const minutes = Math.floor(diff / MINUTE_MS);
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.floor(hours / 24)}日前`;
}

/**
 * 「あと35分」「あと2時間」。予定時刻までの猶予を伝えるときに使う。
 * 過ぎていれば null (「あと-3分」のような表示を作らせない)。
 */
export function untilLabel(instantMs, nowMs) {
  const diff = instantMs - nowMs;
  if (diff <= 0) return null;
  const minutes = Math.round(diff / MINUTE_MS);
  if (minutes < 60) return `あと${Math.max(1, minutes)}分`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `あと${hours}時間`;
  return `あと${Math.floor(hours / 24)}日`;
}

/** "3件" — 件数はゼロを出さない前提の場所で使う。 */
export function countLabel(n) {
  return `${n}件`;
}

/** "2日" — 日数。 */
export function dayCountLabel(n) {
  return `${n}日`;
}
