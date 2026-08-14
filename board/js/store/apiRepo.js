// 画面側のリポジトリ。IndexedDBの代わりにサーバーの正本を読む。
//
// メソッド名と戻り値は store/repo.js の Repo とそろえてあるので、
// 画面のコードは `app.ctx.repo.listPostsForDay(...)` のまま変わらない。

/** サーバーが返した失敗を、これまでと同じ形の例外に戻す。 */
export class ApiError extends Error {
  constructor({ code, message, status, field, errors }) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    if (field) this.field = field;
    if (errors) this.errors = errors;
  }
}

export class ServerUnavailableError extends Error {
  constructor(cause) {
    super('司令盤のサーバーに繋がりません。`npm start` で起動してから開いてください。');
    this.name = 'ServerUnavailableError';
    this.code = 'SERVER_UNAVAILABLE';
    this.cause = cause;
  }
}

async function post(path, body) {
  let response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new ServerUnavailableError(error);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    throw new ApiError(payload.error ?? { code: 'ERROR', message: `通信に失敗しました（${response.status}）。`, status: response.status });
  }
  return payload.result;
}

/** services層の関数を1つ呼ぶ。名前はサーバー側の許可一覧と一致していること。 */
export function callService(ctx, fn, args) {
  return post('/api/service', { fn, args, actor: ctx.actor });
}

const READ_METHODS = [
  'listPostsForMonth', 'listPostsBetween', 'listPostsForDay', 'listUpcomingPosts',
  'listPendingApprovals', 'listHistory', 'listDayPlans', 'getDayPlan',
  'getPost', 'getRevision', 'listRevisions', 'getApproval', 'listApprovalsFor',
  'getPostGroup', 'listChannelPostsOfGroup', 'listSocialAccounts', 'getSocialAccount',
  'listExecutions', 'listAudit', 'listNotifications', 'activeEmergencyStops',
  'listDeleted', 'exportAll',
];

export class ApiRepo {
  constructor(actorRef) {
    /** actor は画面の役割スイッチで変わるので、参照を持って毎回読む。 */
    this.actorRef = actorRef;
    this.backend = 'server';
  }

  get actor() {
    return this.actorRef();
  }

  call(method, args) {
    return post('/api/repo', { method, args, actor: this.actor });
  }

  /** 既定値つきの読み出しだけ形が違うので個別に。 */
  async getSetting(key, fallback = null) {
    const value = await this.call('getSetting', [key, fallback]);
    return value ?? fallback;
  }

  setSetting(key, value) {
    return this.call('setSetting', [key, value]);
  }

  clearAll() {
    return this.call('clearAll', []);
  }
}

for (const method of READ_METHODS) {
  ApiRepo.prototype[method] = function callRead(...args) {
    return this.call(method, args);
  };
}
