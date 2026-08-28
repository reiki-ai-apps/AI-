// 常設画面②: 承認待ち (§08)
// 確認が必要な投稿だけを連続処理する。プレビュー・変更差分・出典／権利・予定日時を見せる。

import { el, button } from '../core/dom.js';
import { fullDayLabel, clockLabel } from '../core/fmt.js';
import { brandName } from '../domain/brands.js';
import { platformName } from '../domain/platforms.js';
import { platformBadge } from './platformBadge.js';
import { approve, reject, describePendingChange, approveGroup, recordComponentApproval, verifyComponentApprovals } from '../services/api.js?v=2';
import { guardedButton, permissionNotice } from './states.js';
import { openPostDetail } from './postDetail.js';
import { isPublicApprovalActionable } from './publicApproval.js';
import {
  approvalDeviceReady,
  createApprovalDevicePairingLink,
  submitGatewayComponentApproval,
} from './publicApprovalGateway.js?v=5';

const bulkSubmittedKeys = new Set();
const refreshScheduledPosts = new Set();

function componentKey(post, scope) {
  return `${post.channel_post_id}:${post.current_revision_id}:${scope}`;
}

function approvalSyncKey(post) {
  return `${post.channel_post_id}:${post.current_revision_id}`;
}

function trackGatewaySubmission(app, post) {
  const key = approvalSyncKey(post);
  app.state.approvalSyncKeys?.add(key);
  if (refreshScheduledPosts.has(key)) return;
  refreshScheduledPosts.add(key);
  for (const delay of [7_000, 20_000, 45_000]) {
    setTimeout(() => app.refresh().catch(() => {}), delay);
  }
  setTimeout(() => refreshScheduledPosts.delete(key), 50_000);
}

async function openDevicePairingDrawer(app, trigger) {
  trigger.disabled = true;
  trigger.textContent = '登録リンクを作成中…';
  try {
    const pairing = await createApprovalDevicePairingLink();
    const urlInput = el('input', {
      class: 'approval-url-input',
      type: 'url',
      value: pairing.url,
      readonly: true,
      'aria-label': '別の端末を登録するリンク',
    });
    const copyButton = el('button', {
      class: 'btn btn-primary',
      type: 'button',
      onClick: async () => {
        await navigator.clipboard.writeText(pairing.url);
        copyButton.textContent = 'コピーしました';
        app.toast('端末登録リンクをコピーしました。もう一方の端末で一度開いてください。');
      },
    }, 'リンクをコピー');
    const shareButton = typeof navigator.share === 'function'
      ? el('button', {
          class: 'btn',
          type: 'button',
          onClick: () => navigator.share({ title: 'REIKI POST BOARD 端末登録', url: pairing.url }),
        }, 'スマホへ送る')
      : null;
    const expiry = pairing.expiresAt ? new Date(pairing.expiresAt).toLocaleString('ja-JP') : '7日以内';
    app.openDrawer({
      title: 'スマホ・PCを承認端末に登録',
      body: el('div', { class: 'approval-pairing-panel' },
        el('strong', null, 'もう一方の端末で、このリンクを1回だけ開いてください。'),
        el('p', null, 'スマホとPCをそれぞれ一度登録すれば、その後はどちらからでも承認できます。'),
        urlInput,
        el('div', { class: 'card-actions' }, copyButton, shareButton),
        el('small', { class: 'field-hint' }, `有効期限：${expiry}／最大${pairing.maxDevices ?? 5}台`)),
    });
  } catch (error) {
    app.fail(error);
  } finally {
    trigger.disabled = false;
    trigger.textContent = '別の端末も登録';
  }
}

export async function renderApprovalsScreen(app) {
  const { repo } = app.ctx;
  const tz = app.timeZone;
  const allPending = await repo.listPendingApprovals();
  const pending = app.ctx.backend === 'public'
    ? allPending.filter((post) => isPublicApprovalActionable(post, app.ctx.clock.nowMs()))
    : allPending;
  pending.sort((left, right) => Date.parse(right.scheduled_at) - Date.parse(left.scheduled_at));
  const overdueCount = pending.filter((post) => Date.parse(post.scheduled_at) < app.ctx.clock.nowMs()).length;

  const screen = el('div', { class: 'screen' });
  const platforms = [
    { platform: 'NOTE', label: 'note', linkLabel: '記事リンク', mediaLabel: 'サムネイル' },
    { platform: 'X', label: 'X', linkLabel: '投稿本文リンク', mediaLabel: '画像・動画' },
    { platform: 'INSTAGRAM', label: 'Instagram', linkLabel: 'キャプションリンク', mediaLabel: 'カルーセル・動画' },
    { platform: 'YOUTUBE', label: 'YouTube', linkLabel: '動画リンク', mediaLabel: 'サムネイル・動画' },
    { platform: 'YOUTUBE_SHORTS', label: 'YouTube Shorts', linkLabel: '動画リンク', mediaLabel: '動画本体' },
  ];
  if (app.ctx.backend === 'public') {
    const tasks = await collectPublicApprovalTasks(app, pending);
    const postCount = new Set(tasks.map((task) => task.post.channel_post_id)).size;
    const deviceReady = approvalDeviceReady();
    screen.appendChild(el('section', { class: `approval-device-banner ${deviceReady ? 'is-ready' : 'is-missing'}` },
      el('div', { class: 'approval-device-copy' },
        el('strong', null, deviceReady ? 'この端末から承認できます' : 'この端末はまだ承認用に登録されていません'),
        el('span', null, deviceReady
          ? 'スマホ・PCの両方を使う場合は、もう一方の端末を一度だけ登録してください。'
          : '登録済みのスマホまたはPCで「別の端末も登録」を押し、表示されたリンクをこの端末で一度開いてください。')),
      deviceReady ? el('button', {
        class: 'btn btn-sm',
        type: 'button',
        onClick: (event) => openDevicePairingDrawer(app, event.currentTarget),
      }, '別の端末も登録') : null));
    const bulkButton = el('button', {
      class: 'btn btn-primary approval-all-button',
      type: 'button',
      disabled: tasks.length === 0 || !deviceReady,
      onClick: async (event) => {
        const target = event.currentTarget;
        target.disabled = true;
        try {
          for (let index = 0; index < tasks.length; index += 1) {
            const task = tasks[index];
            target.textContent = `承認中 ${index + 1}/${tasks.length}`;
            await submitGatewayComponentApproval(task);
            bulkSubmittedKeys.add(componentKey(task.post, task.componentScope));
            trackGatewaySubmission(app, task.post);
          }
          target.textContent = 'すべて承認を送信済み';
          app.toast(`${postCount}投稿の承認を受け付けました。数分以内にBoardへ反映します。`);
        } catch (error) {
          target.disabled = false;
          target.textContent = `すべて承認（${postCount}投稿）`;
          app.toast(error?.message ?? '一括承認を送信できませんでした。');
        }
      },
    }, tasks.length
      ? (deviceReady ? `すべて承認（${postCount}投稿）` : '一括承認は登録済み端末のみ')
      : 'すべて承認済み');
    screen.appendChild(el('details', { class: 'approval-all-bar' },
      el('summary', { class: 'approval-all-summary' }, `一括承認（${postCount}投稿）`),
      el('div', { class: 'approval-all-body' },
        el('div', { class: 'approval-all-copy' },
          el('strong', null, '現在のRevisionを一括承認'),
          el('span', null, tasks.length
            ? (deviceReady
                ? '未承認の本文・動画と画像をまとめて処理します。GitHub画面は開きません。'
                : '初回設定リンクを一度開くと、このブラウザの承認ボタンだけで処理できます。')
            : '現在、承認できる未処理項目はありません。')),
        bulkButton)));
    if (overdueCount > 0) {
      screen.appendChild(el('p', { class: 'approval-expired-note' },
        `予定時刻を過ぎた${overdueCount}件も表示しています。承認後は重複を確認し、安全な次の時刻へ繰り下げます。`));
    }
  }
  const board = el('div', { class: 'approval-platform-board' });
  for (const spec of platforms) {
    const items = pending.filter((post) => post.platform === spec.platform);
    const lane = el('section', { class: 'approval-platform-lane' },
      el('div', { class: 'approval-platform-head' },
        platformBadge(spec.platform, { size: 32, decorative: true }),
        el('h2', null, spec.label)));
    if (!items.length) {
      lane.appendChild(el('div', { class: 'approval-simple-item' },
        approvalMedia(null, '', spec.linkLabel, spec.mediaLabel, {
          article: disabledApprovalButton(),
          thumbnail: spec.platform === 'YOUTUBE_SHORTS' ? null : disabledApprovalButton(),
          hideThumbnail: spec.platform === 'YOUTUBE_SHORTS',
        })));
    } else {
      for (const post of items) {
        lane.appendChild(await buildSimpleApprovalItem(app, post, spec.linkLabel, spec.mediaLabel));
      }
    }
    board.appendChild(lane);
  }
  screen.appendChild(board);
  return screen;
}

async function collectPublicApprovalTasks(app, posts) {
  const tasks = [];
  for (const post of posts) {
    const [group, revision, verdict] = await Promise.all([
      app.ctx.repo.getPostGroup(post.post_group_id),
      app.ctx.repo.getRevision(post.current_revision_id),
      verifyComponentApprovals(app.ctx, post.channel_post_id),
    ]);
    if (!revision) continue;
    const scopes = post.platform === 'YOUTUBE_SHORTS' ? ['CONTENT'] : ['CONTENT', 'THUMBNAIL'];
    for (const componentScope of scopes) {
      if (verdict.components?.[componentScope]?.valid) continue;
      if (bulkSubmittedKeys.has(componentKey(post, componentScope))) continue;
      tasks.push({ group, post, revision, componentScope });
    }
  }
  return tasks;
}

async function buildSimpleApprovalItem(app, post, linkLabel = '記事リンク', mediaLabel = 'サムネイル') {
  const group = await app.ctx.repo.getPostGroup(post.post_group_id);
  const revision = await app.ctx.repo.getRevision(post.current_revision_id);
  if (!revision) return el('div', { class: 'approval-simple-item' }, approvalMedia(null, '', linkLabel, mediaLabel, {
    article: disabledApprovalButton(), thumbnail: disabledApprovalButton(),
  }));
  const revisions = new Map([[revision.revision_id, revision]]);
  const verdict = await verifyComponentApprovals(app.ctx, post.channel_post_id);
  const requiresThumbnail = post.platform !== 'YOUTUBE_SHORTS';
  const actionFor = async (scope) => {
    if (bulkSubmittedKeys.has(componentKey(post, scope))) {
      return el('span', { class: 'approval-component-approved' }, '承認送信済み');
    }
    const state = verdict.components?.[scope];
    if (state?.valid) {
      const when = state.approval?.decided_at ? new Date(state.approval.decided_at).toLocaleString('ja-JP') : '';
      return el('span', { class: 'approval-component-approved', title: state.currentHash }, `承認済み ${when}`.trim());
    }
    if (app.ctx.backend === 'public') {
      return el('button', {
        class: 'btn btn-primary btn-sm',
        type: 'button',
        onClick: async (event) => {
          const target = event.currentTarget;
          target.disabled = true;
          target.textContent = '送信中…';
          try {
            await submitGatewayComponentApproval({ group, post, revision, componentScope: scope });
            trackGatewaySubmission(app, post);
            target.textContent = '承認を送信済み';
            app.toast('承認を受け付けました。数分以内にBoardへ反映します。');
          } catch (error) {
            target.disabled = false;
            target.textContent = '承認';
            app.toast(error?.message ?? '承認を送信できませんでした。');
          }
        },
      }, '承認');
    }
    return guardedButton(app, 'approval.approve', '承認', {
      class: 'btn btn-primary btn-sm',
      onClick: async () => {
        await recordComponentApproval(app.ctx, post.channel_post_id, scope);
        await app.refresh();
      },
    });
  };
  return el('div', { class: 'approval-simple-item' }, approvalMedia(revision, post.calendar_date_key, linkLabel, mediaLabel, {
    article: await actionFor('CONTENT'),
    thumbnail: requiresThumbnail ? await actionFor('THUMBNAIL') : null,
    hideThumbnail: !requiresThumbnail,
    artifactUrl: post.public_url ?? post.external_url ?? post.canonical_url ?? null,
  }));
}

function disabledApprovalButton() {
  return el('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: true }, '承認');
}

export function approvalArtifactUrl(revision, fallbackUrl = null) {
  const articleAsset = (revision?.assets ?? []).find((asset) => {
    const role = String(asset.asset_role ?? '').toUpperCase();
    const mime = String(asset.mime ?? '');
    return (role === 'CONTENT' || mime.startsWith('text/')) && assetUrl(asset);
  });
  const videoAsset = (revision?.assets ?? []).find((asset) => {
    const role = String(asset.asset_role ?? '').toUpperCase();
    const mime = String(asset.mime ?? '');
    return (role === 'VIDEO' || mime.startsWith('video/')) && assetUrl(asset);
  });
  return assetUrl(articleAsset)
    ?? assetUrl(videoAsset)
    ?? revision?.article_url
    ?? revision?.link_url
    ?? fallbackUrl
    ?? revision?.rights?.sources?.find((source) => source.source_url)?.source_url
    ?? null;
}

function assetUrl(asset) {
  return asset?.thumbnail_url ?? asset?.preview_url ?? asset?.public_url ?? asset?.source_url ?? asset?.url ?? null;
}

export function approvalAssetScope(asset) {
  const role = String(asset?.asset_role ?? '').toUpperCase();
  if (role === 'THUMBNAIL') return 'THUMBNAIL';
  if (role === 'CONTENT' || role === 'VIDEO') return 'CONTENT';
  const mime = String(asset?.mime ?? '').toLowerCase();
  const url = assetUrl(asset) ?? '';
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(url)) return 'THUMBNAIL';
  return 'CONTENT';
}

function mediaPreview(revision, componentScope) {
  const scopedAssets = (revision?.assets ?? [])
    .filter((asset) => approvalAssetScope(asset) === componentScope);
  const assets = scopedAssets.filter((asset) => assetUrl(asset));
  if (!assets.length) {
    return el('div', { class: 'approval-artifact-missing', role: 'alert' },
      '成果物の表示リンクが未登録です。この状態では承認しないでください。');
  }
  const poster = assetUrl((revision?.assets ?? []).find((asset) =>
    approvalAssetScope(asset) === 'THUMBNAIL'));
  const uniqueAssets = assets.filter((asset, index, rows) => {
    const key = asset.sha256 || assetUrl(asset);
    return rows.findIndex((row) => (row.sha256 || assetUrl(row)) === key) === index;
  });
  const visibleLimit = componentScope === 'THUMBNAIL' ? 4 : 3;
  const visibleAssets = uniqueAssets.slice(0, visibleLimit);
  const remaining = Math.max(0, uniqueAssets.length - visibleAssets.length);
  const previews = visibleAssets.map((asset, index) => {
    const url = assetUrl(asset);
    const mime = String(asset.mime ?? '');
    if (mime.startsWith('video/')) {
      const holder = el('div', { class: 'approval-video-placeholder' },
        poster ? el('img', { src: poster, alt: '', loading: 'lazy' }) : null,
        el('span', null, '▶ 動画を読み込んで再生'));
      holder.addEventListener('click', () => {
        holder.replaceWith(el('video', { src: url, controls: true, autoplay: true, preload: 'metadata', playsinline: true,
          'aria-label': asset.alt_text || `確認用動画 ${index + 1}` }));
      }, { once: true });
      return holder;
    }
    if (mime.startsWith('audio/')) {
      return el('div', { class: 'approval-audio-preview' },
        el('strong', null, asset.alt_text || `確認用音声 ${index + 1}`),
        el('audio', {
          src: url,
          controls: true,
          preload: 'metadata',
          'aria-label': asset.alt_text || `確認用音声 ${index + 1}`,
        }));
    }
    if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(url)) {
      return el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' },
        el('img', { src: url, alt: asset.alt_text || `確認用画像 ${index + 1}`, loading: 'lazy' }));
    }
    const label = mime.startsWith('text/') || String(asset.asset_role ?? '').toUpperCase() === 'CONTENT'
      ? '記事全文を開く'
      : `素材${index + 1}を開く`;
    return el('a', { class: 'approval-artifact-link', href: url, target: '_blank', rel: 'noopener noreferrer' }, label);
  });
  if (remaining) previews.push(el('div', { class: 'approval-media-remaining' }, `ほか${remaining}点の確認用素材があります`));
  return el('div', { class: 'approval-media-gallery' }, ...previews);
}

function approvalMedia(revision, publishDate = '', linkLabel = '記事リンク', mediaLabel = 'サムネイル', actions = {}) {
  const link = approvalArtifactUrl(revision, actions.artifactUrl);
  const contentPreview = mediaPreview(revision, 'CONTENT');
  const thumbnailPreview = mediaPreview(revision, 'THUMBNAIL');
  const [, month = '', day = ''] = String(publishDate ?? '').split('-');
  const dateLabel = month && day ? `${Number(month)}/${Number(day)}用` : '日付未定';
  const pasteThumbnail = (event) => {
    const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.textContent = '';
    target.appendChild(el('img', { src: URL.createObjectURL(file), alt: '貼り付けたサムネイル' }));
  };
  return el('div', { class: `approval-media-grid${actions.hideThumbnail ? ' approval-media-grid-single' : ''}` },
    el('div', { class: 'approval-link-box' },
      el('div', { class: 'approval-media-label' },
        el('strong', null, linkLabel), el('small', null, dateLabel)),
      el('input', { class: 'approval-url-input', type: 'url', value: link ?? '', readonly: true, placeholder: `${linkLabel.replace('リンク', '')}URL` }),
      contentPreview,
      actions.article),
    actions.hideThumbnail ? null : el('div', { class: 'approval-thumbnail-box' },
      el('div', { class: 'approval-media-label' },
        el('strong', null, mediaLabel), el('small', null, dateLabel)),
      thumbnailPreview || el('div', { class: 'approval-thumbnail-empty', tabindex: '0', onPaste: pasteThumbnail }, 'サムネイル未登録'),
      actions.thumbnail));
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
            ? el('button', {
                class: 'btn btn-primary btn-sm',
                type: 'button',
                onClick: async () => {
                  await submitGatewayComponentApproval({ group, post, revision, componentScope: 'CONTENT' });
                  trackGatewaySubmission(app, post);
                  app.toast('承認を受け付けました。数分以内にBoardへ反映します。');
                },
              }, '承認')
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
          ? el('button', {
              class: 'btn btn-primary',
              type: 'button',
              onClick: async () => {
                const tasks = await collectPublicApprovalTasks(app, items);
                for (const task of tasks) await submitGatewayComponentApproval(task);
                for (const task of tasks) trackGatewaySubmission(app, task.post);
                app.toast(`${items.length}件の承認を受け付けました。`);
              },
            }, `${items.length}件をまとめて承認`)
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
