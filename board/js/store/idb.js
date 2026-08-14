// IndexedDBバックエンド。memdb.js とまったく同じ契約を提供する。
//
// 注意 (重要):
//   IndexedDBのトランザクションは、IDBリクエスト以外のPromiseを await した時点で
//   自動コミットされてしまう。したがって tx() のコールバック内では
//   WebCrypto(digest)・fetch・タイマーを await しないこと。
//   ハッシュ計算はトランザクションを開く前に済ませてから渡す。

import { DB_NAME, DB_VERSION, STORES, STORE_NAMES } from './schema.js';
import { ConstraintError } from './memdb.js';

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function wrapError(error, storeName) {
  if (error?.name === 'ConstraintError') {
    const e = new ConstraintError(storeName, error.message ?? 'unique', '');
    e.cause = error;
    return e;
  }
  return error;
}

class IdbTransaction {
  constructor(tx) {
    this.tx = tx;
  }

  store(name) {
    return this.tx.objectStore(name);
  }

  index(name, indexName) {
    return this.store(name).index(indexName);
  }

  async get(storeName, key) {
    return request(this.store(storeName).get(key));
  }

  async getAll(storeName) {
    return request(this.store(storeName).getAll());
  }

  async getAllBy(storeName, indexName, value) {
    return request(this.index(storeName, indexName).getAll(value));
  }

  async getBy(storeName, indexName, value) {
    return request(this.index(storeName, indexName).get(value));
  }

  async put(storeName, record) {
    try {
      return await request(this.store(storeName).put(record));
    } catch (error) {
      throw wrapError(error, storeName);
    }
  }

  async add(storeName, record) {
    try {
      return await request(this.store(storeName).add(record));
    } catch (error) {
      throw wrapError(error, storeName);
    }
  }

  async delete(storeName, key) {
    return request(this.store(storeName).delete(key));
  }

  async count(storeName) {
    return request(this.store(storeName).count());
  }
}

export class IdbDatabase {
  constructor(db) {
    this.db = db;
    this.backend = 'indexeddb';
  }

  async tx(storeNames, mode, fn) {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const tx = this.db.transaction(names, mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('トランザクションが中断されました。'));
    });

    let result;
    try {
      result = await fn(new IdbTransaction(tx));
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* すでに終了している場合は無視 */
      }
      await done.catch(() => {});
      throw error;
    }
    await done;
    return result;
  }

  async read(storeNames, fn) {
    return this.tx(storeNames, 'readonly', fn);
  }

  async write(storeNames, fn) {
    return this.tx(storeNames, 'readwrite', fn);
  }

  async clearAll() {
    await this.write(STORE_NAMES, async (tx) => {
      for (const name of STORE_NAMES) {
        await request(tx.store(name).clear());
      }
    });
  }

  close() {
    this.db.close();
  }
}

/**
 * @param {string} [name] 別名を渡すと別のデータベースを開く。
 *   受入ゲートは本番データを消さないよう、専用の名前を使う。
 */
export function openIdbDatabase(name = DB_NAME) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, def] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, {
          keyPath: def.keyPath,
          autoIncrement: def.autoIncrement === true,
        });
        for (const idx of def.indexes ?? []) {
          store.createIndex(idx.name, idx.keyPath, { unique: idx.unique === true });
        }
      }
    };
    req.onsuccess = () => resolve(new IdbDatabase(req.result));
    req.onerror = () => reject(req.error);
  });
}

/** ブラウザならIndexedDB、それ以外はメモリDB。 */
export async function openDatabase() {
  if (typeof indexedDB !== 'undefined') return openIdbDatabase();
  const { openMemoryDatabase } = await import('./memdb.js');
  return openMemoryDatabase();
}
