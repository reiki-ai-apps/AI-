// store.js — 永続化(localStorage) + 監査ログ。UIはここを経由してのみ状態を書き換える。
const KEY = "tcgnexus.v1";
const AUDIT_MAX = 500;

export function defaultState() {
  return {
    version: 1,
    settings: {
      mode: "simple", // simple | detail
      monthlyBudget: 0,
      strictPayout: false, // true: 確定利益は入金済みのみ
      purpose: "", // コレクション | 投資・副業 | 店舗・事業
      mainTcg: "",
      onboarded: false,
      lastExportAt: null, // 最後にバックアップを書き出した日時(ISO)
      channels: [
        { name: "メルカリ", feeRate: 10 },
        { name: "ヤフオク!", feeRate: 10 },
        { name: "スニーカーダンク", feeRate: 8 },
        { name: "カードショップ買取", feeRate: 0 },
      ],
    },
    products: [],
    lotteries: [],
    auditLog: [],
  };
}

/**
 * 読み込んだデータを安全な形に正規化する(load と importJson の共通経路)。
 * 破損したバックアップや手編集されたJSONでアプリ全体が動かなくなるのを防ぐ。
 */
function normalize(data) {
  const base = defaultState();
  const merged = {
    ...base,
    ...data,
    settings: { ...base.settings, ...(data.settings || {}) },
    products: Array.isArray(data.products) ? data.products : [],
    lotteries: Array.isArray(data.lotteries) ? data.lotteries : [],
    auditLog: Array.isArray(data.auditLog) ? data.auditLog : [],
  };
  if (
    !Array.isArray(merged.settings.channels) ||
    merged.settings.channels.length === 0 ||
    !merged.settings.channels.every((c) => c && typeof c.name === "string" && Number.isFinite(Number(c.feeRate)))
  ) {
    merged.settings.channels = base.settings.channels;
  }
  // 抽選URLは http(s) のみ許可(javascript: 等のスキーム注入を無効化)
  for (const l of merged.lotteries) {
    if (l && l.url && !/^https?:\/\//.test(String(l.url))) l.url = "";
  }
  // 最後に書き出した日時(ホームの見守りに使う)。日時として読めない値は捨てる
  const lea = merged.settings.lastExportAt;
  if (lea !== undefined && lea !== null && (typeof lea !== "string" || Number.isNaN(new Date(lea).getTime()))) {
    merged.settings.lastExportAt = null;
  }
  // プリフィル記憶も型を強制する(破損バックアップで「[object Object]」等を表示・適用しない)
  const lpd = merged.settings.lastPurchaseDefaults;
  if (lpd !== undefined && lpd !== null) {
    if (typeof lpd === "object" && !Array.isArray(lpd)) {
      merged.settings.lastPurchaseDefaults = {
        store: typeof lpd.store === "string" ? lpd.store : "",
        shippingFee: Number.isFinite(Number(lpd.shippingFee)) ? Math.trunc(Number(lpd.shippingFee)) : 0,
        paymentFee: Number.isFinite(Number(lpd.paymentFee)) ? Math.trunc(Number(lpd.paymentFee)) : 0,
        series: typeof lpd.series === "string" ? lpd.series : "",
        savedAt: typeof lpd.savedAt === "string" ? lpd.savedAt : null,
      };
    } else {
      delete merged.settings.lastPurchaseDefaults;
    }
  }
  return merged;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    return normalize(JSON.parse(raw));
  } catch (e) {
    console.error("データ読み込みに失敗しました", e);
    return defaultState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.error("保存に失敗しました", e);
    return false;
  }
}

let idCounter = 0;
export function newId(prefix) {
  idCounter = (idCounter + 1) % 1000;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/** 監査ログ: 誰が(local user)、いつ、何をしたか。金額・状態の重要変更で必ず呼ぶ。 */
export function audit(state, action, entityType, entityId, detail) {
  state.auditLog.push({
    at: new Date().toISOString(),
    actor: "user",
    action,
    entityType,
    entityId,
    detail: detail || "",
  });
  if (state.auditLog.length > AUDIT_MAX) {
    state.auditLog.splice(0, state.auditLog.length - AUDIT_MAX);
  }
}

/**
 * 次回登録のプリフィル用に直近の購入情報を記憶する(商品作成時に呼ぶ)。
 * 適用はユーザーの明示タップのみ。ここでは記憶するだけで何も入力しない。
 */
export function rememberPurchaseDefaults(settings, product) {
  const pu = (product && product.purchase) || {};
  const store = typeof pu.store === "string" ? pu.store : "";
  const series = product && typeof product.series === "string" ? product.series : "";
  // 商品名+金額だけの簡易登録で、有用な記憶(購入先・シリーズ)を空で上書きしない
  if (!store && !series) return settings.lastPurchaseDefaults || null;
  settings.lastPurchaseDefaults = {
    store,
    shippingFee: Number(pu.shippingFee) || 0,
    paymentFee: Number(pu.paymentFee) || 0,
    series,
    savedAt: (product && product.createdAt) || null,
  };
  return settings.lastPurchaseDefaults;
}

/** バックアップ用エクスポート(JSON文字列) */
export function exportJson(state) {
  return JSON.stringify(state, null, 2);
}

/** インポート(全置換)。構造チェックと正規化を行い、成功時は新しいstateを返す。 */
export function importJson(text) {
  const data = JSON.parse(text);
  if (typeof data !== "object" || data === null || !Array.isArray(data.products)) {
    throw new Error("TCG Nexusのバックアップ形式ではありません");
  }
  return normalize(data);
}

export function clearAll() {
  localStorage.removeItem(KEY);
}
