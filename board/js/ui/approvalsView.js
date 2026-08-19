// 常設画面②: 承認待ち (§08)
// 確認が必要な投稿だけを連続処理する。プレビュー・変更差分・出典／権利・予定日時を見せる。

import { el, button } from '../core/dom.js';
import { fullDayLabel, clockLabel } from '../core/fmt.js';
import { brandName } from '../domain/brands.js';
import { platformName } from '../domain/platforms.js';
import { platformBadge } from './platformBadge.js';
import { approve, reject, describePendingChange, approveGroup } from '../services/api.js';
import { guardedButton, permissionNotice } from './states.js';
import { openPostDetail } from './postDetail.js';
import { buildPublicApprovalRequest } from './publicApproval.js';

export async function renderApprovalsScreen(app) {
  const { repo } = app.ctx;
  const tz = app.timeZone;
  const pending = await repo.listPendingApprovals();

  const screen = el('div', { class: 'screen' });
  const platforms = ['NOTE', 'X', 'INSTAGRAM', 'YOUTUBE'];
  const board = el('div', { class: 'approval-platform-board' });
  for (const platform of platforms) {
    const items = pending.filter((post) => post.platform === platform);
    const lane = el('section', { class: 'approval-platform-lane' },
      el('div', { class: 'approval-platform-head' },
        platformBadge(platform, { size: 32, decorative: true }),
        el('h2', null, platformName(platform))));
    if (!items.length) {
      lane.appendChild(el('div', { class: 'approval-simple-item' }, approvalMedia(null)));
    } else {
      for (const post of items) {
        lane.appendChild(await buildSimpleApprovalItem(app, post));
      }
    }
    board.appendChild(lane);
  }
  screen.appendChild(board);
  return screen;
}

async function buildSimpleApprovalItem(app, post) {
  const group = await app.ctx.repo.getPostGroup(post.post_group_id);
  const revision = await app.ctx.repo.getRevision(post.current_revision_id);
  const card = el('div', { class: 'approval-simple-item' }, approvalMedia(revision));
  if (revision) {
    card.appendChild(el('a', {
      class: 'btn btn-primary btn-sm',
      href: await buildPublicApprovalRequest({ group, posts: [post], revisions: new Map([[revision.revision_id, revision]]) }),
    }, '承認する'));
  }
  return card;
}

function articleUrl(revision) {
  return revision?.article_url
    ?? revision?.link_url
    ?? revision?.rights?.sources?.find((source) => source.source_url)?.source_url
    ?? null;
}

function thumbnailUrl(revision) {
  const asset = (revision?.assets ?? []).find((item) =>
    item.thumbnail_url || item.preview_url || item.public_url || item.source_url || item.url);
  return asset?.thumbnail_url ?? asset?.preview_url ?? asset?.public_url ?? asset?.source_url ?? asset?.url ?? null;
}

function approvalMedia(revision) {
  const link = articleUrl(revision);
  const thumbnail = thumbnailUrl(revision);
  const pasteThumbnail = (event) => {
    const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.textContent = '';
    target.appendChild(el('img', { src: URL.createObjectURL(file), alt: '貼り付けたサムネイル' }));
  };
  return el('div', { class: 'approval-media-grid' },
    el('div', { class: 'approval-link-box' },
      el('strong', null, '記事リンク'),
      el('input', { class: 'approval-url-input', type: 'url', value: link ?? '', placeholder: '記事URLを貼り付け' })),
    el('div', { class: 'approval-thumbnail-box' },
      el('strong', null, 'サムネイル'),
      thumbnail
        ? el('a', { href: thumbnail, target: '_blank', rel: 'noopener noreferrer' },
            el('img', { src: thumbnail, alt: revision?.assets?.[0]?.alt_text ?? '承認用サムネイル' }))
        : el('div', { class: 'approval-thumbnail-empty', tabindex: '0', onPaste: pasteThumbnail }, 'ここに画像を貼り付け')));
}

async function buildGroupCard(app, postGroupId, items, tz) {
  const { repo } = app.ctx;
  const group = await repo.getPostGroup(postGroupId);
  const card = el('div', { class: 'card' });
  const revisions = new Map();

  card.appendChild(
    el('div', { class: 'card-head' },
      el('h2', { class: 'card-title' }, group?.project_title ?? '（企画名なし）'),
      el('span', { class: 'card-meta' }, brandName(items[0].brand_id)),
      el('span', { class: 'card-meta' },
        `${fullDayLabel(items[0].calendar_date_key)} ${clockLabel(Date.parse(items[0].scheduled_at), tz)}`)),
  );

  for (const post of items) {
    const revision = await repo.getRevision(post.current_revision_id);
    if (revision) revisions.set(revision.revision_id, revision);
    const diff = await describePendingChange(app.ctx, post.channel_post_id);

    card.appendChild(
      el('section', { style: { 'margin-top': '14px', 'border-top': '1px solid var(--line-soft)', 'padding-top': '14px' } },
        el('div', { style: { display: 'flex', gap: '12px', 'align-items': 'baseline', 'flex-wrap': 'wrap' } },
          el('strong', null, platformName(post.platform)),
          el('span', { class: 'card-meta' }, `第${revision?.revision_no ?? '—'}版`),
          el('span', { class: 'card-meta' }, post.social_account_id)),

        // 変更差分 — 何が変わったから再承認が必要なのかを日本語で出す
        diff && !diff.firstApproval && diff.changes.length
          ? el('div', { style: { 'margin-top': '8px' } },
              el('div', { class: 'field-hint' }, `前回の承認（第${diff.previousRevisionNo}版）からの変更：`),
              el('div', { class: 'change-list' }, ...diff.changes.map((c) => el('span', { class: 'change-item' }, c.label))))
          : el('div', { class: 'field-hint', style: { 'margin-top': '8px' } }, '初回の承認です。'),

        el('div', { class: 'preview', style: { 'margin-top': '10px' } },
          [revision?.title, revision?.body, (revision?.hashtags ?? []).join(' '), revision?.cta].filter(Boolean).join('\n\n')),

        approvalMedia(revision),

        el('dl', { class: 'kv', style: { 'margin-top': '10px' } },
          el('dt', null, '出典・権利'),
          el('dd', null, revision?.rights?.confirmed
            ? `確認済み（${revision.rights.rights_status}）${(revision.rights.sources ?? []).length ? ` / 出典${revision.rights.sources.length}件` : ''}`
            : el('span', { class: 'tone-danger' }, '未確認 — 承認前に確認してください')),
          el('dt', null, '素材'),
          el('dd', null, (revision?.assets ?? []).length ? `${revision.assets.length}件（SHA-256は承認根拠に含まれます）` : 'なし'),
          el('dt', null, '公開範囲'),
          el('dd', null, revision?.visibility ?? '—')),

        el('div', { class: 'card-actions' },
          app.ctx.backend === 'public'
            ? el('a', {
                class: 'btn btn-primary btn-sm',
                href: await buildPublicApprovalRequest({ group, posts: [post], revisions: new Map([[revision.revision_id, revision]]) }),
              }, 'GitHubでこのSNSを承認')
            : guardedButton(app, 'approval.approve', 'このSNSを承認', {
            class: 'btn btn-primary btn-sm',
            onClick: async () => {
              const r = await approve(app.ctx, post.channel_post_id);
              app.toast(r.selfApproval ? '承認しました（本人承認として記録）。' : '承認しました。');
              await app.refresh();
            },
          }),
          app.ctx.backend === 'public' ? null : guardedButton(app, 'approval.reject', '差し戻す', {
            class: 'btn btn-sm',
            onClick: async () => {
              const comment = await app.askReason({ title: '差し戻す', message: '作成者へ伝わります。', confirmLabel: '差し戻す' });
              if (!comment) return;
              await reject(app.ctx, post.channel_post_id, { comment });
              app.toast('差し戻しました。');
              await app.refresh();
            },
          }),
          button('詳細を見る', { class: 'btn btn-sm btn-quiet', onClick: () => openPostDetail(app, post.channel_post_id) })),
      ),
    );
  }

  if (items.length > 1) {
    card.appendChild(
      el('div', { class: 'card-actions' },
        app.ctx.backend === 'public'
          ? el('a', {
              class: 'btn btn-primary',
              href: await buildPublicApprovalRequest({ group, posts: items, revisions }),
            }, `GitHubで${items.length}件をまとめて承認`)
          : guardedButton(app, 'approval.approve', `この企画の${items.length}件をまとめて承認`, {
          class: 'btn btn-primary',
          onClick: async () => {
            await approveGroup(app.ctx, items.map((p) => p.channel_post_id));
            app.toast(`${items.length}件を承認しました。`);
            await app.refresh();
          },
        }),
        el('span', { class: 'field-hint' }, '同じ企画のSNSだけをまとめられます。ほかの企画とは一緒にできません。')),
    );
  }

  return card;
}
