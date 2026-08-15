// GitHub Pagesで公開する閲覧専用DB。
//
// 正本は同じサイトの data/board.json。認証情報を使わずに読み取れるが、
// ブラウザからの書き込みは一切許可しない。更新はPC/Codex側のGit操作だけで行う。

import { MemoryDatabase } from './memdb.js';

export class PublicDatabase extends MemoryDatabase {
  constructor(url) {
    super();
    this.url = String(url);
    this.backend = 'public';
    this.loadedAt = 0;
  }

  async load() {
    const isHttp = /^https?:/i.test(this.url);
    const separator = this.url.includes('?') ? '&' : '?';
    const target = isHttp ? `${this.url}${separator}v=${Date.now()}` : this.url;
    const response = await fetch(target, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`公開データを読み込めません（${response.status}）。`);
    }
    this.loadSnapshot(await response.json());
    this.loadedAt = Date.now();
    return this;
  }

  async refreshIfStale(maxAgeMs = 5_000) {
    if (Date.now() - this.loadedAt >= maxAgeMs) await this.load();
    return this;
  }

  async write() {
    const error = new Error('スマホ版は閲覧専用です。変更はPCまたはCodexから行ってください。');
    error.code = 'READ_ONLY';
    error.status = 403;
    throw error;
  }

  async clearAll() {
    return this.write();
  }
}

export async function openPublicDatabase(url = new URL('../../data/board.json', import.meta.url)) {
  return new PublicDatabase(url).load();
}
