// リポジトリ層 — ストアへの入口をここに集約する。
//
// §13「監査記録に失敗した重要操作は、業務操作自体も失敗させる」を守るため、
// 重要操作は change() 経由でしか実行できない。change() は監査書込みを
// 同一トランザクションに含め、監査を1件も書かなかった場合も失敗させる。
//
// 注意: change() のコールバック内で WebCrypto を await しないこと (idb.js の注記参照)。
// ハッシュは呼び出し側がトランザクションの外で計算し、完成した監査イベントを渡す。

import { STORE_NAMES } from './schema.js';
import { InvariantError } from '../domain/invariants.js';
import { uuid } from '../core/ids.js';

/** §31 監査イベントの最小項目。 */
function normalizeAudit(event, clock, fallbackCorrelationId) {
  const required = ['actor', 'target_id', 'action'];
  for (const key of required) {
    if (!event?.[key]) {
      throw new InvariantError('AUDIT_INCOMPLETE', `監査記録の項目が足りません: ${key}`);
    }
  }
  return {
    audit_id: event.audit_id ?? uuid(),
    actor: event.actor,
    target_type: event.target_type ?? 'channelPost',
    target_id: event.target_id,
    action: event.action,
    occurred_at: event.occurred_at ?? clock.nowIso(),
    before_hash: event.before_hash ?? null,
    after_hash: event.after_hash ?? null,
    reason: event.reason ?? null,
    correlation_id: event.correlation_id ?? fallbackCorrelationId ?? uuid(),
    revision_id: event.revision_id ?? null,
    execution_id: event.execution_id ?? null,
  };
}

export class Repo {
  /**
   * @param {{read:Function, write:Function, backend:string}} db
   * @param {{nowIso():string, nowMs():number, timeZone:string}} clock
   */
  constructor(db, clock) {
    this.db = db;
    this.clock = clock;
    /**
     * この Repo を通した監査の既定の相関ID。
     * Action Gateway が1つの意図から出る監査を jti で束ねるために使う (§28A/§31)。
     * イベントが自分で correlation_id を持っていればそちらが優先される。
     */
    this.correlationId = null;
  }

  /** 同じDB・同じ時計で、監査の相関IDだけを固定した Repo を返す。 */
  withCorrelation(correlationId) {
    const scoped = new Repo(this.db, this.clock);
    scoped.correlationId = correlationId;
    return scoped;
  }

  /** 読み取り専用。 */
  read(storeNames, fn) {
    return this.db.read(storeNames, fn);
  }

  /**
   * 監査必須の変更。fn は (tx, audit) を受け取る。
   * audit() を1度も呼ばないとトランザクションごと失敗する。
   */
  async change(storeNames, fn) {
    const names = Array.from(new Set([...storeNames, 'auditEvents']));
    return this.db.write(names, async (tx) => {
      let written = 0;
      const audit = async (event) => {
        await tx.put('auditEvents', normalizeAudit(event, this.clock, this.correlationId));
        written += 1;
      };
      const result = await fn(tx, audit);
      if (written === 0) {
        throw new InvariantError('AUDIT_MISSING', '監査記録のない重要操作は実行できません。');
      }
      return result;
    });
  }

  /** 監査を伴わない軽い書き込み (通知の既読、表示設定など)。 */
  write(storeNames, fn) {
    return this.db.write(storeNames, fn);
  }

  async clearAll() {
    await this.db.clearAll();
  }

  // -------------------------------------------------------------------------
  // 読み取り: カレンダー / 選択日 / 承認待ち / 履歴
  // -------------------------------------------------------------------------

  /**
   * カレンダーRead Model用の投稿一覧。
   * 論理削除・取消済みは月セルの件数に含めない (§11「進行状態へ混ぜない」)。
   */
  async listPostsForMonth(year, month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    const rows = await this.db.read(['channelPosts'], (tx) => tx.getAll('channelPosts'));
    return rows.filter(
      (p) => !p.deleted_at && !p.cancelled_at && String(p.calendar_date_key ?? '').startsWith(prefix),
    );
  }

  /** 週表示用。startKey〜endKey（両端を含む）の投稿。 */
  async listPostsBetween(startKey, endKey) {
    const rows = await this.db.read(['channelPosts'], (tx) => tx.getAll('channelPosts'));
    return rows
      .filter((p) => !p.deleted_at && !p.cancelled_at)
      .filter((p) => {
        const k = p.calendar_date_key;
        return typeof k === 'string' && k >= startKey && k <= endKey;
      })
      .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
  }

  async listPostsForDay(dateKey) {
    const rows = await this.db.read(['channelPosts'], (tx) => tx.getAll('channelPosts'));
    return rows
      .filter((p) => !p.deleted_at && !p.cancelled_at && p.calendar_date_key === dateKey)
      .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
  }

  async listUpcomingPosts(fromMs, limit = 20) {
    const rows = await this.db.read(['channelPosts'], (tx) => tx.getAll('channelPosts'));
    return rows
      .filter((p) => !p.deleted_at && !p.cancelled_at && Date.parse(p.scheduled_at) > fromMs)
      .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at))
      .slice(0, limit);
  }

  async listPendingApprovals() {
    const rows = await this.db.read(['channelPosts'], (tx) => tx.getAll('channelPosts'));
    return rows
      .filter((p) => !p.deleted_at && p.display_state === 'PENDING_APPROVAL')
      .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
  }

  async listHistory({ includeDeleted = false } = {}) {
    const rows = await this.db.read(['channelPosts'], (tx) => tx.getAll('channelPosts'));
    return rows
      .filter((p) => includeDeleted || !p.deleted_at)
      .filter((p) => ['PUBLISHED', 'ACTION_REQUIRED', 'PUBLISHING'].includes(p.display_state) || p.cancelled_at || p.deleted_at)
      .sort((a, b) => Date.parse(b.updated_at ?? b.scheduled_at) - Date.parse(a.updated_at ?? a.scheduled_at));
  }

  async listDayPlans() {
    return this.db.read(['dayPlans'], (tx) => tx.getAll('dayPlans'));
  }

  async getDayPlan(dateKey) {
    return this.db.read(['dayPlans'], (tx) => tx.getBy('dayPlans', 'date_key', dateKey));
  }

  async getPost(channelPostId) {
    return this.db.read(['channelPosts'], (tx) => tx.get('channelPosts', channelPostId));
  }

  async getRevision(revisionId) {
    return this.db.read(['postRevisions'], (tx) => tx.get('postRevisions', revisionId));
  }

  async listRevisions(channelPostId) {
    const rows = await this.db.read(['postRevisions'], (tx) =>
      tx.getAllBy('postRevisions', 'channel_post_id', channelPostId),
    );
    return rows.sort((a, b) => a.revision_no - b.revision_no);
  }

  async getApproval(approvalId) {
    if (!approvalId) return undefined;
    return this.db.read(['approvals'], (tx) => tx.get('approvals', approvalId));
  }

  async listApprovalsFor(channelPostId) {
    const rows = await this.db.read(['approvals'], (tx) =>
      tx.getAllBy('approvals', 'channel_post_id', channelPostId),
    );
    return rows.sort((a, b) => Date.parse(b.decided_at) - Date.parse(a.decided_at));
  }

  async getPostGroup(postGroupId) {
    return this.db.read(['postGroups'], (tx) => tx.get('postGroups', postGroupId));
  }

  async listChannelPostsOfGroup(postGroupId) {
    return this.db.read(['channelPosts'], (tx) => tx.getAllBy('channelPosts', 'post_group_id', postGroupId));
  }

  /** 全事業の制作中・確認待ち・予約済みを日付横断で集計するための一覧。 */
  async listPipelinePosts() {
    const rows = await this.db.read(['channelPosts'], (tx) => tx.getAll('channelPosts'));
    return rows
      .filter((p) => !p.deleted_at && !p.cancelled_at && p.display_state !== 'PUBLISHED')
      .sort((a, b) => String(a.calendar_date_key ?? '').localeCompare(String(b.calendar_date_key ?? '')));
  }

  /** 状況画面の日別達成数には、制作中だけでなく公開済みも含める。 */
  async listPostsForReservationPlan() {
    const rows = await this.db.read(['channelPosts'], (tx) => tx.getAll('channelPosts'));
    return rows
      .filter((p) => !p.deleted_at && !p.cancelled_at)
      .sort((a, b) => String(a.calendar_date_key ?? '').localeCompare(String(b.calendar_date_key ?? '')));
  }

  async listPostGroups() {
    return this.db.read(['postGroups'], (tx) => tx.getAll('postGroups'));
  }

  async listPublicationPackages() {
    return this.db.read(['publicationPackages'], (tx) => tx.getAll('publicationPackages'));
  }

  async listSocialAccounts() {
    return this.db.read(['socialAccounts'], (tx) => tx.getAll('socialAccounts'));
  }

  async getSocialAccount(id) {
    return this.db.read(['socialAccounts'], (tx) => tx.get('socialAccounts', id));
  }

  async listExecutions(channelPostId) {
    const rows = await this.db.read(['executionAttempts'], (tx) =>
      tx.getAllBy('executionAttempts', 'channel_post_id', channelPostId),
    );
    return rows.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  }

  async listAudit({ targetId = null, limit = 200 } = {}) {
    const rows = await this.db.read(['auditEvents'], (tx) => tx.getAll('auditEvents'));
    return rows
      .filter((e) => !targetId || e.target_id === targetId)
      .sort((a, b) => b.seq - a.seq)
      .slice(0, limit);
  }

  async listNotifications() {
    const rows = await this.db.read(['notifications'], (tx) => tx.getAll('notifications'));
    return rows.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }

  async activeEmergencyStops() {
    const rows = await this.db.read(['emergencyStops'], (tx) => tx.getAll('emergencyStops'));
    return rows.filter((s) => !s.released_at);
  }

  async getSetting(key, fallback = null) {
    const row = await this.db.read(['settings'], (tx) => tx.get('settings', key));
    return row ? row.value : fallback;
  }

  async setSetting(key, value) {
    await this.db.write(['settings'], (tx) => tx.put('settings', { key, value }));
    return value;
  }

  async listDeleted() {
    const rows = await this.db.read(['channelPosts'], (tx) => tx.getAll('channelPosts'));
    return rows.filter((p) => p.deleted_at);
  }

  async exportAll() {
    const out = {};
    await this.db.read(STORE_NAMES, async (tx) => {
      for (const name of STORE_NAMES) {
        out[name] = await tx.getAll(name);
      }
    });
    return out;
  }
}

/** その投稿がカレンダー上どの日に載るか (公開済みは実際の公開日)。 */
export function calendarDateKeyOf(post, timeZone, dateKeyFn) {
  const ms = post.published_at ? Date.parse(post.published_at) : Date.parse(post.scheduled_at);
  return dateKeyFn(ms, timeZone);
}

/**
 * 画面が使う形へ変換する。domain層はこの形を前提にしている。
 * @param {object} post
 * @param {number} [nowMs] 承認の有効期限を判定するための現在時刻
 */
export function toPostView(post, nowMs = Date.now()) {
  const expiresAt = post.approval_expires_at ? Date.parse(post.approval_expires_at) : null;
  return {
    /**
     * 承認が「いま」有効そうか。画面の案内を正しくするための目安であって、
     * 実行の可否は必ず verifyApprovalStillValid() で再検査する (§14 二重検査)。
     */
    approvalValid: Boolean(post.approval_id) && (expiresAt === null || expiresAt > nowMs),
    approvalExpiresAtMs: expiresAt,
    id: post.channel_post_id,
    channelPostId: post.channel_post_id,
    postGroupId: post.post_group_id,
    brandId: post.brand_id,
    platform: post.platform,
    socialAccountId: post.social_account_id,
    title: post.title ?? '',
    displayState: post.display_state,
    scheduledAtMs: Date.parse(post.scheduled_at),
    publishedAtMs: post.published_at ? Date.parse(post.published_at) : undefined,
    publicUrl: post.public_url ?? null,
    externalId: post.external_post_id ?? null,
    failureKind: post.failure_kind ?? null,
    credentialExpired: post.credential_expired === true,
    hasAssets: post.has_assets !== false,
    rightsConfirmed: post.rights_confirmed === true,
    production: post.production ?? null,
    trackingOnly: post.internal?.tags?.includes('production-run') === true,
    timeZone: post.time_zone,
  };
}
