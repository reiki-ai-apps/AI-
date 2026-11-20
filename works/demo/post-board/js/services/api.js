// 画面から services層を呼ぶための窓口。
//
// 本物は保存先（PCのサーバー／GitHub）で経路が変わるが、デモ版は常に
// この場で services を直接動かし、保存はこのブラウザの中だけで行う（通信しない）。
// 関数名・引数・戻り値は本物と同じ。画面のコードは経路を意識しない。

import * as posts from './posts.js';
import * as approvals from './approvals.js';
import * as schedule from './schedule.js';
import * as manual from './manual.js';
import * as emergency from './emergency.js';
import * as dayplans from './dayplans.js';
import * as production from './production.js';
import * as gateway from './gateway.js';
import * as ingest from './ingest.js';
import * as seed from '../store/seed.js';

/** 直接呼ぶ実体。 */
const DIRECT = {
  createPostGroup: posts.createPostGroup,
  reviseChannelPost: posts.reviseChannelPost,
  updateInternal: posts.updateInternal,
  submitForApproval: approvals.submitForApproval,
  approve: approvals.approve,
  reject: approvals.reject,
  approveGroup: approvals.approveGroup,
  describePendingChange: approvals.describePendingChange,
  verifyApprovalStillValid: approvals.verifyApprovalStillValid,
  verifyComponentApprovals: approvals.verifyComponentApprovals,
  recordComponentApproval: approvals.recordComponentApproval,
  reschedule: schedule.reschedule,
  cancelSchedule: schedule.cancelSchedule,
  claimManualExecution: manual.claimManualExecution,
  getApprovedContent: manual.getApprovedContent,
  confirmManualPublish: manual.confirmManualPublish,
  releaseManualClaim: manual.releaseManualClaim,
  markOutcomeUnknown: manual.markOutcomeUnknown,
  createEmergencyStop: emergency.createEmergencyStop,
  releaseEmergencyStop: emergency.releaseEmergencyStop,
  softDeletePost: emergency.softDeletePost,
  restorePost: emergency.restorePost,
  pauseDay: dayplans.pauseDay,
  releaseDay: dayplans.releaseDay,
  updateProduction: production.updateProduction,
  describeProduction: production.describeProduction,
  registerIssuerKey: gateway.registerIssuerKey,
  revokeIssuerKey: gateway.revokeIssuerKey,
  listIssuerKeys: gateway.listIssuerKeys,
  listConsumedIntents: gateway.listConsumedIntents,
  pruneConsumedIntents: gateway.pruneConsumedIntents,
  submitIntent: gateway.submitIntent,
  loadSampleMonth: seed.loadSampleMonth,
  seedSocialAccounts: seed.seedSocialAccounts,
  ingestPackage: ingest.ingestPackage,
};

const call = (ctx, fn, ...args) => DIRECT[fn](ctx, ...args);

// 登録・編集 (§10)
export const createPostGroup = (ctx, input) => call(ctx, 'createPostGroup', input);
export const reviseChannelPost = (ctx, id, changes, options) => call(ctx, 'reviseChannelPost', id, changes, options);
export const updateInternal = (ctx, id, internal, options) => call(ctx, 'updateInternal', id, internal, options);

// 承認 (§14)
export const submitForApproval = (ctx, id, options) => call(ctx, 'submitForApproval', id, options);
export const approve = (ctx, id, options) => call(ctx, 'approve', id, options);
export const reject = (ctx, id, options) => call(ctx, 'reject', id, options);
export const approveGroup = (ctx, ids, options) => call(ctx, 'approveGroup', ids, options);
export const describePendingChange = (ctx, id) => call(ctx, 'describePendingChange', id);
export const verifyApprovalStillValid = (ctx, id) => call(ctx, 'verifyApprovalStillValid', id);
export const verifyComponentApprovals = (ctx, id, options) => call(ctx, 'verifyComponentApprovals', id, options);
export const recordComponentApproval = (ctx, id, componentScope, options) =>
  call(ctx, 'recordComponentApproval', id, componentScope, options);

// 予約 (§15/§16)
export const reschedule = (ctx, id, options) => call(ctx, 'reschedule', id, options);
export const cancelSchedule = (ctx, id, options) => call(ctx, 'cancelSchedule', id, options);

// 手動投稿 (§16)
export const claimManualExecution = (ctx, id, options) => call(ctx, 'claimManualExecution', id, options);
export const getApprovedContent = (ctx, id) => call(ctx, 'getApprovedContent', id);
export const confirmManualPublish = (ctx, id, input) => call(ctx, 'confirmManualPublish', id, input);
export const releaseManualClaim = (ctx, id, options) => call(ctx, 'releaseManualClaim', id, options);
export const markOutcomeUnknown = (ctx, id, options) => call(ctx, 'markOutcomeUnknown', id, options);

// 緊急停止・削除・復元 (§16)
export const createEmergencyStop = (ctx, input) => call(ctx, 'createEmergencyStop', input);
export const releaseEmergencyStop = (ctx, id, options) => call(ctx, 'releaseEmergencyStop', id, options);
export const softDeletePost = (ctx, id, options) => call(ctx, 'softDeletePost', id, options);
export const restorePost = (ctx, id, options) => call(ctx, 'restorePost', id, options);

// 休止 (§06/§07)
export const pauseDay = (ctx, dateKey, options) => call(ctx, 'pauseDay', dateKey, options);
export const releaseDay = (ctx, dateKey, options) => call(ctx, 'releaseDay', dateKey, options);

// 制作の進み具合 (§10 内部情報)
export const updateProduction = (ctx, id, input) => call(ctx, 'updateProduction', id, input);
export const describeProduction = (ctx, id) => call(ctx, 'describeProduction', id);

// Action Gateway (§26/§28A)
export const registerIssuerKey = (ctx, input) => call(ctx, 'registerIssuerKey', input);
export const revokeIssuerKey = (ctx, keyId, options) => call(ctx, 'revokeIssuerKey', keyId, options);
export const listIssuerKeys = (ctx) => call(ctx, 'listIssuerKeys');
export const listConsumedIntents = (ctx, options) => call(ctx, 'listConsumedIntents', options);
export const pruneConsumedIntents = (ctx, options) => call(ctx, 'pruneConsumedIntents', options);
export const submitIntent = (ctx, envelope) => call(ctx, 'submitIntent', envelope);

// サンプル・初期化
export const loadSampleMonth = (ctx) => call(ctx, 'loadSampleMonth');
export const seedSocialAccounts = (ctx) => call(ctx, 'seedSocialAccounts');

/** Package取込 (§25)。素材はバイト列のまま渡す。 */
export async function ingestPackage(ctx, pkg, assetBytes = new Map()) {
  return ingest.ingestPackage(ctx, pkg, assetBytes);
}
