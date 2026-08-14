// §26/§28A URLで届いた意図を実行する。
//
//   http://localhost:8126/#intent=<base64url(UTF-8のJSON)>
//
// スキル側は `node scripts/sign-intent.mjs ... --open` でこのURLを開くだけでよい。
// 配列を入れれば複数まとめて実行できる。
//
// 確認ダイアログは挟まない。§26 の考え方では権限の根拠は署名であって画面の操作ではなく、
// ここで人に押させても増えるのはクリックだけで、判断材料は増えないため。
// いま Gateway が受ける10操作は、§38のとおり4SNSとも直接投稿が無効なので
// **どれも外部へ投稿しない**。直接投稿を有効にするときは、この判断を見直すこと。
//
// 履歴からは実行直後に消す。「戻る」で同じURLへ戻っても、jti は消費済みなので
// 再実行されず「実行済みです」と出るだけだが、そもそも履歴に残す必要がない。

import { fromBase64Url } from '../core/ed25519.js';
import { INTENT_ACTIONS } from '../domain/intent.js';
import { submitIntent } from '../services/api.js';

const PREFIX = 'intent=';

/** URLのフラグメントが意図を運んでいるか。 */
export function hasIntentLink(hash = location.hash) {
  return hash.replace(/^#/, '').startsWith(PREFIX);
}

function decodePayload(raw) {
  const json = new TextDecoder().decode(fromBase64Url(raw));
  return JSON.parse(json);
}

/**
 * フラグメントの意図を実行し、結果を app.state.intentResults に残す。
 * 画面は接続設定へ寄せる（受理の履歴と鍵の一覧が同じ場所にあるため）。
 */
export async function consumeIntentLink(app) {
  const raw = location.hash.replace(/^#/, '').slice(PREFIX.length);
  history.replaceState(null, '', '#connections');

  const results = [];
  let payload;
  try {
    payload = decodePayload(raw);
  } catch (error) {
    results.push({ tone: 'danger', text: `URLの意図を読めません：${error.message}` });
    finish(app, results);
    return;
  }

  for (const envelope of Array.isArray(payload) ? payload : [payload]) {
    try {
      const out = await submitIntent(app.ctx, envelope);
      const label = INTENT_ACTIONS[out.action]?.label ?? out.action;
      results.push(out.replayed
        ? { tone: 'attention', text: `${label}：この意図はすでに実行済みです。前回の結果を返しました。` }
        : { tone: 'published', text: `${label}：実行しました。` });
    } catch (error) {
      results.push({ tone: 'danger', text: `${error.code ?? 'ERROR'}：${error.message}` });
    }
  }
  finish(app, results);
}

function finish(app, results) {
  app.state.intentResults = results;
  const failed = results.filter((r) => r.tone === 'danger').length;
  if (results.length === 1) {
    app.toast(results[0].text, failed ? 'error' : 'info');
  } else {
    app.toast(`意図を${results.length}件処理しました（失敗 ${failed}件）`, failed ? 'error' : 'info');
  }
}
