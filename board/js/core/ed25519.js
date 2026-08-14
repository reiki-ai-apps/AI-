// Ed25519 署名 (§28A ActionIntent)。WebCrypto のみで依存パッケージなし。
//
// Node 24 と Chrome/Edge の SubtleCrypto は {name:'Ed25519'} を直接サポートする。
// 公開鍵は raw 32バイト、署名は 64バイトで、どちらも base64url で持ち回る。
//
// このモジュールは秘密鍵を保存しない。ブラウザ側が持つのは
// 「登録された発行者の公開鍵」だけで、署名は §27 の呼び出し側が行う。

import { sha256OfBytes } from './digest.js';

const subtle = globalThis.crypto?.subtle;

export const ED25519 = Object.freeze({ name: 'Ed25519' });
export const PUBLIC_KEY_BYTES = 32;
export const SIGNATURE_BYTES = 64;

export class CryptoError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CryptoError';
    this.code = code;
  }
}

/**
 * この環境で Ed25519 が使えるか。
 * 使えない環境では鍵登録の画面を出さず、理由を表示するために使う。
 */
export async function isEd25519Available() {
  if (!subtle) return false;
  try {
    await subtle.generateKey(ED25519, true, ['sign', 'verify']);
    return true;
  } catch {
    return false;
  }
}

function requireSubtle() {
  if (!subtle) {
    throw new CryptoError('CRYPTO_UNAVAILABLE', 'WebCrypto が利用できません。HTTPS / localhost で開いてください。');
  }
  return subtle;
}

// ---------------------------------------------------------------------------
// base64url (RFC 4648 §5)。btoa/atob だけで書けるのでブラウザ・Node共通。
// ---------------------------------------------------------------------------

const B64URL_RE = /^[A-Za-z0-9_-]+$/;

export function toBase64Url(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text) {
  if (typeof text !== 'string' || text.length === 0 || !B64URL_RE.test(text)) {
    throw new CryptoError('BAD_BASE64URL', 'base64url として読めない値です。');
  }
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new CryptoError('BAD_BASE64URL', 'base64url として読めない値です。');
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// 鍵
// ---------------------------------------------------------------------------

/** 発行者側で鍵を作る。テストと、鍵を持たない利用者への案内に使う。 */
export async function generateSigningKeyPair() {
  return requireSubtle().generateKey(ED25519, true, ['sign', 'verify']);
}

/** 公開鍵を base64url(raw 32バイト) にする。登録時に受け取る形。 */
export async function exportPublicKey(publicKey) {
  const raw = await requireSubtle().exportKey('raw', publicKey);
  return toBase64Url(new Uint8Array(raw));
}

/** base64url(raw 32バイト) を検証用のCryptoKeyへ戻す。 */
export async function importPublicKey(publicKeyB64u) {
  const bytes = fromBase64Url(publicKeyB64u);
  if (bytes.length !== PUBLIC_KEY_BYTES) {
    throw new CryptoError('BAD_PUBLIC_KEY', `Ed25519 の公開鍵は ${PUBLIC_KEY_BYTES} バイトです（受信: ${bytes.length}）。`);
  }
  try {
    return await requireSubtle().importKey('raw', bytes, ED25519, true, ['verify']);
  } catch (error) {
    throw new CryptoError('BAD_PUBLIC_KEY', `公開鍵を読み込めません: ${error.message}`);
  }
}

/**
 * 鍵ID = SHA-256(公開鍵の生バイト) の小文字hex。
 * 誰でも公開鍵から同じ値を再計算できるので、鍵IDの取り違えを検出できる。
 */
export async function keyIdOf(publicKeyB64u) {
  const bytes = fromBase64Url(publicKeyB64u);
  if (bytes.length !== PUBLIC_KEY_BYTES) {
    throw new CryptoError('BAD_PUBLIC_KEY', `Ed25519 の公開鍵は ${PUBLIC_KEY_BYTES} バイトです（受信: ${bytes.length}）。`);
  }
  return sha256OfBytes(bytes);
}

// ---------------------------------------------------------------------------
// 署名 / 検証
// ---------------------------------------------------------------------------

/** バイト列に署名し、base64url の署名を返す。 */
export async function signBytes(privateKey, bytes) {
  const sig = await requireSubtle().sign(ED25519, privateKey, bytes);
  return toBase64Url(new Uint8Array(sig));
}

/**
 * 署名を検証する。
 * 形が違う署名は例外にせず false を返す（呼び出し側は「不正な署名」として同じ扱いにする）。
 */
export async function verifyBytes(publicKey, signatureB64u, bytes) {
  let sig;
  try {
    sig = fromBase64Url(signatureB64u);
  } catch {
    return false;
  }
  if (sig.length !== SIGNATURE_BYTES) return false;
  try {
    return await requireSubtle().verify(ED25519, publicKey, sig, bytes);
  } catch {
    return false;
  }
}
