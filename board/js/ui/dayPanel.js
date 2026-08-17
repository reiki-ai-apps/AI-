// §07 選択日の右詳細 — その日に必要な人の判断を、上から一件ずつ終わらせる。
//
// 並び順は契約で固定する:
//   1 選択日と曜日 → 2 次に確認すること → 3 投稿の時刻順リスト → 4 補助情報 → 5 投稿を追加
// 「次に確認すること」がこの画面で最も強い焦点。登録CTAと競合させない (§37)。

import { el, button } from '../core/dom.js';
import { dayHeading, clockLabel, stampLabel, relativeLabel } from '../core/fmt.js';
import { brandName } from '../domain/brands.js';
import { platformName } from '../domain/platforms.js';
import { pickNextAction } from '../domain/nextAction.js';
import { describePause } from '../domain/dayplan.js';
import { toPostView } from '../store/repo.js';
import { syncStatus } from '../domain/invariants.js';
import { stateTag, emptyState, guardedButton } from './states.js';
import { openPostDetail } from './postDetail.js';
import { pauseDay, releaseDay } from '../services/api.js';

/**
 * 選択日の詳細を組み立てる。
 * @param {object} app
 * @param {{dateKey:string, posts:Array, dayPlan:object|null, upcoming:Array, accounts:Array}} data
 */
export function buildDayPanel(app, { dateKey, posts, dayPlan, upcoming, accounts }) {
  const tz = app.timeZone;
  const nowMs = app.clock.nowMs();
  const views = posts.map((p) => toPostView(p, nowMs));

  const next = pickNextAction({
    dateKey,
    posts: views,
    dayPlan: dayPlan ? { paused: dayPlan.paused } : null,
    nowMs,
    timeZone: tz,
    upcoming: upcoming.map((p) => toPostView(p, nowMs)),
  });

  const publishedCount = views.filter((p) => p.displayState === 'PUBLISHED').length;

  const panel = el('aside', { class: 'day-panel', 'aria-label': `${dayHeading(dateKey)}の詳細` });

  // 1. 選択日と曜日
  panel.append(
    el('div', null,
      el('div', { class: 'day-eyebrow' }, dateKey === app.todayKey() ? '今日の投稿' : '選択した日の投稿'),
      el('h2', { class: 'day-heading' }, dayHeading(dateKey)),
      el('div', { class: 'day-sub' },
        posts.length === 0
          ? (dayPlan?.paused ? '意図的に休止している日です' : '予定はありません')
          : `${posts.length}件の予定 ・ ${publishedCount}件投稿済み`)),
  );

  // 2. 次に確認すること（1件だけ）
  panel.appendChild(next.kind === 'ACTION' ? buildNextAction(app, next, dateKey) : el('div', { class: 'day-done' }, next.message));

  // 3. 投稿の時刻順リスト
  if (posts.length) {
    const list = el('div', { class: 'day-list' });
    for (const post of posts) {
      list.appendChild(
        button('', {
          class: 'day-item',
          onClick: () => openPostDetail(app, post.channel_post_id),
          'aria-label': `${clockLabel(Date.parse(post.scheduled_at), tz)} ${post.title} ${platformName(post.platform)} ${brandName(post.brand_id)}`,
        }),
      );
      const item = list.lastChild;
      item.append(
        el('span', { class: 'day-item-time' }, clockLabel(Date.parse(post.scheduled_at), tz)),
        el('span', null,
          el('span', { class: 'day-item-title' }, post.title),
          el('span', { class: 'day-item-meta' },
            el('span', { class: `tone-${post.brand_id === 'news' ? 'news' : 'creative'}` }, platformName(post.platform)),
            `　/　${brandName(post.brand_id)}`)),
        stateTag(post.display_state),
      );
    }
    panel.append(el('h3', { class: 'section-title' }, '本日の予定'), list);
  }

  // 4. 補助情報（最終同期・公開URL・原因）
  const aux = el('div', { class: 'day-aux' });
  const syncedAt = accounts.map((a) => (a.last_synced_at ? Date.parse(a.last_synced_at) : null)).filter(Boolean).sort().at(-1);
  const status = syncStatus(syncedAt ?? undefined, nowMs);
  aux.appendChild(
    el('div', null,
      status.stale
        ? `${status.message}${syncedAt ? `（最終同期：${stampLabel(syncedAt, tz)}／${relativeLabel(syncedAt, nowMs)}）` : '（SNS未接続）'}`
        : `最終同期：${stampLabel(syncedAt, tz)}`),
  );
  for (const p of views) {
    if (p.publicUrl) {
      aux.appendChild(el('div', null, `${platformName(p.platform)}：`, el('a', { href: p.publicUrl, target: '_blank', rel: 'noreferrer noopener' }, p.publicUrl)));
    }
  }
  if (dayPlan?.paused) {
    aux.appendChild(el('div', null, describePause(
      { paused: true, reason: dayPlan.reason, setBy: dayPlan.set_by, setAtIso: dayPlan.set_at },
      (ms) => stampLabel(ms, tz),
    )));
  }
  panel.appendChild(aux);

  // 5. 投稿を追加 / 休止
  if (posts.length === 0) {
    // §09 初回・空: 選べるのは2つだけ
    panel.appendChild(
      emptyState({
        title: dayPlan?.paused ? 'この日は休止として記録されています' : 'この日は予定がありません',
        description: dayPlan?.paused ? null : 'AI／スキルが投稿予定を反映します。',
        actions: dayPlan?.paused
          ? [
              guardedButton(app, 'post.edit', '休止を解除する', {
                onClick: async () => { await releaseDay(app.ctx, dateKey); app.toast('休止を解除しました。'); await app.refresh(); },
              }),
            ]
          : [
              guardedButton(app, 'post.edit', 'この日は休止', {
                onClick: async () => {
                  const reason = await app.askReason({
                    title: 'この日は休止',
                    message: '理由・設定者・日時を記録します。「予定なし」とは別のものとして扱います。',
                    confirmLabel: '休止として記録',
                  });
                  if (!reason) return;
                  await pauseDay(app.ctx, dateKey, { reason });
                  app.toast('休止として記録しました。');
                  await app.refresh();
                },
              }),
            ],
      }),
    );
  }

  return panel;
}

/**
 * 週表示用: 「次に確認すること」を画面幅いっぱいの帯にする。
 * 右詳細を持たない週表示では、ここが §37 の「最強の焦点」を担う。
 */
export function buildNextActionBar(app, { dateKey, posts, dayPlan, upcoming, accounts }) {
  const tz = app.timeZone;
  const nowMs = app.clock.nowMs();
  const views = posts.map((p) => toPostView(p, nowMs));

  const next = pickNextAction({
    dateKey,
    posts: views,
    dayPlan: dayPlan ? { paused: dayPlan.paused } : null,
    nowMs,
    timeZone: tz,
    upcoming: upcoming.map((p) => toPostView(p, nowMs)),
  });

  const syncedAt = accounts
    .map((a) => (a.last_synced_at ? Date.parse(a.last_synced_at) : null))
    .filter(Boolean)
    .sort()
    .at(-1);
  const status = syncStatus(syncedAt ?? undefined, nowMs);

  const wrap = el('div', { class: 'next-bar' });
  wrap.appendChild(
    next.kind === 'ACTION'
      ? buildNextAction(app, next, dateKey)
      : el('div', { class: 'day-done' }, next.message),
  );
  wrap.appendChild(
    el('div', { class: 'next-bar-aux' },
      status.stale
        ? `${status.message}${syncedAt ? `（最終同期：${stampLabel(syncedAt, tz)}／${relativeLabel(syncedAt, nowMs)}）` : '（SNS未接続）'}`
        : `最終同期：${stampLabel(syncedAt, tz)}`),
  );
  return wrap;
}

function buildNextAction(app, next, dateKey) {
  const { item, headline, remaining } = next;
  const canOpen = item.postId || item.action.route === 'connections' || item.action.route === 'approvals';
  return el(
    'div',
    { class: 'next-action' },
    el('div', { class: 'next-action-body' },
      el('div', { class: 'next-action-label' }, '次に確認すること'),
      el('div', { class: 'next-action-what' },
        headline.time ? el('span', { class: 'next-action-time' }, headline.time) : null,
        el('span', null, headline.what)),
      el('div', { class: 'next-action-why' },
        item.cause,
        remaining > 0 ? el('span', null, `　（ほかに${remaining}件）`) : null)),
    canOpen ? el('div', { class: 'next-action-go' },
      button(`${item.action.label} →`, {
        class: 'btn btn-sm',
        onClick: () => {
          if (item.postId) openPostDetail(app, item.postId);
          else if (item.action.route === 'connections') app.go('connections');
          else if (item.action.route === 'approvals') app.go('approvals');
        },
      })) : null,
  );
}
