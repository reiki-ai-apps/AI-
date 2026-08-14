// ファイル保存のDB（Node専用）。
//
// これが正本になる。ブラウザのIndexedDBはもう使わず、画面もスキルも
// server.mjs 越しにこの1つのファイルを見る。だから「スキルが書いた内容が
// 画面に出ない」というズレが起きない。
//
// 一意インデックスと巻き戻しの規則は memdb.js のものをそのまま使う。
// 増やしたのは「保存」と「書き込みの直列化」だけ。

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MemoryDatabase } from './memdb.js';

export class FileDatabase extends MemoryDatabase {
  /** @param {string} path 保存先のJSONファイル */
  constructor(path) {
    super();
    this.path = path;
    this.backend = 'file';
    /** 書き込みを順番に流すための鎖。並行リクエストで保存が交差しないようにする。 */
    this.queue = Promise.resolve();
  }

  async load() {
    try {
      this.loadSnapshot(JSON.parse(await readFile(this.path, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // まだファイルが無い＝初回。空のまま始めて、最初の書き込みで作る。
    }
    return this;
  }

  /**
   * 別ファイルへ書いてから差し替える。
   * 途中で電源が落ちても、元のファイルが半端な状態にならない。
   */
  async persist() {
    const temp = `${this.path}.tmp`;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(temp, JSON.stringify(this.snapshotAll()), 'utf8');
    await rename(temp, this.path);
  }

  /** 書き込みは1件ずつ。成功したものだけ保存する。 */
  async write(storeNames, fn) {
    const run = this.queue.then(async () => {
      const result = await this.tx(storeNames, 'readwrite', fn);
      await this.persist();
      return result;
    });
    // 失敗しても鎖は切らさない（次の書き込みは通す）。
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async clearAll() {
    await super.clearAll();
    await this.persist();
  }
}

export async function openFileDatabase(path) {
  return new FileDatabase(path).load();
}
