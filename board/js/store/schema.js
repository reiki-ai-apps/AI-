// §12 中核データモデル — オブジェクトストアと一意インデックスの宣言。
//
// この宣言をIndexedDB(ブラウザ)とメモリDB(Nodeテスト)の両方が読む。
// 一意インデックスは §13 の不変条件をDB側で強制するためにある。

export const DB_NAME = 'reiki-post-board';
// v2: §26/§28A Action Gateway の actionKeys / actionIntents を追加。
export const DB_VERSION = 2;

/**
 * unique:true のインデックスは、重複を書こうとした時点で失敗する。
 * アプリ側のif文ではなくストア側で弾くのが目的。
 */
export const STORES = Object.freeze({
  postGroups: {
    keyPath: 'post_group_id',
    indexes: [
      { name: 'brand_id', keyPath: 'brand_id' },
      { name: 'deleted_at', keyPath: 'deleted_at' },
    ],
  },
  channelPosts: {
    keyPath: 'channel_post_id',
    indexes: [
      { name: 'post_group_id', keyPath: 'post_group_id' },
      { name: 'display_state', keyPath: 'display_state' },
      { name: 'social_account_id', keyPath: 'social_account_id' },
      { name: 'calendar_date_key', keyPath: 'calendar_date_key' },
    ],
  },
  postRevisions: {
    keyPath: 'revision_id',
    indexes: [
      { name: 'channel_post_id', keyPath: 'channel_post_id' },
      // 同じ投稿に同じ版番号を2つ作らせない
      { name: 'post_revision_no', keyPath: ['channel_post_id', 'revision_no'], unique: true },
    ],
  },
  mediaAssets: {
    keyPath: 'asset_id',
    indexes: [
      { name: 'sha256', keyPath: 'sha256' },
      { name: 'post_group_id', keyPath: 'post_group_id' },
    ],
  },
  approvals: {
    keyPath: 'approval_id',
    indexes: [
      { name: 'channel_post_id', keyPath: 'channel_post_id' },
      { name: 'revision_id', keyPath: 'revision_id' },
    ],
  },
  schedules: {
    keyPath: 'schedule_id',
    indexes: [
      { name: 'channel_post_id', keyPath: 'channel_post_id' },
      { name: 'scheduled_at', keyPath: 'scheduled_at' },
      // §13「1つのChannelPostに有効な予約は同時に1件だけ」
      // active_key は有効な予約のときだけ channel_post_id を持ち、取消時はキーを外す。
      { name: 'active_schedule', keyPath: 'active_key', unique: true },
    ],
  },
  executionAttempts: {
    keyPath: 'execution_id',
    indexes: [
      { name: 'channel_post_id', keyPath: 'channel_post_id' },
      // §15 冪等キー。同じ実行キーで2件目を作らせない。
      { name: 'idempotency_key', keyPath: 'idempotency_key', unique: true },
      // §13 platform + account + external_post_id は一意
      { name: 'external_key', keyPath: 'external_key', unique: true },
      { name: 'state', keyPath: 'state' },
    ],
  },
  dayPlans: {
    keyPath: 'day_plan_id',
    indexes: [{ name: 'date_key', keyPath: 'date_key', unique: true }],
  },
  socialAccounts: {
    keyPath: 'social_account_id',
    indexes: [{ name: 'platform', keyPath: 'platform' }],
  },
  publicationPackages: {
    keyPath: 'package_id',
    indexes: [
      // §27「(tenant_id, source_skill, idempotency_key)を一意化」
      { name: 'ingest_key', keyPath: ['tenant_id', 'source_skill', 'idempotency_key'], unique: true },
      { name: 'source_skill', keyPath: 'source_skill' },
    ],
  },
  auditEvents: {
    keyPath: 'seq',
    autoIncrement: true,
    indexes: [
      { name: 'occurred_at', keyPath: 'occurred_at' },
      { name: 'target_id', keyPath: 'target_id' },
      { name: 'correlation_id', keyPath: 'correlation_id' },
    ],
  },
  notifications: {
    keyPath: 'notification_id',
    indexes: [
      // §18「同一事象の重複通知を防ぐ」
      { name: 'dedupe_key', keyPath: 'dedupe_key', unique: true },
      { name: 'severity', keyPath: 'severity' },
    ],
  },
  emergencyStops: {
    keyPath: 'stop_id',
    indexes: [{ name: 'active_scope', keyPath: 'active_scope', unique: true }],
  },
  // §28A ActionIntent の発行者公開鍵。key_id = SHA-256(公開鍵の生バイト) なので
  // 同じ公開鍵は主キーで一意になる。秘密鍵はここにも他のどこにも保存しない (§19 / G11)。
  actionKeys: {
    keyPath: 'key_id',
    indexes: [
      { name: 'label', keyPath: 'label' },
      { name: 'revoked_at', keyPath: 'revoked_at' },
    ],
  },
  // §28A jti の原子消費。主キーが jti なので、2回目の add() はDB側で失敗する。
  // 「if文で先に読んでから書く」形にしないのが要点 (§13 と同じ考え方)。
  actionIntents: {
    keyPath: 'jti',
    indexes: [
      { name: 'action', keyPath: 'action' },
      { name: 'state', keyPath: 'state' },
      { name: 'expires_at', keyPath: 'expires_at' },
      { name: 'correlation_id', keyPath: 'correlation_id' },
      { name: 'target_id', keyPath: 'target_id' },
    ],
  },
  settings: {
    keyPath: 'key',
    indexes: [],
  },
});

export const STORE_NAMES = Object.freeze(Object.keys(STORES));

/** 一意インデックスの一覧 (memdbが同じ制約を再現するために使う)。 */
export function uniqueIndexesOf(storeName) {
  return (STORES[storeName]?.indexes ?? []).filter((i) => i.unique === true);
}

/** レコードからインデックス値を取り出す。複合キーは配列。 */
export function indexValueOf(record, keyPath) {
  if (Array.isArray(keyPath)) {
    const parts = keyPath.map((k) => record[k]);
    // IndexedDBは構成要素にundefined/nullがあるとインデックスへ載せない。同じ挙動にする。
    return parts.some((p) => p === undefined || p === null) ? undefined : parts;
  }
  const value = record[keyPath];
  return value === undefined || value === null ? undefined : value;
}
