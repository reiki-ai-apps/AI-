// 作業面②: 投稿詳細 (§08)
// Post GroupとSNS別投稿・版・承認・実行・監査を1件に集約し、
// 編集／予約／取消／確認をここから行う。

import { el, button, field, clear } from '../core/dom.js';
import { stampLabel, clockLabel, fullDayLabel } from '../core/fmt.js';
import { brandName } from '../domain/brands.js';
import { platformName } from '../domain/platforms.js';
import { displayState } from '../domain/state.js';
import { publishMode } from '../domain/capabilities.js';
import { submitForApproval, approve, reject, verifyApprovalStillValid } from '../services/api.js';
import { cancelSchedule } from '../services/api.js';
import { describeProduction, updateProduction } from '../services/api.js';
import { PRODUCTION_KIND_LABELS } from '../domain/production.js';
import { can } from '../domain/rbac.js';
import { claimManualExecution, getApprovedContent, confirmManualPublish, releaseManualClaim, markOutcomeUnknown } from '../services/api.js';
import { softDeletePost, restorePost } from '../services/api.js';
import { auditActionLabel } from '../services/audit.js';
import { openEditDrawer } from './editDrawer.js';
import { stateTag, failureNotice, guardedButton } from './states.js';

/** 投稿詳細をドロワーで開く。 */
export async function openPostDetail(app, channelPostId) {
  const bodyHost = el('div', { style: { display: 'flex', 'flex-direction': 'column', gap: '18px' } });
  const footHost = el('div', { class: 'drawer-foot', style: { padding: '0', border: '0' } });

  const close = app.openDrawer({
    title: '投稿詳細',
    body: bodyHost,
    footer: footHost,
  });

  const reload = async () => {
    await paint(app, channelPostId, bodyHost, footHost, { reload, close });
    await app.refresh();
  };
  await paint(app, channelPostId, bodyHost, footHost, { reload, close });
  return close;
}

async function paint(app, channelPostId, bodyHost, footHost, ctl) {
  const { repo } = app.ctx;
  const tz = app.timeZone;
  const nowMs = app.clock.nowMs();

  const post = await repo.getPost(channelPostId);
  clear(bodyHost);
  clear(footHost);
  if (!post) {
    bodyHost.appendChild(el('p', null, 'この投稿は見つかりません。'));
    return;
  }

  const group = await repo.getPostGroup(post.post_group_id);
  const revision = await repo.getRevision(post.current_revision_id);
  const revisions = await repo.listRevisions(channelPostId);
  const approvals = await repo.listApprovalsFor(channelPostId);
  const executions = await repo.listExecutions(channelPostId);
  const audit = await repo.listAudit({ targetId: channelPostId, limit: 40 });
  const verdict = await verifyApprovalStillValid(app.ctx, channelPostId).catch(() => null);
  const siblings = await repo.listChannelPostsOfGroup(post.post_group_id);
  const mode = publishMode(post.platform);

  bodyHost.append(
    el(
      'div',
      null,
      el('div', { class: 'card-meta' }, `${brandName(post.brand_id)}／${platformName(post.platform)}`),
      el('h3', { class: 'card-title' }, group?.project_title ?? post.title),
      el('div', { style: { display: 'flex', gap: '12px', 'align-items': 'baseline', 'margin-top': '6px' } },
        stateTag(post.display_state),
        el('span', { class: 'card-meta' }, displayState(post.display_state).meaning)),
    ),
  );

  if (post.deleted_at) {
    bodyHost.appendChild(
      el('div', { class: 'notice notice-danger' },
        el('div', null,
          el('div', { class: 'notice-title' }, '削除済み'),
          el('div', { class: 'notice-body' }, `${stampLabel(Date.parse(post.deleted_at), tz)} に削除（理由：${post.delete_reason ?? '—'}）。30日以内なら管理者が復元できます。`))),
    );
  }
  if (post.cancelled_at) {
    bodyHost.appendChild(
      el('div', { class: 'notice' },
        el('div', null,
          el('div', { class: 'notice-title' }, '取消済み'),
          el('div', { class: 'notice-body' }, `${stampLabel(Date.parse(post.cancelled_at), tz)} に取消しました。`))),
    );
  }

  const fail = failureNotice(post);
  if (fail) bodyHost.appendChild(fail);

  // --- 予定と公開方法 -------------------------------------------------------
  bodyHost.appendChild(
    section('予定と公開方法', [
      kv([
        ['公開予定日時', `${fullDayLabel(post.calendar_date_key)} ${clockLabel(Date.parse(post.scheduled_at), tz)}`],
        ['タイムゾーン', post.time_zone],
        ['投稿先アカウント', post.social_account_id],
        ['公開方法', mode.mode === 'DIRECT' ? '直接投稿' : `手動投稿 — ${mode.reason}`],
        ...(post.public_url ? [['公開URL', el('a', { href: post.public_url, target: '_blank', rel: 'noreferrer noopener' }, post.public_url)]] : []),
        ...(post.external_post_id ? [['外部ID', post.external_post_id]] : []),
      ]),
    ]),
  );

  // --- 制作の進み具合 (§10 内部情報) ----------------------------------------
  // 人はここのチェックで申告し、スキルは production.update の意図で申告する。
  // どちらも同じデータに乗るので、報告と盤面がずれない。
  const production = await describeProduction(app.ctx, channelPostId).catch(() => null);
  if (production && !post.deleted_at) {
    const editable = can(app.state.role, 'post.edit.internal').allowed;
    const doneCount = production.steps.filter((s) => s.done).length;
    bodyHost.appendChild(
      section(`制作の進み具合（${PRODUCTION_KIND_LABELS[production.kind]}・${doneCount}／${production.steps.length}）`, [
        el('ul', { class: 'plain-list' },
          ...production.steps.map((step) => {
            const checkbox = el('input', {
              type: 'checkbox',
              checked: step.done ? true : null,
              disabled: editable ? null : true,
              'aria-label': `${step.label} を${step.done ? '未完了' : '完了'}にする`,
              onChange: async () => {
                try {
                  await updateProduction(app.ctx, channelPostId, {
                    kind: production.kind,
                    steps: production.steps.map((s) =>
                      s.id === step.id ? { ...s, done: !step.done } : s),
                    reason: `${step.label}を${step.done ? '未完了に戻す' : '完了'}`,
                  });
                  await ctl.reload();
                } catch (e) { app.fail(e); }
              },
            });
            return el('li', { class: 'progress-row' },
              el('label', { class: 'checkline', style: { flex: '1 1 auto' } },
                checkbox,
                el('span', step.done ? { style: { color: 'var(--ink-2)' } } : null, step.label),
                step.note ? el('span', { class: 'field-hint' }, `（${step.note}）`) : null));
          })),
        el('p', { class: 'field-hint' },
          production.reported
            ? `最終申告：${production.updatedBy ?? '—'}・${production.updatedAt ? stampLabel(Date.parse(production.updatedAt), tz) : '—'}`
            : 'まだ申告がありません。既定の手順を表示しています。',
          production.block?.kind !== 'NONE' && production.block?.next
            ? `　次の一手：${production.block.next}`
            : null),
      ]),
    );
  }

  // --- 現在の版 -------------------------------------------------------------
  bodyHost.appendChild(
    section(`現在の版（第${revision?.revision_no ?? '—'}版 / 全${revisions.length}版）`, [
      el('div', { class: 'preview' }, revision?.body ?? ''),
      kv([
        ['タイトル', revision?.title || '—'],
        ['ハッシュタグ', (revision?.hashtags ?? []).join(' ') || '—'],
        ['CTA', revision?.cta || '—'],
        ['公開範囲', revision?.visibility ?? '—'],
        ['権利・出典', revision?.rights?.confirmed ? `確認済み（${revision.rights.rights_status}）` : '未確認'],
        // 承認時に許可した遅延再試行時間もハッシュに入るので、承認済みの値とは一致しない。
        // 混同しないよう、この版そのもののハッシュとして別の名前で出す。
        ['この版の内容ハッシュ', el('span', { class: 'hash' }, revision?.approval_basis_hash ?? '—')],
      ]),
      (revision?.assets ?? []).length
        ? el('ul', { class: 'kv' },
            ...revision.assets.flatMap((a) => [
              el('dt', null, a.file_name ?? a.asset_id.slice(0, 8)),
              el('dd', null,
                el('span', { class: 'hash' }, `${a.sha256?.slice(0, 24) ?? '—'}…`),
                a.alt_text ? el('div', { class: 'card-meta' }, `代替テキスト：${a.alt_text}`) : null),
            ]))
        : el('p', { class: 'field-hint' }, '素材はありません。'),
    ]),
  );

  // --- 承認 -----------------------------------------------------------------
  const approved = approvals.find((a) => a.decision === 'APPROVED' && !a.revoked_at);
  bodyHost.appendChild(
    section('承認', [
      verdict
        ? el('div', { class: verdict.valid ? 'notice' : 'notice notice-attention' },
            el('div', null,
              el('div', { class: 'notice-title' }, verdict.valid ? '有効な承認があります' : '有効な承認がありません'),
              el('div', { class: 'notice-body' }, verdict.message)))
        : null,
      approved
        ? kv([
            ['承認者', approved.approver_user_id],
            ['承認日時', stampLabel(Date.parse(approved.decided_at), tz)],
            ['対象版', `第${revisions.find((r) => r.revision_id === approved.revision_id)?.revision_no ?? '—'}版`],
            ['有効期限', approved.expires_at ? stampLabel(Date.parse(approved.expires_at), tz) : '—'],
            ['本人承認', approved.self_approval ? '単独運用のため本人が承認（記録済み）' : 'いいえ'],
            ['承認根拠ハッシュ', el('span', { class: 'hash' }, approved.approval_basis_hash)],
          ])
        : el('p', { class: 'field-hint' }, 'まだ承認されていません。'),
      approvals.filter((a) => a.decision === 'REJECTED').length
        ? el('div', null,
            el('div', { class: 'field-label' }, '差し戻しの記録'),
            el('ul', { class: 'kv' },
              ...approvals.filter((a) => a.decision === 'REJECTED').flatMap((a) => [
                el('dt', null, stampLabel(Date.parse(a.decided_at), tz)),
                el('dd', null, a.comment ?? '—'),
              ])))
        : null,
    ]),
  );

  // --- 同一企画のほかのSNS ---------------------------------------------------
  if (siblings.length > 1) {
    bodyHost.appendChild(
      section('同じ企画のほかのSNS', [
        el('ul', { class: 'kv' },
          ...siblings
            .filter((s) => s.channel_post_id !== channelPostId)
            .flatMap((s) => [
              el('dt', null, platformName(s.platform)),
              el('dd', null, displayState(s.display_state).label),
            ])),
        el('p', { class: 'field-hint' }, '一部が失敗しても、失敗した投稿だけを個別に再実行できます。'),
      ]),
    );
  }

  // --- 実行 -----------------------------------------------------------------
  bodyHost.appendChild(
    section('実行', [
      executions.length
        ? el('div', { class: 'table-wrap' },
            el('table', null,
              el('thead', null, el('tr', null,
                el('th', null, '状態'), el('th', null, '方法'), el('th', null, '外部ID / 公開URL'), el('th', null, '更新'))),
              el('tbody', null,
                ...executions.map((e) => el('tr', null,
                  el('td', null, e.state),
                  el('td', null, e.mode === 'MANUAL' ? '手動' : '自動'),
                  el('td', null, e.public_url ?? e.external_post_id ?? '—'),
                  el('td', null, stampLabel(Date.parse(e.updated_at), tz)))))))
        : el('p', { class: 'field-hint' }, 'まだ実行していません。'),
    ]),
  );

  // --- 監査 -----------------------------------------------------------------
  bodyHost.appendChild(
    section('監査', [
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', null, '日時'), el('th', null, '操作'), el('th', null, '操作者'), el('th', null, '理由'))),
          el('tbody', null,
            ...audit.map((e) => el('tr', null,
              el('td', null, stampLabel(Date.parse(e.occurred_at), tz)),
              el('td', null, auditActionLabel(e.action)),
              el('td', null, e.actor),
              el('td', null, e.reason ?? '—')))))),
    ]),
  );

  // --- 操作 -----------------------------------------------------------------
  const actions = [];
  const push = (node) => node && actions.push(node);

  if (post.deleted_at) {
    push(guardedButton(app, 'post.restore', '復元する', {
      class: 'btn btn-primary',
      onClick: async () => { await restorePost(app.ctx, channelPostId); app.toast('復元しました。'); await ctl.reload(); },
    }));
  } else {
    if (['DRAFT', 'QUALITY_REVIEW'].includes(post.display_state)) {
      push(guardedButton(app, 'approval.submit', '確認を依頼', {
        class: 'btn btn-primary',
        onClick: async () => { await submitForApproval(app.ctx, channelPostId); app.toast('承認待ちに移しました。'); await ctl.reload(); },
      }));
    }
    if (post.display_state === 'PENDING_APPROVAL') {
      push(guardedButton(app, 'approval.approve', '承認する', {
        class: 'btn btn-primary',
        onClick: async () => {
          const r = await approve(app.ctx, channelPostId);
          app.toast(r.selfApproval ? '承認しました（本人承認として記録しました）。' : '承認しました。');
          await ctl.reload();
        },
      }));
      push(guardedButton(app, 'approval.reject', '差し戻す', {
        onClick: async () => {
          const comment = await app.askReason({ title: '差し戻す', message: '作成者へ伝わります。', confirmLabel: '差し戻す' });
          if (!comment) return;
          await reject(app.ctx, channelPostId, { comment });
          app.toast('差し戻しました。');
          await ctl.reload();
        },
      }));
    }
    if (post.display_state === 'SCHEDULED') {
      push(guardedButton(app, 'execution.manual', '手動で投稿する', {
        class: 'btn btn-primary',
        onClick: () => openManualFlow(app, channelPostId, ctl.reload),
      }));
    }
    if (post.display_state === 'PUBLISHING' || post.failure_kind === 'UNKNOWN_OUTCOME') {
      push(guardedButton(app, 'execution.manual', '結果を登録する', {
        class: 'btn btn-primary',
        onClick: () => openManualFlow(app, channelPostId, ctl.reload),
      }));
    }
    if (post.display_state === 'PUBLISHING') {
      push(guardedButton(app, 'execution.manual', '取りやめる', {
        onClick: async () => {
          const reason = await app.askReason({ title: '手動投稿を取りやめる', confirmLabel: '取りやめる' });
          if (!reason) return;
          await releaseManualClaim(app.ctx, channelPostId, { reason });
          app.toast('取りやめました。予約済みへ戻しました。');
          await ctl.reload();
        },
      }));
    }
    if (post.display_state !== 'PUBLISHED') {
      push(guardedButton(app, 'post.edit', '編集', {
        onClick: () => openEditDrawer(app, post, revision, ctl.reload),
      }));
    }
    if (!post.cancelled_at && ['SCHEDULED', 'PENDING_APPROVAL', 'DRAFT', 'QUALITY_REVIEW'].includes(post.display_state)) {
      push(guardedButton(app, 'schedule.cancel', '取消', {
        onClick: async () => {
          const reason = await app.askReason({ title: '予約を取消す', message: '送信前なので取消できます。', confirmLabel: '取消す', tone: 'danger' });
          if (!reason) return;
          await cancelSchedule(app.ctx, channelPostId, { reason });
          app.toast('取消しました。');
          await ctl.reload();
        },
      }));
    }
    push(guardedButton(app, 'post.delete', '削除', {
      class: 'btn btn-danger',
      onClick: async () => {
        const reason = await app.askReason({ title: '投稿を削除する', message: '30日以内なら管理者が復元できます。', confirmLabel: '削除する', tone: 'danger' });
        if (!reason) return;
        await softDeletePost(app.ctx, channelPostId, { reason });
        app.toast('削除しました。30日以内は復元できます。');
        await ctl.reload();
      },
    }));
  }

  footHost.append(...actions);
}

function section(title, children) {
  return el('section', null, el('h4', { class: 'section-title', style: { 'margin-bottom': '8px' } }, title), ...children.filter(Boolean));
}

function kv(pairs) {
  return el('dl', { class: 'kv' }, ...pairs.flatMap(([k, v]) => [el('dt', null, k), el('dd', null, v)]));
}

// --- §16 手動投稿の作業面 ----------------------------------------------------

async function openManualFlow(app, channelPostId, onDone) {
  const tz = app.timeZone;
  let content;
  try {
    content = await getApprovedContent(app.ctx, channelPostId);
  } catch (error) {
    app.fail(error);
    return;
  }

  const post = await app.ctx.repo.getPost(channelPostId);

  /**
   * 実行キーの取得は「まだ取っていないときだけ」。
   * 入力の不備で確定に失敗しても取得はすでに済んでいるので、
   * ドロワーを開いた時点の状態を覚えず、押すたびに現在の状態を読み直す。
   */
  const ensureClaimed = async () => {
    const live = await app.ctx.repo.getPost(channelPostId);
    if (live.display_state === 'SCHEDULED') {
      await claimManualExecution(app.ctx, channelPostId);
    }
  };

  const urlInput = el('input', { type: 'url', placeholder: 'https://…' });
  const extInput = el('input', { type: 'text', placeholder: 'SNS側の投稿ID（分かる場合）' });
  const whenInput = el('input', { type: 'datetime-local' });
  const checkAccount = el('input', { type: 'checkbox' });
  const checkContent = el('input', { type: 'checkbox' });
  const checkWhen = el('input', { type: 'checkbox' });
  const error = el('p', { class: 'form-error' });

  const bodyText = [content.body, content.hashtags?.join(' '), content.cta].filter(Boolean).join('\n\n');

  const copyBtn = button('本文をコピー', {
    class: 'btn btn-sm',
    onClick: async () => {
      try {
        await navigator.clipboard.writeText(bodyText);
        app.toast('承認された本文をコピーしました。');
      } catch {
        app.toast('コピーできませんでした。本文を選択して手動でコピーしてください。', 'error');
      }
    },
  });

  let close;
  close = app.openDrawer({
    title: `手動で投稿する — ${content.platformName}`,
    body: [
      el('div', { class: 'notice' },
        el('div', null,
          el('div', { class: 'notice-title' }, '承認された内容だけを投稿してください'),
          el('div', { class: 'notice-body' }, `${content.platformName} の直接投稿はまだ有効ではありません。下の内容をそのままSNSへ貼り、公開できたら結果を登録してください。`))),

      el('section', null,
        el('div', { style: { display: 'flex', gap: '12px', 'align-items': 'center', 'margin-bottom': '8px' } },
          el('h4', { class: 'section-title' }, `承認された内容（第${content.revisionNo}版）`), copyBtn),
        el('div', { class: 'preview' }, bodyText),
        el('dl', { class: 'kv', style: { 'margin-top': '10px' } },
          el('dt', null, '投稿先'), el('dd', null, `${content.platformName}／${content.socialAccountId}`),
          el('dt', null, '公開予定'), el('dd', null, `${fullDayLabel(post.calendar_date_key)} ${clockLabel(Date.parse(content.scheduledAt), tz)}`),
          el('dt', null, '承認根拠'), el('dd', null, el('span', { class: 'hash' }, content.approvalBasisHash)))),

      content.assets.length
        ? el('section', null,
            el('h4', { class: 'section-title' }, '素材'),
            el('dl', { class: 'kv' },
              ...content.assets.flatMap((a) => [
                el('dt', null, a.file_name ?? a.asset_id.slice(0, 8)),
                el('dd', null, el('span', { class: 'hash' }, `${a.sha256?.slice(0, 24)}…`)),
              ])))
        : null,

      el('section', null,
        el('h4', { class: 'section-title' }, '結果を登録'),
        el('p', { class: 'field-hint' }, '公開URLか外部IDのどちらかが必要です。どちらも無い状態では投稿済みにできません。'),
        field('公開URL', urlInput),
        field('外部ID', extInput),
        field('実際の公開時刻', whenInput, { hint: '空欄なら現在時刻を使います。' }),
        el('div', { class: 'checkline' }, checkAccount, el('label', null, '投稿先アカウントが一致することを確認した')),
        el('div', { class: 'checkline' }, checkContent, el('label', null, '公開された内容が承認された内容と一致することを確認した')),
        el('div', { class: 'checkline' }, checkWhen, el('label', null, '公開時刻を確認した')),
        error),
    ],
    footer: [
      button('閉じる', { class: 'btn btn-quiet', onClick: () => close() }),
      button('結果を確認できない（結果不明として記録）', {
        class: 'btn',
        onClick: async () => {
          try {
            await ensureClaimed();
            await markOutcomeUnknown(app.ctx, channelPostId);
            close();
            app.toast('結果不明として記録しました。再送はしません。SNS側の投稿有無を確認してください。');
            await onDone?.();
          } catch (e) { app.fail(e); }
        },
      }),
      button('投稿済みとして確定', {
        class: 'btn btn-primary',
        onClick: async () => {
          error.textContent = '';
          try {
            await ensureClaimed();
            const whenMs = whenInput.value ? Date.parse(whenInput.value) : app.clock.nowMs();
            await confirmManualPublish(app.ctx, channelPostId, {
              publicUrl: urlInput.value,
              externalPostId: extInput.value,
              publishedAtIso: new Date(whenMs).toISOString(),
              accountMatches: checkAccount.checked,
              contentMatches: checkContent.checked,
              publishedAtMatches: checkWhen.checked,
            });
            close();
            app.toast('投稿済みにしました。');
            await onDone?.();
          } catch (e) {
            error.textContent = e.message ?? '登録できませんでした。';
          }
        },
      }),
    ],
  });
}
