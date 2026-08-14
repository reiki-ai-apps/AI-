// §11 状態モデル — 利用者へ見せる状態と、実行基盤の内部状態を分離する。
//
// 遷移は許可リスト方式。表に無い遷移は例外にする。
// 取消・論理削除・意図的休止はこの進行状態へ混ぜず、別フィールド / DayPlan で管理する。

/** 表示状態 (§11 の表そのもの)。 */
export const DISPLAY_STATES = Object.freeze({
  DRAFT: Object.freeze({
    id: 'DRAFT',
    label: '下書き',
    meaning: '内容・素材を準備中',
    nextOp: '編集',
    tone: 'neutral',
  }),
  QUALITY_REVIEW: Object.freeze({
    id: 'QUALITY_REVIEW',
    label: '品質確認中',
    meaning: '出典・権利・表現を確認中',
    nextOp: '確認結果を見る',
    tone: 'neutral',
  }),
  PENDING_APPROVAL: Object.freeze({
    id: 'PENDING_APPROVAL',
    label: '承認待ち',
    meaning: '公開判断を待つ',
    nextOp: '承認／差し戻し',
    tone: 'attention',
  }),
  SCHEDULED: Object.freeze({
    id: 'SCHEDULED',
    label: '予約済み',
    meaning: '公開日時が確定',
    nextOp: '時刻変更／取消',
    tone: 'scheduled',
  }),
  PUBLISHING: Object.freeze({
    id: 'PUBLISHING',
    label: '投稿中',
    meaning: 'SNSへ送信・確認中',
    nextOp: '進行を見る',
    tone: 'progress',
  }),
  PUBLISHED: Object.freeze({
    id: 'PUBLISHED',
    label: '投稿済み',
    meaning: '外部IDまたは公開URLを確認済み',
    nextOp: '投稿を見る',
    tone: 'published',
  }),
  ACTION_REQUIRED: Object.freeze({
    id: 'ACTION_REQUIRED',
    label: '要対応',
    meaning: '失敗・接続切れ・素材不足・結果不明',
    nextOp: '原因別の推奨操作',
    tone: 'danger',
  }),
});

export const DISPLAY_STATE_ORDER = Object.freeze([
  'DRAFT',
  'QUALITY_REVIEW',
  'PENDING_APPROVAL',
  'SCHEDULED',
  'PUBLISHING',
  'PUBLISHED',
  'ACTION_REQUIRED',
]);

/** 許可された表示状態の遷移。 */
const DISPLAY_TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(['QUALITY_REVIEW', 'PENDING_APPROVAL']),
  QUALITY_REVIEW: Object.freeze(['DRAFT', 'PENDING_APPROVAL']),
  // 承認は「版・日時・投稿先」を固定するので、承認成立と同時に予約済みへ進む (§10)。
  PENDING_APPROVAL: Object.freeze(['DRAFT', 'SCHEDULED', 'ACTION_REQUIRED']),
  // 承認が無効化されたら予約済みから承認待ちへ戻す (§14)。
  SCHEDULED: Object.freeze(['PENDING_APPROVAL', 'PUBLISHING', 'ACTION_REQUIRED']),
  PUBLISHING: Object.freeze(['PUBLISHED', 'ACTION_REQUIRED']),
  // 投稿済みは終端。巻き戻さない (§29「状態を巻き戻さず409＋現在状態を返す」)。
  PUBLISHED: Object.freeze([]),
  ACTION_REQUIRED: Object.freeze(['DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED']),
});

export function isDisplayState(id) {
  return Object.hasOwn(DISPLAY_STATES, id);
}

export function displayState(id) {
  const s = DISPLAY_STATES[id];
  if (!s) throw new RangeError(`未知の表示状態です: ${id}`);
  return s;
}

export function displayLabel(id) {
  return displayState(id).label;
}

export function allowedTransitions(from) {
  displayState(from);
  return DISPLAY_TRANSITIONS[from];
}

export function canTransition(from, to) {
  if (!isDisplayState(from) || !isDisplayState(to)) return false;
  return DISPLAY_TRANSITIONS[from].includes(to);
}

/** 許可されていない遷移は必ず失敗させる。画面制御だけに頼らない (§14 二重検査)。 */
export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new StateTransitionError(from, to);
  }
}

/** 表示状態・実行状態のどちらでも日本語名を返す (エラーメッセージ用)。 */
function anyLabel(id) {
  return DISPLAY_STATES[id]?.label ?? EXECUTION_STATES[id]?.label ?? String(id);
}

export class StateTransitionError extends Error {
  constructor(from, to) {
    super(`状態遷移が許可されていません: ${anyLabel(from)} → ${anyLabel(to)}`);
    this.name = 'StateTransitionError';
    this.code = 'STATE_CONFLICT';
    this.from = from;
    this.to = to;
  }
}

// ---------------------------------------------------------------------------
// 内部実行状態 (§11 / §28B)。今フェーズでは手動Fallbackの経路だけが実際に動く。
// 自動WorkerのLEASED / SENT とCAS制御は次フェーズで実装する。
// ---------------------------------------------------------------------------

export const EXECUTION_STATES = Object.freeze({
  PENDING: { id: 'PENDING', label: '実行待ち' },
  LEASED: { id: 'LEASED', label: '実行取得済み' },
  MANUAL_LEASED: { id: 'MANUAL_LEASED', label: '手動投稿中' },
  SENT: { id: 'SENT', label: '送信済み' },
  CONFIRMED: { id: 'CONFIRMED', label: '確認済み' },
  RETRYABLE_FAILURE: { id: 'RETRYABLE_FAILURE', label: '再試行可能な失敗' },
  FINAL_FAILURE: { id: 'FINAL_FAILURE', label: '確定失敗' },
  UNKNOWN_OUTCOME: { id: 'UNKNOWN_OUTCOME', label: '結果不明' },
  RECONCILING: { id: 'RECONCILING', label: '照合中' },
});

const EXECUTION_TRANSITIONS = Object.freeze({
  PENDING: Object.freeze(['LEASED', 'MANUAL_LEASED']),
  LEASED: Object.freeze(['SENT', 'RETRYABLE_FAILURE', 'FINAL_FAILURE', 'UNKNOWN_OUTCOME']),
  MANUAL_LEASED: Object.freeze(['CONFIRMED', 'FINAL_FAILURE', 'UNKNOWN_OUTCOME', 'PENDING']),
  SENT: Object.freeze(['CONFIRMED', 'RETRYABLE_FAILURE', 'FINAL_FAILURE', 'UNKNOWN_OUTCOME']),
  // 結果不明からは照合を経由する。ここから直接 PENDING へ戻す経路は作らない (§15「無条件再送しない」)。
  UNKNOWN_OUTCOME: Object.freeze(['RECONCILING']),
  RECONCILING: Object.freeze(['CONFIRMED', 'PENDING', 'FINAL_FAILURE']),
  RETRYABLE_FAILURE: Object.freeze(['PENDING', 'FINAL_FAILURE']),
  CONFIRMED: Object.freeze([]),
  FINAL_FAILURE: Object.freeze([]),
});

export function canExecutionTransition(from, to) {
  return Object.hasOwn(EXECUTION_TRANSITIONS, from) && EXECUTION_TRANSITIONS[from].includes(to);
}

export function assertExecutionTransition(from, to) {
  if (!canExecutionTransition(from, to)) {
    throw new StateTransitionError(from, to);
  }
}

export function executionLabel(id) {
  const s = EXECUTION_STATES[id];
  if (!s) throw new RangeError(`未知の実行状態です: ${id}`);
  return s.label;
}

/** 終端状態か。終端からは進行状態を書き換えない。 */
export function isTerminalExecution(id) {
  const next = EXECUTION_TRANSITIONS[id];
  if (!next) throw new RangeError(`未知の実行状態です: ${id}`);
  return next.length === 0;
}

/**
 * 実行状態 → 表示状態。画面には内部状態を出さない (§11「分離する」)。
 */
export function displayStateForExecution(executionState) {
  switch (executionState) {
    case 'PENDING':
      return 'SCHEDULED';
    case 'LEASED':
    case 'MANUAL_LEASED':
    case 'SENT':
      return 'PUBLISHING';
    case 'CONFIRMED':
      return 'PUBLISHED';
    case 'RETRYABLE_FAILURE':
    case 'FINAL_FAILURE':
    case 'UNKNOWN_OUTCOME':
    case 'RECONCILING':
      return 'ACTION_REQUIRED';
    default:
      throw new RangeError(`未知の実行状態です: ${executionState}`);
  }
}

// ---------------------------------------------------------------------------
// 要対応の原因分類 (§09「失敗分類と推奨操作を一件提示」/ §15 失敗分類と再試行)
// ---------------------------------------------------------------------------

export const FAILURE_KINDS = Object.freeze({
  RATE_LIMIT: {
    id: 'RATE_LIMIT',
    label: '一時的な制限',
    cause: 'SNS側の送信制限に達しました',
    recommend: '許容遅延内で自動再試行します',
    autoRetry: true,
  },
  TEMPORARY: {
    id: 'TEMPORARY',
    label: '一時障害',
    cause: 'SNS側が一時的に応答しませんでした',
    recommend: '許容遅延内で自動再試行します',
    autoRetry: true,
  },
  CREDENTIAL_EXPIRED: {
    id: 'CREDENTIAL_EXPIRED',
    label: '認証切れ',
    cause: 'SNSアカウントの認証が切れています',
    recommend: '接続設定から再接続してください',
    autoRetry: false,
  },
  PERMISSION_DENIED: {
    id: 'PERMISSION_DENIED',
    label: '権限不足',
    cause: 'この操作に必要な権限がありません',
    recommend: '管理者へ権限を申請してください',
    autoRetry: false,
  },
  CONTENT_REJECTED: {
    id: 'CONTENT_REJECTED',
    label: '内容不備',
    cause: 'SNS側が内容・素材を受け付けませんでした',
    recommend: '内容を修正して再承認してください',
    autoRetry: false,
  },
  ASSET_MISSING: {
    id: 'ASSET_MISSING',
    label: '素材不足',
    cause: '必要な素材または権利確認がそろっていません',
    recommend: '素材と権利確認を追加してください',
    autoRetry: false,
  },
  UNKNOWN_OUTCOME: {
    id: 'UNKNOWN_OUTCOME',
    label: '結果不明',
    cause: '送信しましたが結果を確認できていません',
    recommend: '再送せず照合中です。SNS側の投稿有無を確認してください',
    autoRetry: false,
  },
});

export function failureKind(id) {
  const k = FAILURE_KINDS[id];
  if (!k) throw new RangeError(`未知の失敗分類です: ${id}`);
  return k;
}

/** 自動再試行してよい分類か。結果不明は必ず false (§15)。 */
export function isAutoRetryable(id) {
  return failureKind(id).autoRetry === true;
}
