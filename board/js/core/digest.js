// SHA-256 と、用途ごとにドメイン分離したdigest (§14 / §28A)。
// WebCrypto のみを使うのでブラウザ・Node双方で依存ゼロで動く。

import { canonicalize } from './jcs.js';

const subtle = globalThis.crypto?.subtle;
if (!subtle) {
  throw new Error('WebCrypto (crypto.subtle) が利用できません。HTTPS / localhost で開いてください。');
}

const encoder = new TextEncoder();

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/** 任意の文字列 / バイト列のSHA-256を小文字hexで返す。 */
export async function sha256Hex(input) {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  return toHex(await subtle.digest('SHA-256', bytes));
}

/**
 * ドメイン分離付きdigest。
 * 別用途のHashが偶然一致しないよう、必ず用途プレフィクスを前置する。
 * §28A の server_digest = SHA256("REIKI-PACKAGE-V1\n" + RFC8785(projection)) と同じ形。
 *
 * @param {string} domain 例 "REIKI-APPROVAL-BASIS-V1"
 * @param {unknown} value JCSで正規化できる値
 */
export async function domainDigest(domain, value) {
  return sha256Hex(`${domain}\n${canonicalize(value)}`);
}

/** 素材ファイルのSHA-256 (§25 assets[].sha256 / §30 素材Hash不一致の検出)。 */
export async function sha256OfBytes(bytes) {
  return toHex(await subtle.digest('SHA-256', bytes));
}

/** 64桁hexかどうか。受信Packageの検証に使う。 */
export function isSha256Hex(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
