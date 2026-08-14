// §07 選択日の右詳細「次に確認すること」
//
// 契約: 人の判断を上から一件ずつ終わらせる。だからここは**必ず1件だけ**返す。
// 候補が0件なら、静かな完了メッセージを返す (§07 完了の瞬間)。
//
// §06「要対応: 0件なら出さない。あるときだけ原因と次操作を示す」もここが担う。

import { evaluatePost, evaluateEmptyDay, CONDITIONS } from './notify.js';
import { platformName } from './platforms.js';
import { clockLabel } from '../core/fmt.js';

/** 上にあるものほど先に人へ見せる。1件だけ選ぶための唯一の順序。 */
export const PRIORITY = Object.freeze([
  CONDITIONS.OUTCOME_UNKNOWN,
  CONDITIONS.PUBLISH_FAILED,
  CONDITIONS.CREDENTIAL_EXPIRED,
  CONDITIONS.MISSING_ASSET_1H,
  CONDITIONS.DUE_FOR_MANUAL_PUBLISH,
  CONDITIONS.UNAPPROVED_24H,
  CONDITIONS.NO_PLAN,
]);

const PRIORITY_INDEX = new Map(PRIORITY.map((c, i) => [c, i]));

function rankOf(condition) {
  const i = PRIORITY_INDEX.get(condition);
  return i === undefined ? Number.MAX_SAFE_INTEGER : i;
}

/**
 * 選択日の「次に確認すること」を1件だけ決める。
 *
 * @param {object} input
 * @param {string} input.dateKey 選択日
 * @param {Array} input.posts その日の投稿
 * @param {object|null} input.dayPlan その日のDayPlan
 * @param {number} input.nowMs
 * @param {string} input.timeZone
 * @param {Array} [input.upcoming] 選択日より後の投稿 (完了メッセージで次の予定を示すため)
 * @returns {{kind:'ACTION'|'DONE', item?:object, message?:string, headline?:string}}
 */
export function pickNextAction({ dateKey, posts = [], dayPlan = null, nowMs, timeZone, upcoming = [] }) {
  const candidates = [];

  for (const post of posts) {
    for (const n of evaluatePost(post, nowMs)) {
      // 「投稿成功」は対応が必要な事柄ではないので、次対応の候補に入れない。
      if (n.condition === CONDITIONS.PUBLISH_SUCCEEDED) continue;
      candidates.push({ ...n, post, scheduledAtMs: post.scheduledAtMs });
    }
  }

  // 予定が1件も無く、意図的休止でもない日は「予定なし」を1件の対応として扱う。
  if (posts.length === 0 && dayPlan?.paused !== true) {
    candidates.push({ ...evaluateEmptyDay(dateKey), post: null, scheduledAtMs: Infinity });
  }

  if (candidates.length === 0) {
    return { kind: 'DONE', message: doneMessage(upcoming, nowMs, timeZone) };
  }

  candidates.sort((a, b) => {
    const r = rankOf(a.condition) - rankOf(b.condition);
    if (r !== 0) return r;
    return (a.scheduledAtMs ?? 0) - (b.scheduledAtMs ?? 0);
  });

  const top = candidates[0];
  return {
    kind: 'ACTION',
    item: top,
    /** 図2の「18:30 YouTubeの承認」に相当する1行。 */
    headline: headlineFor(top, timeZone),
    remaining: candidates.length - 1,
  };
}

function headlineFor(item, timeZone) {
  const time =
    item.post && Number.isFinite(item.post.scheduledAtMs)
      ? clockLabel(item.post.scheduledAtMs, timeZone)
      : null;
  const what = shortWhat(item);
  return { time, what };
}

function shortWhat(item) {
  const platform = item.post ? platformName(item.post.platform) : null;
  switch (item.condition) {
    case CONDITIONS.OUTCOME_UNKNOWN:
      return platform ? `${platform}の結果を確認` : '投稿結果を確認';
    case CONDITIONS.PUBLISH_FAILED:
      return platform ? `${platform}の失敗に対応` : '失敗に対応';
    case CONDITIONS.CREDENTIAL_EXPIRED:
      return platform ? `${platform}の再接続` : '再接続';
    case CONDITIONS.MISSING_ASSET_1H:
      return platform ? `${platform}の素材・権利を補う` : '素材・権利を補う';
    case CONDITIONS.DUE_FOR_MANUAL_PUBLISH:
      return platform ? `${platform}へ手動で投稿` : '手動で投稿';
    case CONDITIONS.UNAPPROVED_24H:
      if (item.post?.approvalValid === false && item.post?.displayState === 'SCHEDULED') {
        return platform ? `${platform}の再承認` : '再承認';
      }
      return platform ? `${platform}の承認` : '承認';
    case CONDITIONS.NO_PLAN:
      return 'この日の予定を決める';
    default:
      return '内容を確認';
  }
}

/**
 * §07 完了の瞬間 — 「今日の確認は完了しました。次の投稿は20:00です。」
 * 次の投稿が無い日は、その事実だけを静かに伝える。
 */
export function doneMessage(upcoming, nowMs, timeZone) {
  const next = [...upcoming]
    .filter((p) => Number.isFinite(p.scheduledAtMs) && p.scheduledAtMs > nowMs)
    .sort((a, b) => a.scheduledAtMs - b.scheduledAtMs)[0];
  if (!next) return '今日の確認は完了しました。';
  return `今日の確認は完了しました。次の投稿は${clockLabel(next.scheduledAtMs, timeZone)}です。`;
}
