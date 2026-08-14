// GitHubリポジトリ保存のDB。ブラウザ（Pages上の画面）とNode（スキル）の両方で動く。
//
// 正本は非公開リポジトリの board.json 1ファイル。GitHub の Contents API は
// 「読んだときの sha を添えないと書けない」= 楽観ロックそのものなので、
// これを §13 のトランザクション境界として使う。
//
//   書き込み = 最新を読み直す → メモリ上で変更を実行 → sha付きでPUT
//              → 409/422（他の端末が先に書いた）ならロールバックして最初から
//
// services層の change() は live行を tx.get() で読み直す作りなので、
// 再実行しても正しく判定される（承認の二重検査・jtiの一意などがそのまま効く）。
//
// トークンはこのモジュールに渡すだけで、どこにも保存しない。保存は呼び出し側の責任
// （画面は localStorage、スキルはローカルのトークンファイル）。

import { MemoryDatabase, MemoryTransaction, ConstraintError } from './memdb.js';

const API = 'https://api.github.com';
const MAX_RETRY = 5;

export class GithubApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GithubApiError';
    this.code = status === 401 || status === 403 ? 'GITHUB_AUTH' : status === 404 ? 'GITHUB_NOT_FOUND' : 'GITHUB_ERROR';
    this.status = status;
  }
}

export class WriteConflictError extends Error {
  constructor() {
    super('他の端末の書き込みと競合し続けています。少し待ってからやり直してください。');
    this.name = 'WriteConflictError';
    this.code = 'WRITE_CONFLICT';
    this.status = 409;
  }
}

// --- UTF-8 ⇔ base64（ブラウザ・Node両対応） ---------------------------------

function utf8ToBase64(text) {
  if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64');
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const clean = b64.replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined') return Buffer.from(clean, 'base64').toString('utf8');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export class GithubDatabase extends MemoryDatabase {
  /**
   * @param {{owner:string, repo:string, token:string, branch?:string, path?:string}} config
   */
  constructor(config) {
    super();
    for (const key of ['owner', 'repo', 'token']) {
      if (typeof config?.[key] !== 'string' || !config[key].trim()) {
        throw new GithubApiError(400, `GitHub接続の設定が足りません: ${key}`);
      }
    }
    this.owner = config.owner.trim();
    this.repo = config.repo.trim();
    this.branch = (config.branch ?? 'main').trim();
    this.path = (config.path ?? 'board.json').trim();
    this.token = config.token.trim();
    this.backend = 'github';
    /** 直近に読んだファイルの sha。これが楽観ロックの鍵。 */
    this.sha = null;
    this.loadedAt = 0;
    /** 書き込みは1件ずつ（同一プロセス内の直列化。端末間はshaが守る）。 */
    this.queue = Promise.resolve();
  }

  contentsUrl() {
    return `${API}/repos/${this.owner}/${this.repo}/contents/${encodeURIComponent(this.path)}`;
  }

  async request(method, url, body) {
    const response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return response;
  }

  /** 最新の board.json を読み込む。ファイルが無ければ空のまま（初回）。 */
  async load() {
    const response = await this.request('GET', `${this.contentsUrl()}?ref=${encodeURIComponent(this.branch)}`);
    if (response.status === 404) {
      // リポジトリ自体が無い場合と区別する
      const repo = await this.request('GET', `${API}/repos/${this.owner}/${this.repo}`);
      if (repo.status === 404) {
        throw new GithubApiError(404, `リポジトリ ${this.owner}/${this.repo} が見つかりません。名前とトークンの権限を確認してください。`);
      }
      this.sha = null;
      this.loadedAt = Date.now();
      return this;
    }
    if (!response.ok) {
      throw new GithubApiError(response.status, await describeFailure(response, 'データを読み込めません'));
    }
    const payload = await response.json();
    this.sha = payload.sha;
    this.loadSnapshot(JSON.parse(base64ToUtf8(payload.content)));
    this.loadedAt = Date.now();
    return this;
  }

  /** 読み取りが古すぎるとき（別の端末で見る場合）に再読込する。 */
  async refreshIfStale(maxAgeMs = 5_000) {
    if (Date.now() - this.loadedAt >= maxAgeMs) await this.load();
    return this;
  }

  /**
   * 書き込み。最新化 → 実行 → sha付きPUT。競合したらロールバックして最初から。
   */
  async write(storeNames, fn) {
    const run = this.queue.then(() => this.writeWithRetry(storeNames, fn));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async writeWithRetry(storeNames, fn) {
    for (let attempt = 0; attempt < MAX_RETRY; attempt += 1) {
      // 他の端末が書いたかもしれないので、必ず最新へ合わせてから実行する。
      // （1回目も読む。読みの1往復と引き換えに「古い状態への上書き」を根絶する）
      await this.load();

      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      const tx = new MemoryTransaction(this, names, 'readwrite');
      let result;
      try {
        result = await fn(tx);
      } catch (error) {
        tx.rollback();
        throw error; // 業務側の失敗（検証・一意制約など）は再試行しない
      }

      const body = {
        message: `board: ${new Date().toISOString()}`,
        content: utf8ToBase64(JSON.stringify(this.snapshotAll())),
        branch: this.branch,
        ...(this.sha ? { sha: this.sha } : {}),
      };
      const response = await this.request('PUT', this.contentsUrl(), body);
      if (response.ok) {
        this.sha = (await response.json()).content.sha;
        this.loadedAt = Date.now();
        return result;
      }
      tx.rollback();
      // 409/422 = sha が古い（他の端末が先に書いた）。読み直してもう一度。
      if (response.status !== 409 && response.status !== 422) {
        throw new GithubApiError(response.status, await describeFailure(response, '書き込みに失敗しました'));
      }
    }
    throw new WriteConflictError();
  }

  async clearAll() {
    await this.write([], async () => {
      for (const s of this.stores.values()) {
        s.rows.clear();
        s.autoSeq = 0;
      }
    });
  }
}

async function describeFailure(response, prefix) {
  let detail = '';
  try {
    detail = (await response.json()).message ?? '';
  } catch { /* 本文なし */ }
  if (response.status === 401) return `${prefix}：トークンが無効です。作り直して貼り直してください。`;
  if (response.status === 403) return `${prefix}：権限が足りません。トークンに Contents の Read and write を付けてください。`;
  return `${prefix}（${response.status} ${detail}）`;
}

/** 接続確認。読めるかどうかだけを確かめ、DBの中身には触れない。 */
export async function testGithubConnection(config) {
  const db = new GithubDatabase(config);
  await db.load();
  const rows = Object.values(db.snapshotAll().stores).reduce((n, v) => n + v.length, 0);
  return { ok: true, sha: db.sha, records: rows, empty: db.sha === null };
}

export async function openGithubDatabase(config) {
  return new GithubDatabase(config).load();
}

export { ConstraintError };
