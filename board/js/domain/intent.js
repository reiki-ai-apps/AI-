// §26/§28A ActionIntent — 契約そのもの（純粋関数のみ）。
//
// 「状態を変える操作は、署名された意図(ActionIntent)としてただ1つの入口を通る」が §26 の要求。
// このモジュールは その意図の“形”だけを定める。署名検証・DB消費・実行は services/gateway.js。
//
// 設計の要点:
//   ・署名対象は  "REIKI-ACTION-INTENT-V1\n" + RFC8785(signature を除いた封筒)
//     → キー順・空白・数値表記が違っても同じバイト列になるので、中継や再直列化で壊れない
//   ・jti は1回しか使えない（原子消費）。有効期限つきなので、消費済みjtiは期限後に掃除できる
//   ・パラメータは action ごとに許可キーを列挙する。未知のキーは受け付けない

import { isUuid } from '../core/ids.js';
import { isRole } from './rbac.js';

export const INTENT_CONTRACT_VERSION = 'REIKI-ACTION-INTENT-V1';
export const INTENT_AUDIENCE = 'reiki-post-board';
/** digest / 署名のドメイン分離文字列 (§28A の server_digest と同じ作り)。 */
export const INTENT_DIGEST_DOMAIN = 'REIKI-ACTION-INTENT-V1';

/** 意図の寿命の上限。長寿命の署名は盗まれたときの被害が大きい。 */
export const MAX_INTENT_TTL_MS = 15 * 60_000;
/**
 * 呼び出し側との時計ずれの許容。§27 でHTTP越しに来る意図は別の時計で作られる。
 * 「ずれで正しい意図を落とす」を避けるだけの幅にとどめ、TTL の上限とは別に持つ。
 */
export const CLOCK_SKEW_MS = 30_000;

export const ENVELOPE_KEYS = Object.freeze([
  'contract_version',
  'jti',
  'issuer',
  'audience',
  'action',
  'actor',
  'target',
  'params',
  'issued_at',
  'not_before',
  'expires_at',
  'signature',
]);

/**
 * Gateway が受け付ける操作。
 * `operation` は §17 の権限表のキー。services 側も同じキーで再検査する（二重検査）。
 * `params` は許可キーと型。`?` 付きは省略可。
 */
export const INTENT_ACTIONS = Object.freeze({
  'approval.approve': Object.freeze({
    label: '公開を承認する',
    operation: 'approval.approve',
    targetType: 'channelPost',
    params: Object.freeze({ comment: 'string?', allowedRetryDelayMinutes: 'number?' }),
  }),
  'approval.reject': Object.freeze({
    label: '差し戻す',
    operation: 'approval.reject',
    targetType: 'channelPost',
    params: Object.freeze({ comment: 'string' }),
  }),
  'schedule.set': Object.freeze({
    label: '公開日時を変更する',
    operation: 'schedule.set',
    targetType: 'channelPost',
    params: Object.freeze({ scheduled_at: 'iso', time_zone: 'string?' }),
  }),
  'schedule.cancel': Object.freeze({
    label: '予約を取り消す',
    operation: 'schedule.cancel',
    targetType: 'channelPost',
    params: Object.freeze({ reason: 'string' }),
  }),
  // 制作の進み具合の申告。承認根拠に影響しないので権限は「軽微な編集」で足りる。
  'production.update': Object.freeze({
    label: '制作の進み具合を更新する',
    operation: 'post.edit.internal',
    targetType: 'channelPost',
    params: Object.freeze({ kind: 'string?', steps: 'steps', reason: 'string?' }),
  }),
  'execution.manual.claim': Object.freeze({
    label: '手動投稿を取得する',
    operation: 'execution.manual',
    targetType: 'channelPost',
    params: Object.freeze({ reason: 'string?' }),
  }),
  'execution.manual.confirm': Object.freeze({
    label: '手動投稿の結果を登録する',
    operation: 'execution.manual',
    targetType: 'channelPost',
    params: Object.freeze({
      external_post_id: 'string?',
      public_url: 'string?',
      published_at: 'iso?',
      account_matches: 'boolean',
      content_matches: 'boolean',
      published_at_matches: 'boolean',
    }),
  }),
  'execution.manual.release': Object.freeze({
    label: '手動投稿をやめる',
    operation: 'execution.manual',
    targetType: 'channelPost',
    params: Object.freeze({ reason: 'string' }),
  }),
  'execution.outcome_unknown': Object.freeze({
    label: '結果不明として記録する',
    operation: 'execution.manual',
    targetType: 'channelPost',
    params: Object.freeze({ reason: 'string?' }),
  }),
  // 停止範囲は target.id ("ALL" / "BRAND:news" / "ACCOUNT:<id>") に持たせる。
  // params 側に scope を重ねて持たせない（署名された対象と実際の停止範囲を1つにする）。
  'emergency.stop': Object.freeze({
    label: '緊急停止する',
    operation: 'emergency.stop',
    targetType: 'scope',
    params: Object.freeze({ reason: 'string' }),
  }),
  'emergency.release': Object.freeze({
    label: '緊急停止を解除する',
    operation: 'emergency.stop',
    targetType: 'emergencyStop',
    params: Object.freeze({ reason: 'string' }),
  }),
});

export const INTENT_ACTION_IDS = Object.freeze(Object.keys(INTENT_ACTIONS));

export function isIntentAction(id) {
  return Object.hasOwn(INTENT_ACTIONS, id);
}

export function intentAction(id) {
  const a = INTENT_ACTIONS[id];
  if (!a) throw new RangeError(`未知のActionです: ${id}`);
  return a;
}

/** Gateway が拒否した理由。HTTPへ載せる場合の status もここで決める (§27/§29)。 */
export class IntentError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'IntentError';
    this.code = code;
    this.status = status;
  }
}

/** 緊急停止の範囲を表す target.id の形。 */
export const SCOPE_TARGET_RE = /^(?:ALL|(?:BRAND|ACCOUNT):\S+)$/;

/**
 * "ALL" / "BRAND:news" / "ACCOUNT:x-main" を services/emergency.js の引数へ分解する。
 * @returns {{scope:'ALL'|'BRAND'|'ACCOUNT', scopeId:string|null}}
 */
export function parseScopeTarget(targetId) {
  if (typeof targetId !== 'string' || !SCOPE_TARGET_RE.test(targetId)) {
    throw new IntentError(
      'BAD_INTENT',
      `停止範囲の指定が不正です: ${String(targetId)}（ALL / BRAND:<系統> / ACCOUNT:<アカウント>）`,
      400,
    );
  }
  if (targetId === 'ALL') return { scope: 'ALL', scopeId: null };
  const separator = targetId.indexOf(':');
  return { scope: targetId.slice(0, separator), scopeId: targetId.slice(separator + 1) };
}

// ---------------------------------------------------------------------------
// 形の検証
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoInstant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function bad(message) {
  return new IntentError('BAD_INTENT', message, 400);
}

function checkParamType(key, value, type) {
  const optional = type.endsWith('?');
  const base = optional ? type.slice(0, -1) : type;
  if (value === undefined || value === null) {
    if (optional) return;
    throw bad(`パラメータ ${key} は必須です。`);
  }
  const okByType = {
    string: () => isNonEmptyString(value),
    number: () => typeof value === 'number' && Number.isFinite(value),
    boolean: () => typeof value === 'boolean',
    iso: () => isIsoInstant(value),
    // 作業の一覧。中身の細かい検査は domain/production.js が行う。
    steps: () => Array.isArray(value) && value.length > 0 && value.every(isPlainObject),
  }[base];
  if (!okByType) throw new RangeError(`未知のパラメータ型です: ${type}`);
  if (!okByType()) throw bad(`パラメータ ${key} の値が ${base} として不正です。`);
}

/** action ごとの許可キーだけを通す。未知のキーは受け付けない。 */
export function assertParams(actionId, params) {
  const spec = intentAction(actionId).params;
  if (!isPlainObject(params)) throw bad('params はオブジェクトで指定してください。');
  for (const key of Object.keys(params)) {
    if (!Object.hasOwn(spec, key)) {
      throw bad(`${actionId} では受け付けないパラメータです: ${key}`);
    }
  }
  for (const [key, type] of Object.entries(spec)) {
    checkParamType(key, params[key], type);
  }
  return params;
}

/**
 * 封筒の形を検査する。
 * ここを通らない意図は署名検証にも進ませない（未知の形に暗号処理を当てない）。
 */
export function assertIntentShape(envelope) {
  if (!isPlainObject(envelope)) throw bad('ActionIntent はオブジェクトで指定してください。');

  const extra = Object.keys(envelope).filter((k) => !ENVELOPE_KEYS.includes(k));
  if (extra.length) throw bad(`ActionIntent に未知の項目があります: ${extra.join(', ')}`);

  if (envelope.contract_version !== INTENT_CONTRACT_VERSION) {
    throw new IntentError(
      'UNSUPPORTED_CONTRACT',
      `対応していない契約版です: ${String(envelope.contract_version)}（対応: ${INTENT_CONTRACT_VERSION}）`,
      400,
    );
  }
  if (envelope.audience !== INTENT_AUDIENCE) {
    throw new IntentError(
      'AUDIENCE_MISMATCH',
      `この意図の宛先はこのシステムではありません: ${String(envelope.audience)}`,
      403,
    );
  }
  if (!isUuid(envelope.jti)) throw bad('jti はUUIDで指定してください。');
  if (typeof envelope.issuer !== 'string' || !/^[0-9a-f]{64}$/.test(envelope.issuer)) {
    throw bad('issuer は登録済みの鍵ID（64桁hex）で指定してください。');
  }
  if (!isIntentAction(envelope.action)) {
    throw new IntentError('UNKNOWN_ACTION', `この入口では実行できない操作です: ${String(envelope.action)}`, 400);
  }

  if (!isPlainObject(envelope.actor)) throw bad('actor はオブジェクトで指定してください。');
  if (!isNonEmptyString(envelope.actor.user_id)) throw bad('actor.user_id は必須です。');
  if (!isRole(envelope.actor.role)) throw bad(`actor.role が不正です: ${String(envelope.actor.role)}`);
  const actorExtra = Object.keys(envelope.actor).filter((k) => k !== 'user_id' && k !== 'role');
  if (actorExtra.length) throw bad(`actor に未知の項目があります: ${actorExtra.join(', ')}`);

  const spec = intentAction(envelope.action);
  if (!isPlainObject(envelope.target)) throw bad('target はオブジェクトで指定してください。');
  if (envelope.target.type !== spec.targetType) {
    throw bad(`${envelope.action} の対象は ${spec.targetType} です（受信: ${String(envelope.target.type)}）。`);
  }
  if (!isNonEmptyString(envelope.target.id)) throw bad('target.id は必須です。');
  const targetExtra = Object.keys(envelope.target).filter((k) => k !== 'type' && k !== 'id');
  if (targetExtra.length) throw bad(`target に未知の項目があります: ${targetExtra.join(', ')}`);
  if (spec.targetType === 'scope') parseScopeTarget(envelope.target.id);

  assertParams(envelope.action, envelope.params);

  for (const key of ['issued_at', 'not_before', 'expires_at']) {
    if (!isIsoInstant(envelope[key])) throw bad(`${key} はISO 8601の日時で指定してください。`);
  }
  if (!isNonEmptyString(envelope.signature)) throw bad('signature は必須です。');

  return envelope;
}

/**
 * 署名・digest の対象。signature を外した封筒。
 * jcs.omit() と同じことをするが、除外キーをこの契約側で固定しておく。
 */
export function signingProjection(envelope) {
  const copy = {};
  for (const key of ENVELOPE_KEYS) {
    if (key === 'signature') continue;
    if (envelope[key] !== undefined) copy[key] = envelope[key];
  }
  return copy;
}

/**
 * 時間窓の検査。形の検査を通った封筒だけを渡すこと。
 * @param {object} envelope
 * @param {number} nowMs
 */
export function assertTimeWindow(envelope, nowMs) {
  const issued = Date.parse(envelope.issued_at);
  const notBefore = Date.parse(envelope.not_before);
  const expires = Date.parse(envelope.expires_at);

  if (notBefore < issued) throw bad('not_before は issued_at 以降にしてください。');
  if (expires <= notBefore) throw bad('expires_at は not_before より後にしてください。');
  if (expires - issued > MAX_INTENT_TTL_MS) {
    throw new IntentError(
      'TTL_TOO_LONG',
      `意図の有効期間が長すぎます（上限 ${MAX_INTENT_TTL_MS / 60_000} 分）。`,
      400,
    );
  }
  if (nowMs + CLOCK_SKEW_MS < notBefore) {
    throw new IntentError('INTENT_NOT_YET_VALID', 'この意図はまだ有効になっていません。', 400);
  }
  if (nowMs - CLOCK_SKEW_MS >= expires) {
    throw new IntentError('INTENT_EXPIRED', '意図の有効期限が切れています。作り直してください。', 401);
  }
  return { issued, notBefore, expires };
}
