// データの保存先の設定。
//
//   server : このPCの npm start（localhost）。開発と手元運用。
//   github : 非公開リポジトリの board.json。Pages で開いたとき・スマホはこちら。
//
// 設定はこの端末の localStorage に置く。トークンも含む（個人端末前提。
// 共有端末では使わないこと）。リポジトリ側へは一切保存しない。

const KEY = 'reiki-board-connection';

export function loadConnection() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.mode !== 'github') return null;
    for (const k of ['owner', 'repo', 'token']) {
      if (typeof parsed[k] !== 'string' || !parsed[k].trim()) return null;
    }
    return {
      mode: 'github',
      owner: parsed.owner.trim(),
      repo: parsed.repo.trim(),
      branch: (parsed.branch ?? 'main').trim() || 'main',
      token: parsed.token.trim(),
    };
  } catch {
    return null;
  }
}

export function saveConnection(config) {
  localStorage.setItem(KEY, JSON.stringify({ mode: 'github', ...config }));
}

export function clearConnection() {
  localStorage.removeItem(KEY);
}

/** Pages など、同一オリジンにAPIサーバーが居ない場所で開かれているか。 */
export function isStaticHost() {
  return location.hostname === 'reiki-ai-apps.github.io'
    || location.protocol === 'file:'
    || new URLSearchParams(location.search).get('public') === '1';
}

/** 表示単位などの軽い好みは、GitHubモードではコミットせず端末に置く。 */
export function loadLocalPref(key, fallback = null) {
  try {
    const raw = localStorage.getItem(`reiki-board-pref-${key}`);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveLocalPref(key, value) {
  localStorage.setItem(`reiki-board-pref-${key}`, JSON.stringify(value));
}
