// メモリDB — IndexedDBと同じ契約・同じ一意制約を持つ実装。
//
// Nodeのユニットテストと受入ゲートはこちらを使う (§28C「隔離DB」)。
// ブラウザ側と同じ services/ コードがそのまま動くことが目的なので、
// 一意インデックス違反は IndexedDB と同じく「書き込み時に失敗」させる。

import { STORES, STORE_NAMES, uniqueIndexesOf, indexValueOf } from './schema.js';

export class ConstraintError extends Error {
  constructor(storeName, indexName, value) {
    super(`一意制約に違反しました: ${storeName}.${indexName} = ${JSON.stringify(value)}`);
    this.name = 'ConstraintError';
    this.code = 'CONSTRAINT_VIOLATION';
    this.store = storeName;
    this.index = indexName;
  }
}

function keyOf(value) {
  return Array.isArray(value) ? JSON.stringify(value) : String(value);
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

class MemoryStore {
  constructor(name, def) {
    this.name = name;
    this.def = def;
    this.rows = new Map();
    this.autoSeq = 0;
  }

  primaryKey(record) {
    return record[this.def.keyPath];
  }

  snapshot() {
    return new Map([...this.rows].map(([k, v]) => [k, structuredClone(v)]));
  }

  restore(snapshot, autoSeq) {
    this.rows = snapshot;
    this.autoSeq = autoSeq;
  }
}

export class MemoryTransaction {
  constructor(db, storeNames, mode) {
    this.db = db;
    this.mode = mode;
    this.names = new Set(storeNames);
    // ロールバック用のスナップショット
    this.snapshots = new Map();
    if (mode === 'readwrite') {
      for (const n of storeNames) {
        const s = db.stores.get(n);
        this.snapshots.set(n, { rows: s.snapshot(), autoSeq: s.autoSeq });
      }
    }
  }

  store(name) {
    if (!this.names.has(name)) {
      throw new Error(`トランザクションの対象外のストアです: ${name}`);
    }
    const s = this.db.stores.get(name);
    if (!s) throw new Error(`未知のストアです: ${name}`);
    return s;
  }

  assertWritable() {
    if (this.mode !== 'readwrite') throw new Error('読み取り専用トランザクションです。');
  }

  checkUnique(storeName, record) {
    const store = this.store(storeName);
    const pk = store.primaryKey(record);
    for (const idx of uniqueIndexesOf(storeName)) {
      const value = indexValueOf(record, idx.keyPath);
      if (value === undefined) continue;
      const k = keyOf(value);
      for (const [existingPk, existing] of store.rows) {
        if (keyOf(existingPk) === keyOf(pk)) continue;
        const existingValue = indexValueOf(existing, idx.keyPath);
        if (existingValue !== undefined && keyOf(existingValue) === k) {
          throw new ConstraintError(storeName, idx.name, value);
        }
      }
    }
  }

  async get(storeName, key) {
    return clone(this.store(storeName).rows.get(keyOf(key)));
  }

  async getAll(storeName) {
    return [...this.store(storeName).rows.values()].map((v) => structuredClone(v));
  }

  async getAllBy(storeName, indexName, value) {
    const store = this.store(storeName);
    const idx = (store.def.indexes ?? []).find((i) => i.name === indexName);
    if (!idx) throw new Error(`未知のインデックスです: ${storeName}.${indexName}`);
    const want = keyOf(value);
    const out = [];
    for (const row of store.rows.values()) {
      const v = indexValueOf(row, idx.keyPath);
      if (v !== undefined && keyOf(v) === want) out.push(structuredClone(row));
    }
    return out;
  }

  async getBy(storeName, indexName, value) {
    const rows = await this.getAllBy(storeName, indexName, value);
    return rows[0];
  }

  async put(storeName, record) {
    this.assertWritable();
    const store = this.store(storeName);
    const value = structuredClone(record);
    if (store.def.autoIncrement && value[store.def.keyPath] === undefined) {
      store.autoSeq += 1;
      value[store.def.keyPath] = store.autoSeq;
    }
    this.checkUnique(storeName, value);
    store.rows.set(keyOf(store.primaryKey(value)), value);
    return store.primaryKey(value);
  }

  async add(storeName, record) {
    this.assertWritable();
    const store = this.store(storeName);
    const pk = record[store.def.keyPath];
    if (pk !== undefined && store.rows.has(keyOf(pk))) {
      throw new ConstraintError(storeName, store.def.keyPath, pk);
    }
    return this.put(storeName, record);
  }

  async delete(storeName, key) {
    this.assertWritable();
    this.store(storeName).rows.delete(keyOf(key));
  }

  async count(storeName) {
    return this.store(storeName).rows.size;
  }

  rollback() {
    for (const [name, snap] of this.snapshots) {
      this.db.stores.get(name).restore(snap.rows, snap.autoSeq);
    }
  }
}

export class MemoryDatabase {
  constructor() {
    this.stores = new Map(STORE_NAMES.map((n) => [n, new MemoryStore(n, STORES[n])]));
    this.backend = 'memory';
  }

  /**
   * トランザクション。コールバックが投げたら全ストアを開始時点へ戻す。
   * IndexedDBの abort と同じ意味にする。
   */
  async tx(storeNames, mode, fn) {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const t = new MemoryTransaction(this, names, mode);
    try {
      return await fn(t);
    } catch (error) {
      if (mode === 'readwrite') t.rollback();
      throw error;
    }
  }

  async read(storeNames, fn) {
    return this.tx(storeNames, 'readonly', fn);
  }

  async write(storeNames, fn) {
    return this.tx(storeNames, 'readwrite', fn);
  }

  async clearAll() {
    for (const s of this.stores.values()) {
      s.rows.clear();
      s.autoSeq = 0;
    }
  }

  /** 全ストアの中身を素のJSONへ。filedb.js の保存に使う。 */
  snapshotAll() {
    const stores = {};
    const autoSeq = {};
    for (const [name, store] of this.stores) {
      stores[name] = [...store.rows.values()];
      autoSeq[name] = store.autoSeq;
    }
    return { stores, autoSeq };
  }

  /**
   * snapshotAll() の逆。未知のストア名は無視する（スキーマが増えても読める）。
   * 画面の「すべて書き出す (JSON)」が出す素の形 {ストア名: 行} もそのまま読める。
   */
  loadSnapshot(data) {
    const stores = data?.stores ?? data ?? {};
    for (const [name, rows] of Object.entries(stores)) {
      if (!Array.isArray(rows)) continue;
      const store = this.stores.get(name);
      if (!store) continue;
      store.rows.clear();
      for (const row of rows) store.rows.set(keyOf(store.primaryKey(row)), row);
      // 素の形には採番の続きが入っていないので、既存の最大値から復元する
      // (これを忘れると監査イベントの連番が衝突する)。
      store.autoSeq = data.autoSeq?.[name] ?? (store.def.autoIncrement
        ? rows.reduce((max, row) => Math.max(max, Number(row[store.def.keyPath]) || 0), 0)
        : 0);
    }
  }

  close() {}
}

export function openMemoryDatabase() {
  return new MemoryDatabase();
}
