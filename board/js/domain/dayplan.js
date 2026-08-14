// §07 空白日の選択 / §06「件数ゼロ」と「意図的休止」は別データ (G06)。
//
// 「投稿がない」は単に予定が0件であること。
// 「休止」は人が意図して決めたことなので、理由・設定者・日時を必ず持つ。
// 両者を同じ表示にしない。色だけで区別しない。

export const DAY_PLAN_KINDS = Object.freeze({
  /** 明示的な投稿予定日。予定が入っている日は自動的にこちら。 */
  ACTIVE: 'ACTIVE',
  /** 人が意図して休むと決めた日。 */
  PAUSED: 'PAUSED',
});

export class DayPlanError extends Error {
  constructor(message, code = 'VALIDATION_FAILED') {
    super(message);
    this.name = 'DayPlanError';
    this.code = code;
  }
}

/**
 * 意図的休止を作る。理由・設定者・日時が欠けたものは作らせない (§07)。
 *
 * @param {object} input
 * @param {string} input.dateKey "YYYY-MM-DD"
 * @param {string} input.reason 休む理由
 * @param {string} input.setBy 設定者
 * @param {string} input.setAtIso 設定日時
 * @param {string|null} [input.brandId] 系統を限定する場合
 */
export function createPause({ dateKey, reason, setBy, setAtIso, brandId = null }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey ?? '')) {
    throw new DayPlanError('休止する日付が不正です。');
  }
  if (!reason || !String(reason).trim()) {
    throw new DayPlanError('休止の理由を入力してください。理由のない休止は記録しません。');
  }
  if (!setBy || !String(setBy).trim()) {
    throw new DayPlanError('休止を設定した人を記録できません。');
  }
  if (!setAtIso || !Number.isFinite(Date.parse(setAtIso))) {
    throw new DayPlanError('休止の設定日時が不正です。');
  }
  return {
    dateKey,
    brandId,
    kind: DAY_PLAN_KINDS.PAUSED,
    paused: true,
    reason: String(reason).trim(),
    setBy: String(setBy).trim(),
    setAtIso,
  };
}

/** 休止を解除する。記録は消さず、解除の事実を残す。 */
export function releasePause(plan, { by, atIso }) {
  if (!plan?.paused) throw new DayPlanError('休止していない日です。', 'STATE_CONFLICT');
  return {
    ...plan,
    kind: DAY_PLAN_KINDS.ACTIVE,
    paused: false,
    releasedBy: by,
    releasedAtIso: atIso,
  };
}

/** 「予定なし」か「休止」か。件数0のときにどちらを出すかを決める唯一の判定。 */
export function emptyDayKind(plan) {
  return plan?.paused === true ? 'PAUSED' : 'EMPTY';
}

/** 休止の説明文。理由・設定者・日時をすべて出す (G06)。 */
export function describePause(plan, formatStamp) {
  if (!plan?.paused) return null;
  const when = formatStamp ? formatStamp(Date.parse(plan.setAtIso)) : plan.setAtIso;
  return `休止：${plan.reason}（設定者 ${plan.setBy}／${when}）`;
}
