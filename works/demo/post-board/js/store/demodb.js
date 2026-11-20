// デモ版の保存先 — メモリDBの中身を、このブラウザの localStorage に丸ごと保存する。
//
// 本物は GitHub の非公開リポジトリやPCのサーバーに保存するが、デモ版は通信をしない。
// 書き込みのたびに全体を書き出すだけの単純な作り（見本データは数十件なので十分軽い）。

import { MemoryDatabase } from './memdb.js';

export const DEMO_DB_KEY = 'demo-post-board-db.v1';

export class DemoDatabase extends MemoryDatabase {
  constructor() {
    super();
    this.backend = 'demo';
    /** 見本データを作る間は保存を止め、最後に1回だけ保存する。 */
    this.persist = true;
  }

  /** 保存済みのデータがあれば読み込む。読めたら true。 */
  restore() {
    try {
      const raw = localStorage.getItem(DEMO_DB_KEY);
      if (!raw) return false;
      this.loadSnapshot(JSON.parse(raw));
      return true;
    } catch {
      return false;
    }
  }

  save() {
    try {
      localStorage.setItem(DEMO_DB_KEY, JSON.stringify(this.snapshotAll()));
    } catch {
      // 容量不足などで保存できなくても、画面はメモリ上のデータで動き続ける。
    }
  }

  async write(storeNames, fn) {
    const result = await super.write(storeNames, fn);
    if (this.persist) this.save();
    return result;
  }

  async clearAll() {
    await super.clearAll();
    try { localStorage.removeItem(DEMO_DB_KEY); } catch {}
  }

  /** app.refresh() から呼ばれる。デモ版は他の端末が無いので何もしない。 */
  async refreshIfStale() {
    return this;
  }
}
