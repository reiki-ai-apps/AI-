// §26/§28A 単一Action Gateway
//
// 状態を変える操作を外部から受けるとき、通る入口をここ1つに限る。
// 呼び出し側（§27 の統合API・各スキル）は「署名された意図(ActionIntent)」を出し、
// Gateway は次の順で受け入れを決める。順序そのものが要件である。
//
//   1. 形            … 契約版・宛先・action・target・params を厳格に検査する
//   2. 発行者        … issuer(鍵ID)が登録済みで失効していないこと
//   3. 署名          … Ed25519。ここを通るまで中身を信用しない
//   4. 時間窓        … not_before / expires_at / TTL上限。署名を確かめた後に見る
//   5. jtiの原子消費 … 主キー add() の失敗＝二重使用。読んでから書く形にしない
//   6. 実行          … services層へ委譲。権限は services 側でも再検査される（二重検査）
//   7. 結果の記録    … 同じjtiの再送には保存済みの結果をそのまま返す
//
// 署名対象と digest は同一のバイト列:
//     "REIKI-ACTION-INTENT-V1\n" + RFC8785(signature を除いた封筒)
// 表現差（キー順・空白・数値表記）で壊れないので、中継や再直列化を挟んでも一致する。
//
// 秘密鍵はこのアプリのどこにも保存しない。保持するのは発行者の公開鍵だけ (§19 / G11)。

import { canonicalize } from '../core/jcs.js';
import { sha256Hex } from '../core/digest.js';
import { uuid } from '../core/ids.js';
import { importPublicKey, keyIdOf, signBytes, verifyBytes, CryptoError } from '../core/ed25519.js';
import { assertCan } from '../domain/rbac.js';
import {
  INTENT_ACTIONS,
  INTENT_AUDIENCE,
  INTENT_CONTRACT_VERSION,
  INTENT_DIGEST_DOMAIN,
  IntentError,
  MAX_INTENT_TTL_MS,
  assertIntentShape,
  assertTimeWindow,
  intentAction,
  parseScopeTarget,
  signingProjection,
} from '../domain/intent.js';

import { approve, reject } from './approvals.js';
import { reschedule, cancelSchedule } from './schedule.js';
import {
  claimManualExecution,
  confirmManualPublish,
  releaseManualClaim,
  markOutcomeUnknown,
} from './manual.js';
import { createEmergencyStop, releaseEmergencyStop } from './emergency.js';
import { updateProduction } from './production.js';

const encoder = new TextEncoder();

/** 消費済み意図の状態。 */
export const INTENT_STATES = Object.freeze({
  IN_FLIGHT: 'IN_FLIGHT',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
});

// ---------------------------------------------------------------------------
// 署名対象のバイト列
// ---------------------------------------------------------------------------

/** 署名とdigestが同じものを覆うよう、入力文字列を1か所で作る。 */
function signingInput(projection) {
  return `${INTENT_DIGEST_DOMAIN}\n${canonicalize(projection)}`;
}

/** 封筒の canonical digest（小文字hex）。監査と証拠に残す値。 */
export async function actionIntentDigest(envelope) {
  return sha256Hex(signingInput(signingProjection(envelope)));
}

/**
 * 発行者側の道具。署名前の封筒を組み立てる。
 * 本番では呼び出し側（別プロセス）が持つ機能で、ここにあるのは §27 の相手方実装と
 * テストが同じ契約を使うため。
 */
export function draftActionIntent({
  issuer,
  action,
  actor,
  target,
  params = {},
  issuedAtIso,
  ttlMs = 5 * 60_000,
  jti = uuid(),
}) {
  if (ttlMs > MAX_INTENT_TTL_MS) {
    throw new IntentError('TTL_TOO_LONG', `有効期間の上限は ${MAX_INTENT_TTL_MS / 60_000} 分です。`, 400);
  }
  const issuedMs = Date.parse(issuedAtIso);
  if (!Number.isFinite(issuedMs)) {
    throw new IntentError('BAD_INTENT', 'issued_at はISO 8601の日時で指定してください。', 400);
  }
  return {
    contract_version: INTENT_CONTRACT_VERSION,
    jti,
    issuer,
    audience: INTENT_AUDIENCE,
    action,
    actor: { user_id: actor.userId ?? actor.user_id, role: actor.role },
    target,
    params,
    issued_at: new Date(issuedMs).toISOString(),
    not_before: new Date(issuedMs).toISOString(),
    expires_at: new Date(issuedMs + ttlMs).toISOString(),
  };
}

/** 発行者側の道具。署名を付けた封筒を返す。 */
export async function signActionIntent(privateKey, intent) {
  const projection = signingProjection(intent);
  const signature = await signBytes(privateKey, encoder.encode(signingInput(projection)));
  return { ...projection, signature };
}

// ---------------------------------------------------------------------------
// 発行者の公開鍵
// ---------------------------------------------------------------------------

/**
 * 発行者の公開鍵を登録する。
 * @param {object} ctx
 * @param {{publicKey:string, label:string}} input publicKey は base64url(raw 32バイト)
 */
export async function registerIssuerKey(ctx, { publicKey, label }) {
  assertCan(ctx.actor.role, 'connection.manage');
  const name = typeof label === 'string' ? label.trim() : '';
  if (!name) throw new IntentError('BAD_KEY_LABEL', '鍵の名前を入力してください。', 400);

  // 読み込めない鍵は登録しない。登録できた＝検証できる、を保証する。
  await importPublicKey(publicKey);
  const keyId = await keyIdOf(publicKey);

  const record = {
    key_id: keyId,
    algorithm: 'Ed25519',
    public_key: publicKey,
    label: name,
    registered_by: ctx.actor.userId,
    registered_at: ctx.clock.nowIso(),
    revoked_at: null,
    revoked_reason: null,
  };

  try {
    await ctx.repo.change(['actionKeys'], async (tx, audit) => {
      await tx.add('actionKeys', record);
      await audit({
        actor: ctx.actor.userId,
        target_type: 'actionKey',
        target_id: keyId,
        action: 'action.key.register',
        after_hash: keyId,
        reason: `発行者の公開鍵を登録：${name}`,
      });
    });
  } catch (error) {
    if (error.code === 'CONSTRAINT_VIOLATION') {
      throw new IntentError('KEY_ALREADY_REGISTERED', 'この公開鍵はすでに登録されています。', 409);
    }
    throw error;
  }

  return { keyId, label: name };
}

/** 鍵を失効させる。失効後は、失効前に署名された意図も受け付けない。 */
export async function revokeIssuerKey(ctx, keyId, { reason } = {}) {
  assertCan(ctx.actor.role, 'connection.manage');
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!text) throw new IntentError('BAD_REVOKE_REASON', '失効の理由を入力してください。', 400);

  const key = await ctx.repo.read(['actionKeys'], (tx) => tx.get('actionKeys', keyId));
  if (!key) throw new IntentError('UNKNOWN_ISSUER', '登録されていない鍵IDです。', 404);
  if (key.revoked_at) throw new IntentError('KEY_REVOKED', 'この鍵はすでに失効しています。', 409);

  const now = ctx.clock.nowIso();
  await ctx.repo.change(['actionKeys'], async (tx, audit) => {
    await tx.put('actionKeys', { ...key, revoked_at: now, revoked_reason: text });
    await audit({
      actor: ctx.actor.userId,
      target_type: 'actionKey',
      target_id: keyId,
      action: 'action.key.revoke',
      before_hash: keyId,
      reason: `発行者の公開鍵を失効：${key.label}／${text}`,
    });
  });
  return { keyId, revokedAt: now };
}

export async function listIssuerKeys(ctx) {
  const rows = await ctx.repo.read(['actionKeys'], (tx) => tx.getAll('actionKeys'));
  return rows
    .sort((a, b) => Date.parse(a.registered_at) - Date.parse(b.registered_at))
    .map((k) => ({
      keyId: k.key_id,
      label: k.label,
      algorithm: k.algorithm,
      publicKey: k.public_key,
      registeredAt: k.registered_at,
      registeredBy: k.registered_by,
      revokedAt: k.revoked_at,
      revokedReason: k.revoked_reason,
      active: !k.revoked_at,
    }));
}

// ---------------------------------------------------------------------------
// 実行の割り当て
// ---------------------------------------------------------------------------

/**
 * action → services層の呼び出し。
 * params の項目名をここで1度だけ写す。未知のキーは domain/intent.js が先に落とす。
 */
const HANDLERS = Object.freeze({
  'approval.approve': (ctx, e) =>
    approve(ctx, e.target.id, {
      comment: e.params.comment,
      allowedRetryDelayMinutes: e.params.allowedRetryDelayMinutes,
      // 承認の監査イベントを、この意図と同じ correlation_id で束ねる。
      correlationId: e.jti,
    }),
  'approval.reject': (ctx, e) => reject(ctx, e.target.id, { comment: e.params.comment }),
  'schedule.set': (ctx, e) =>
    reschedule(ctx, e.target.id, { scheduledAtIso: e.params.scheduled_at, timeZone: e.params.time_zone }),
  'schedule.cancel': (ctx, e) => cancelSchedule(ctx, e.target.id, { reason: e.params.reason }),
  'production.update': (ctx, e) =>
    updateProduction(ctx, e.target.id, { kind: e.params.kind, steps: e.params.steps, reason: e.params.reason }),
  'execution.manual.claim': (ctx, e) => claimManualExecution(ctx, e.target.id, { reason: e.params.reason }),
  'execution.manual.confirm': (ctx, e) =>
    confirmManualPublish(ctx, e.target.id, {
      externalPostId: e.params.external_post_id,
      publicUrl: e.params.public_url,
      publishedAtIso: e.params.published_at,
      accountMatches: e.params.account_matches,
      contentMatches: e.params.content_matches,
      publishedAtMatches: e.params.published_at_matches,
    }),
  'execution.manual.release': (ctx, e) => releaseManualClaim(ctx, e.target.id, { reason: e.params.reason }),
  'execution.outcome_unknown': (ctx, e) => markOutcomeUnknown(ctx, e.target.id, { reason: e.params.reason }),
  'emergency.stop': (ctx, e) => {
    const { scope, scopeId } = parseScopeTarget(e.target.id);
    return createEmergencyStop(ctx, { scope, scopeId, reason: e.params.reason });
  },
  'emergency.release': (ctx, e) => releaseEmergencyStop(ctx, e.target.id, { reason: e.params.reason }),
});

// 割り当て漏れは起動時に気づけるようにする。
for (const id of Object.keys(INTENT_ACTIONS)) {
  if (!HANDLERS[id]) throw new Error(`Action Gateway に実装の割り当てがありません: ${id}`);
}

/** reason 既定値を services 側に任せるため、undefined のキーは落とす。 */
function compact(options) {
  const out = {};
  for (const [k, v] of Object.entries(options)) if (v !== undefined) out[k] = v;
  return out;
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/**
 * 署名された意図を1件受け取り、検証して実行する。
 *
 * @param {object} ctx
 * @param {object} envelope ActionIntent（署名付き）
 * @returns {Promise<{jti:string, action:string, correlationId:string, replayed:boolean, result:unknown}>}
 */
export async function submitIntent(ctx, envelope) {
  // 1. 形
  assertIntentShape(envelope);
  const spec = intentAction(envelope.action);

  // 2. 発行者
  const key = await ctx.repo.read(['actionKeys'], (tx) => tx.get('actionKeys', envelope.issuer));
  if (!key) {
    throw new IntentError('UNKNOWN_ISSUER', '登録されていない発行者です。接続設定で公開鍵を登録してください。', 401);
  }
  if (key.revoked_at) {
    throw new IntentError('KEY_REVOKED', `この発行者の鍵は ${key.revoked_at} に失効しています。`, 401);
  }

  // 3. 署名。ここを通るまで封筒の中身（時刻を含む）を信用しない。
  const input = signingInput(signingProjection(envelope));
  const bytes = encoder.encode(input);
  let publicKey;
  try {
    publicKey = await importPublicKey(key.public_key);
  } catch (error) {
    throw error instanceof CryptoError
      ? new IntentError('BAD_ISSUER_KEY', `登録済みの公開鍵を読み込めません: ${error.message}`, 500)
      : error;
  }
  if (!(await verifyBytes(publicKey, envelope.signature, bytes))) {
    throw new IntentError('BAD_SIGNATURE', '署名が一致しません。内容が改ざんされたか、鍵が異なります。', 401);
  }
  const digest = await sha256Hex(input);

  // 4. 時間窓
  assertTimeWindow(envelope, ctx.clock.nowMs());

  // 5. jti の原子消費。add() の失敗が二重使用の検出そのもの。
  const now = ctx.clock.nowIso();
  const record = {
    jti: envelope.jti,
    intent_digest: digest,
    issuer: envelope.issuer,
    issuer_label: key.label,
    action: envelope.action,
    target_type: envelope.target.type,
    target_id: envelope.target.id,
    actor_user_id: envelope.actor.user_id,
    actor_role: envelope.actor.role,
    // 監査イベントと突き合わせられるよう、jti をそのまま相関IDにする。
    correlation_id: envelope.jti,
    state: INTENT_STATES.IN_FLIGHT,
    consumed_at: now,
    expires_at: envelope.expires_at,
    completed_at: null,
    result: null,
    error: null,
  };

  try {
    await ctx.repo.change(['actionIntents'], async (tx, audit) => {
      await tx.add('actionIntents', record);
      await audit({
        actor: envelope.actor.user_id,
        target_type: spec.targetType,
        target_id: envelope.target.id,
        action: 'action.intent.consume',
        after_hash: digest,
        reason: `${spec.label}（意図 ${envelope.jti} / 発行者 ${key.label}）`,
        correlation_id: envelope.jti,
      });
    });
  } catch (error) {
    if (error.code === 'CONSTRAINT_VIOLATION') return replayOf(ctx, envelope, digest);
    throw error;
  }

  // 6. 実行。権限は services 側の assertCan() でも再検査される (§17 / G10)。
  // services が出す監査も、この意図と同じ相関ID(jti)で束ねる。
  const actingCtx = {
    ...ctx,
    repo: ctx.repo.withCorrelation(envelope.jti),
    actor: { userId: envelope.actor.user_id, role: envelope.actor.role },
  };
  const call = HANDLERS[envelope.action];
  let result;
  let failure = null;
  try {
    result = await call(actingCtx, { ...envelope, params: compact(envelope.params) });
  } catch (error) {
    failure = { code: error.code ?? 'ERROR', message: error.message, status: error.status ?? 409 };
  }

  // 7. 結果の記録。同じjtiの再送はここに残った結果を返す。
  await recordOutcome(ctx, envelope, spec, { result, failure });

  if (failure) throw Object.assign(new IntentError(failure.code, failure.message, failure.status), { jti: envelope.jti });
  return { jti: envelope.jti, action: envelope.action, correlationId: envelope.jti, replayed: false, result };
}

async function recordOutcome(ctx, envelope, spec, { result, failure }) {
  const now = ctx.clock.nowIso();
  try {
    await ctx.repo.change(['actionIntents'], async (tx, audit) => {
      const live = await tx.get('actionIntents', envelope.jti);
      await tx.put('actionIntents', {
        ...live,
        state: failure ? INTENT_STATES.FAILED : INTENT_STATES.COMPLETED,
        completed_at: now,
        result: failure ? null : (result ?? null),
        error: failure ?? null,
      });
      await audit({
        actor: envelope.actor.user_id,
        target_type: spec.targetType,
        target_id: envelope.target.id,
        action: failure ? 'action.intent.fail' : 'action.intent.complete',
        reason: failure ? `${spec.label}に失敗：${failure.code} ${failure.message}` : `${spec.label}を実行`,
        correlation_id: envelope.jti,
      });
    });
  } catch (error) {
    // 業務操作は確定しているのに結果を残せなかった状態。
    // §15 と同じ方針で、自動再送はせず人へ渡す。再送しても IN_FLIGHT で止まる。
    throw new IntentError(
      'OUTCOME_NOT_RECORDED',
      `操作は実行されましたが結果を記録できませんでした（${error.message}）。SNS側と履歴を確認してください。`,
      500,
    );
  }
}

/** 同じ jti が再送されたとき。 */
async function replayOf(ctx, envelope, digest) {
  const existing = await ctx.repo.read(['actionIntents'], (tx) => tx.get('actionIntents', envelope.jti));
  if (!existing) {
    throw new IntentError('JTI_RACE', '意図の消費記録を読み出せませんでした。時間をおいて確認してください。', 409);
  }
  if (existing.intent_digest !== digest) {
    // 同じ jti で別の内容。取り違えか改ざんなので、状態は一切動かさない (§29)。
    throw new IntentError(
      'JTI_CONFLICT',
      `この意図IDは別の内容ですでに使われています（先の操作: ${existing.action}）。新しい意図を発行してください。`,
      409,
    );
  }
  if (existing.state === INTENT_STATES.IN_FLIGHT) {
    throw new IntentError(
      'INTENT_IN_FLIGHT',
      'この意図は実行済みですが結果が記録されていません。再送せず、履歴とSNS側を確認してください。',
      409,
    );
  }
  if (existing.state === INTENT_STATES.FAILED) {
    throw Object.assign(
      new IntentError(existing.error.code, existing.error.message, existing.error.status ?? 409),
      { replayed: true, jti: envelope.jti },
    );
  }
  return {
    jti: envelope.jti,
    action: existing.action,
    correlationId: existing.correlation_id,
    replayed: true,
    result: existing.result,
  };
}

// ---------------------------------------------------------------------------
// 保守
// ---------------------------------------------------------------------------

/**
 * 期限切れの消費記録を掃除する。
 *
 * 期限を過ぎた意図は 4.時間窓 で必ず落ちるので、記録を消しても再送は通らない。
 * 結果を記録できていない(IN_FLIGHT)ものは、人が確認するまで残す。
 */
export async function pruneConsumedIntents(ctx, { nowMs = ctx.clock.nowMs() } = {}) {
  assertCan(ctx.actor.role, 'connection.manage');
  const rows = await ctx.repo.read(['actionIntents'], (tx) => tx.getAll('actionIntents'));
  const stale = rows.filter(
    (r) => r.state !== INTENT_STATES.IN_FLIGHT && Date.parse(r.expires_at) < nowMs,
  );
  if (!stale.length) return { removed: 0, keptInFlight: rows.filter((r) => r.state === INTENT_STATES.IN_FLIGHT).length };

  await ctx.repo.change(['actionIntents'], async (tx, audit) => {
    for (const row of stale) await tx.delete('actionIntents', row.jti);
    await audit({
      actor: ctx.actor.userId,
      target_type: 'actionIntent',
      target_id: 'actionIntents',
      action: 'action.intent.prune',
      reason: `期限切れの意図 ${stale.length} 件を削除`,
    });
  });
  return { removed: stale.length, keptInFlight: rows.filter((r) => r.state === INTENT_STATES.IN_FLIGHT).length };
}

/** 監査・証拠用の一覧。 */
export async function listConsumedIntents(ctx, { limit = 100 } = {}) {
  const rows = await ctx.repo.read(['actionIntents'], (tx) => tx.getAll('actionIntents'));
  return rows.sort((a, b) => Date.parse(b.consumed_at) - Date.parse(a.consumed_at)).slice(0, limit);
}
