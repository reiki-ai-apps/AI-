// 表示単位などの軽い好みを、この端末の localStorage に置く（デモ版）。
// 本物にあった保存先（GitHub）の接続設定は、デモ版には無い。

const PREFIX = 'demo-post-board-pref-';

export function loadLocalPref(key, fallback = null) {
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveLocalPref(key, value) {
  try {
    localStorage.setItem(`${PREFIX}${key}`, JSON.stringify(value));
  } catch {
    // 保存できなくても画面は動く
  }
}
