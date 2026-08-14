// 注入可能な時計。試験は固定時計を使う (§28C 共通Test Harness「固定時計」)。

/** @typedef {{ nowMs():number, nowIso():string, timeZone:string }} Clock */

/** @returns {Clock} */
export function systemClock(timeZone = 'Asia/Tokyo') {
  return {
    nowMs: () => Date.now(),
    nowIso: () => new Date().toISOString(),
    timeZone,
  };
}

/**
 * 固定時計。テストと障害再現で使う。
 * @param {string|number} at ISO文字列またはepoch ms
 * @returns {Clock & { set(at:string|number):void, advance(ms:number):void }}
 */
export function fixedClock(at, timeZone = 'Asia/Tokyo') {
  let ms = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(ms)) throw new RangeError(`固定時計の初期値が不正です: ${at}`);
  return {
    nowMs: () => ms,
    nowIso: () => new Date(ms).toISOString(),
    timeZone,
    set(next) {
      ms = typeof next === 'number' ? next : Date.parse(next);
    },
    advance(deltaMs) {
      ms += deltaMs;
    },
  };
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
