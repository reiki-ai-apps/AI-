// 識別子。テストでは決定的IDを注入できるようにしておく。

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let generator = () => globalThis.crypto.randomUUID();

export function uuid() {
  return generator();
}

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * テスト用に決定的なUUID列へ差し替える。
 * @param {() => string} fn
 * @returns {() => void} 元へ戻す関数
 */
export function withIdGenerator(fn) {
  const previous = generator;
  generator = fn;
  return () => {
    generator = previous;
  };
}

/** 連番から妥当な形のUUIDを作る (テスト専用)。 */
export function sequentialUuidGenerator(prefix = '00000000') {
  let n = 0;
  return () => {
    n += 1;
    const tail = String(n).padStart(12, '0');
    return `${prefix}-0000-4000-8000-${tail}`;
  };
}
