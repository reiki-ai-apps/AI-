// 常設画面③: 投稿履歴 (§08)
// 実行結果・公開URL・失敗分類・取消・操作履歴を追跡する。検索／複製／再実行。

import { el, button, replace } from '../core/dom.js';
import { stampLabel, clockLabel, fullDayLabel } from '../core/fmt.js';
import { brandName } from '../domain/brands.js';
import { platformName } from '../domain/platforms.js';
import { displayState, failureKind } from '../domain/state.js';
import { createPostGroup } from '../services/api.js';
import { emptyList, stateTag } from './states.js';
import { openPostDetail } from './postDetail.js';

export async function renderHistoryScreen(app) {
  const { repo } = app.ctx;
  const tz = app.timeZone;

  const screen = el('div', { class: 'screen' });
  screen.appendChild(
    el('div', { class: 'screen-head' },
      el('h1', { class: 'screen-title' }, '投稿履歴'),
      el('p', { class: 'screen-desc' }, '公開URL・失敗・取消・再実行を追跡します。削除したものも30日間はここから復元できます。')),
  );

  const search = el('input', { type: 'text', placeholder: '企画名・SNS・公開URLで絞り込む', style: { 'max-width': '360px' } });
  const includeDeleted = el('input', { type: 'checkbox' });
  const listHost = el('div');

  screen.appendChild(
    el('div', { style: { display: 'flex', gap: '16px', 'align-items': 'center', 'flex-wrap': 'wrap', 'margin-bottom': '14px' } },
      el('label', { class: 'sr-only', for: (search.id = 'history-search') }, '絞り込み'),
      search,
      el('label', { class: 'checkline' }, includeDeleted, '削除済みも表示')),
  );
  screen.appendChild(listHost);

  const paint = async () => {
    const rows = await repo.listHistory({ includeDeleted: includeDeleted.checked });
    const q = search.value.trim().toLowerCase();
    const filtered = q
      ? rows.filter((p) =>
          [p.title, platformName(p.platform), brandName(p.brand_id), p.public_url ?? '', p.external_post_id ?? '']
            .join(' ')
            .toLowerCase()
            .includes(q))
      : rows;

    if (!filtered.length) {
      replace(listHost, emptyList(rows.length ? '条件に合う投稿はありません。' : 'まだ履歴はありません。'));
      return;
    }

    const table = el('table');
    table.appendChild(
      el('thead', null,
        el('tr', null,
          el('th', null, '公開日／予定日'),
          el('th', null, '企画'),
          el('th', null, '系統／SNS'),
          el('th', null, '状態'),
          el('th', null, '結果'),
          el('th', null, '操作'))),
    );
    const tbody = el('tbody');
    for (const post of filtered) {
      const when = post.published_at ? Date.parse(post.published_at) : Date.parse(post.scheduled_at);
      tbody.appendChild(
        el('tr', null,
          el('td', null,
            el('div', null, fullDayLabel(post.calendar_date_key)),
            el('div', { class: 'card-meta' }, clockLabel(when, tz))),
          el('td', null,
            el('div', null, post.title),
            post.deleted_at ? el('div', { class: 'card-meta tone-danger' }, `削除済み（${stampLabel(Date.parse(post.deleted_at), tz)}）`) : null,
            post.cancelled_at ? el('div', { class: 'card-meta tone-neutral' }, '取消済み') : null),
          el('td', null, `${brandName(post.brand_id)}／${platformName(post.platform)}`),
          el('td', null, stateTag(post.display_state), el('div', { class: 'card-meta' }, displayState(post.display_state).meaning)),
          el('td', null, resultCell(post)),
          el('td', null,
            el('div', { style: { display: 'flex', gap: '8px', 'flex-wrap': 'wrap' } },
              button('詳細', { class: 'btn btn-sm', onClick: () => openPostDetail(app, post.channel_post_id) }),
              button('複製', {
                class: 'btn btn-sm btn-quiet',
                onClick: () => duplicate(app, post),
              })))),
      );
    }
    table.appendChild(tbody);
    replace(listHost, el('div', { class: 'table-wrap' }, table));
  };

  search.addEventListener('input', paint);
  includeDeleted.addEventListener('change', paint);
  await paint();

  return screen;
}

function resultCell(post) {
  if (post.public_url) {
    return el('a', { href: post.public_url, target: '_blank', rel: 'noreferrer noopener' }, post.public_url);
  }
  if (post.external_post_id) return el('span', { class: 'hash' }, post.external_post_id);
  if (post.failure_kind) {
    const kind = failureKind(post.failure_kind);
    return el('div', null,
      el('div', { class: 'tone-danger' }, kind.label),
      el('div', { class: 'card-meta' }, kind.recommend));
  }
  return '—';
}

/** 複製 — 同じ内容を新しい企画として作り直す。承認は引き継がない。 */
async function duplicate(app, post) {
  try {
    const revision = await app.ctx.repo.getRevision(post.current_revision_id);
    const group = await app.ctx.repo.getPostGroup(post.post_group_id);
    const created = await createPostGroup(app.ctx, {
      brandId: post.brand_id,
      projectTitle: `${group?.project_title ?? post.title}（複製）`,
      platforms: [post.platform],
      scheduledAtIso: new Date(app.clock.nowMs() + 24 * 3600_000).toISOString(),
      timeZone: post.time_zone,
      payloads: {
        [post.platform]: {
          body: revision.body,
          title: revision.title,
          hashtags: revision.hashtags,
          cta: revision.cta,
          visibility: revision.visibility,
        },
      },
      assets: revision.assets,
      rights: revision.rights,
    });
    app.toast('複製しました。日時を確認してから承認へ進めてください。');
    await openPostDetail(app, created.channelPostIds[0]);
    await app.refresh();
  } catch (error) {
    app.fail(error);
  }
}
