// RFC 8785 JSON Canonicalization Scheme (JCS).
// 承認根拠Hash(§14 approval_basis_hash)と冪等性digest(§28A)の入力を、
// 表現の差(キー順・空白・数値表記)に依らず同一バイト列へ落とすために使う。
//
// 依存ゼロ。ECMAScriptのJSON.stringifyは
//   ・数値をNumber::toString(RFC 8785が要求する表記)で出力する
//   ・文字列を最短エスケープ + well-formed(孤立サロゲートは\udXXX)で出力する
// ため、そのまま利用できる。JCSが追加で要求するのは「オブジェクトキーを
// UTF-16コード単位順に並べる」ことだけで、それがこのモジュールの本体。

/** JCSが受け付けない値を拒否する。 */
function reject(value, why) {
  throw new TypeError(`JCS: ${why} は正規化できません (${String(value)})`);
}

function canonicalizeInto(value, out) {
  if (value === null) {
    out.push('null');
    return;
  }

  const t = typeof value;

  if (t === 'boolean') {
    out.push(value ? 'true' : 'false');
    return;
  }

  if (t === 'number') {
    if (!Number.isFinite(value)) reject(value, 'NaN / Infinity');
    // JSON.stringify(-0) === "0"。RFC 8785も -0 は "0"。
    out.push(JSON.stringify(value));
    return;
  }

  if (t === 'string') {
    out.push(JSON.stringify(value));
    return;
  }

  if (t === 'bigint') reject(value, 'BigInt');
  if (t === 'function' || t === 'symbol' || t === 'undefined') reject(value, t);

  if (Array.isArray(value)) {
    out.push('[');
    for (let i = 0; i < value.length; i += 1) {
      if (i > 0) out.push(',');
      const item = value[i];
      // 配列内のundefinedはJSONではnull。JCSでも同じ扱いにする。
      canonicalizeInto(item === undefined ? null : item, out);
    }
    out.push(']');
    return;
  }

  if (value instanceof Date) reject(value, 'Date (ISO文字列へ変換してから渡すこと)');

  // オブジェクト: キーをUTF-16コード単位順に並べる。
  // JavaScriptの既定の文字列比較がまさにUTF-16コード単位順なので sort() でよい。
  const keys = Object.keys(value).sort();
  out.push('{');
  let wrote = 0;
  for (const key of keys) {
    const v = value[key];
    if (v === undefined) continue; // JSONと同じくキーごと落とす
    if (wrote > 0) out.push(',');
    out.push(JSON.stringify(key));
    out.push(':');
    canonicalizeInto(v, out);
    wrote += 1;
  }
  out.push('}');
}

/**
 * 値をRFC 8785の正規形JSON文字列にする。
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalize(value) {
  const out = [];
  canonicalizeInto(value, out);
  return out.join('');
}

/** 正規形JSONのUTF-8バイト列。digestの入力はこちらを使う。 */
export function canonicalBytes(value) {
  return new TextEncoder().encode(canonicalize(value));
}

/**
 * オブジェクトから指定キーを除いた浅いコピーを返す。
 * §28A の「署名projectionからsignatureとderived digestを除外する」用。
 */
export function omit(obj, ...keys) {
  const drop = new Set(keys);
  const copy = {};
  for (const k of Object.keys(obj)) {
    if (!drop.has(k)) copy[k] = obj[k];
  }
  return copy;
}
