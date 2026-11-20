// §17 権限と責任分離
//
// 「見えない・押せない」だけでは足りない。UIの有無に関係なく、
// すべての操作をこのモジュールで再検査して403で拒否する (G10)。
// services層は必ず assertCan() を通してから状態を変える。

export const ROLES = Object.freeze({
  ADMIN: Object.freeze({ id: 'ADMIN', label: '管理者', scope: '全件' }),
  APPROVER: Object.freeze({ id: 'APPROVER', label: '承認者', scope: '許可範囲' }),
  OPERATOR: Object.freeze({ id: 'OPERATOR', label: '運用担当', scope: '担当範囲' }),
  VIEWER: Object.freeze({ id: 'VIEWER', label: '閲覧者', scope: '許可範囲' }),
});

export const ROLE_ORDER = Object.freeze(['ADMIN', 'APPROVER', 'OPERATOR', 'VIEWER']);

/** §17 の表そのもの。ALLOW / DENY / MINOR(軽微な編集のみ) / REQUEST(申請のみ)。 */
const MATRIX = Object.freeze({
  ADMIN: Object.freeze({
    view: 'ALLOW', edit: 'ALLOW', approve: 'ALLOW', execute: 'ALLOW', connect: 'ALLOW', stop: 'ALLOW',
  }),
  APPROVER: Object.freeze({
    view: 'ALLOW', edit: 'MINOR', approve: 'ALLOW', execute: 'ALLOW', connect: 'DENY', stop: 'ALLOW',
  }),
  OPERATOR: Object.freeze({
    view: 'ALLOW', edit: 'ALLOW', approve: 'DENY', execute: 'REQUEST', connect: 'DENY', stop: 'DENY',
  }),
  VIEWER: Object.freeze({
    view: 'ALLOW', edit: 'DENY', approve: 'DENY', execute: 'DENY', connect: 'DENY', stop: 'DENY',
  }),
});

/**
 * 操作 → 必要な権限カテゴリ。
 * `minor:true` の操作は承認根拠に影響しないので、承認者の「軽微」編集で通す。
 */
const OPERATIONS = Object.freeze({
  'post.view':          { category: 'view' },
  'post.create':        { category: 'edit' },
  'post.edit':          { category: 'edit' },
  'post.edit.internal': { category: 'edit', minor: true },
  'post.delete':        { category: 'edit' },
  'post.restore':       { category: 'connect' }, // 復元は管理者のみ (§16 論理削除)
  'package.import':     { category: 'edit' },
  'approval.submit':    { category: 'edit' },
  'approval.approve':   { category: 'approve' },
  'approval.reject':    { category: 'approve' },
  'schedule.set':       { category: 'edit' },
  'schedule.cancel':    { category: 'edit' },
  'execution.run':      { category: 'execute' },
  'execution.manual':   { category: 'execute' },
  'execution.retry':    { category: 'execute' },
  'connection.manage':  { category: 'connect' },
  'emergency.stop':     { category: 'stop' },
  'audit.view':         { category: 'view' },
});

export class PermissionError extends Error {
  constructor(role, operation, message) {
    super(message);
    this.name = 'PermissionError';
    this.code = 'FORBIDDEN';
    this.status = 403;
    this.role = role;
    this.operation = operation;
  }
}

export function isRole(id) {
  return Object.hasOwn(ROLES, id);
}

export function roleLabel(id) {
  const r = ROLES[id];
  if (!r) throw new RangeError(`未知の役割です: ${id}`);
  return r.label;
}

export function operationIds() {
  return Object.keys(OPERATIONS);
}

/**
 * 操作の可否を判定する。
 * @returns {{allowed:boolean, requestOnly:boolean, reason:string, message:string}}
 */
export function can(role, operation) {
  if (!isRole(role)) throw new RangeError(`未知の役割です: ${role}`);
  const op = OPERATIONS[operation];
  if (!op) throw new RangeError(`未知の操作です: ${operation}`);

  const verdict = MATRIX[role][op.category];

  if (verdict === 'ALLOW') {
    return { allowed: true, requestOnly: false, reason: 'ALLOW', message: '' };
  }
  if (verdict === 'MINOR') {
    // 承認者の編集は「軽微」まで。承認根拠に触れる編集は通さない。
    return op.minor
      ? { allowed: true, requestOnly: false, reason: 'MINOR', message: '' }
      : {
          allowed: false,
          requestOnly: false,
          reason: 'MINOR_ONLY',
          message: `${roleLabel(role)}が編集できるのは、承認根拠に影響しない項目だけです。`,
        };
  }
  if (verdict === 'REQUEST') {
    return {
      allowed: false,
      requestOnly: true,
      reason: 'REQUEST_ONLY',
      message: `${roleLabel(role)}はこの操作を申請できます。実行には承認者または管理者が必要です。`,
    };
  }
  return {
    allowed: false,
    requestOnly: false,
    reason: 'DENY',
    message: `${roleLabel(role)}にはこの操作の権限がありません。管理者へ申請してください。`,
  };
}

/** 権限がなければ必ず投げる。services層の入口で呼ぶ。 */
export function assertCan(role, operation) {
  const verdict = can(role, operation);
  if (!verdict.allowed) {
    throw new PermissionError(role, operation, verdict.message);
  }
  return verdict;
}

/**
 * §17 責任ルール。
 * 単独運用では同一人物の承認を許すが、承認操作と対象版を必ず記録する。
 * チーム運用では作成者本人の承認を拒否する。
 */
export function checkSelfApproval({ mode, authorUserId, approverUserId }) {
  const isSelf = Boolean(authorUserId) && authorUserId === approverUserId;
  if (!isSelf) return { allowed: true, selfApproval: false, note: null };
  if (mode === 'TEAM') {
    return {
      allowed: false,
      selfApproval: true,
      note: 'チーム運用では作成者本人が承認できません。別の承認者を指定してください。',
    };
  }
  return {
    allowed: true,
    selfApproval: true,
    note: '単独運用のため作成者本人が承認しました。承認者と対象版を記録します。',
  };
}

/**
 * §17「異なるPost Groupをまとめて承認しない。同一企画の4SNSだけを一括対象にできる。」
 * @param {Array<{post_group_id:string}>} channelPosts
 */
export function checkBulkApprovalScope(channelPosts) {
  const groups = new Set(channelPosts.map((p) => p.post_group_id));
  if (groups.size > 1) {
    return {
      allowed: false,
      message: '異なる企画をまとめて承認できません。同じ企画のSNSだけを一括で承認してください。',
    };
  }
  return { allowed: true, message: '' };
}
