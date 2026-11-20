// 作業面①: 登録・編集ドロワー (§08)
//
// 最小入力: 系統 / 企画名 / 投稿先SNS / 公開予定日時 / SNS別本文・タイトル /
//           素材・代替テキスト / 担当者・承認者 / 出典・権利確認
// 高度な設定は必要なSNSでのみ段階表示する。
//
// 「ファイルから取り込む」は新しい画面を作らず、このドロワー内のタブに置く (§04 入口を増やさない)。

import { el, button, field, clear, replace, focus } from '../core/dom.js';
import { toLocalInputValue, fromLocalInputValue, dateKey } from '../core/tz.js';
import { BRANDS } from '../domain/brands.js';
import { PLATFORMS, platformName } from '../domain/platforms.js';
import { publishMode, validateAssetForPlatform } from '../domain/capabilities.js';
import { createPostGroup, reviseChannelPost } from '../services/api.js';
import { ingestPackage } from '../services/api.js';
import { readZipEntries } from './zip.js';

/**
 * 新規登録のドロワーを開く。
 * @param {object} app
 * @param {{dateKey?:string}} [options]
 */
export function openCreateDrawer(app, { dateKey: preselectedDate } = {}) {
  const body = el('div', { class: 'drawer-body-inner' });
  const tabs = el('div', { class: 'tabs', role: 'tablist' });
  const panel = el('div');

  const tabDefs = [
    { id: 'form', label: '入力して登録', render: () => buildCreateForm(app, { preselectedDate, close: () => close() }) },
    { id: 'import', label: 'ファイルから取り込む', render: () => buildImportPanel(app, { close: () => close() }) },
  ];

  let current = 'form';
  const buttons = new Map();

  for (const def of tabDefs) {
    const b = button(def.label, {
      class: 'tab',
      role: 'tab',
      'aria-selected': def.id === current ? 'true' : 'false',
      onClick: () => select(def.id),
    });
    buttons.set(def.id, b);
    tabs.appendChild(b);
  }

  function select(id) {
    current = id;
    for (const [key, b] of buttons) b.setAttribute('aria-selected', key === id ? 'true' : 'false');
    const def = tabDefs.find((d) => d.id === id);
    replace(panel, def.render());
    focus(panel.querySelector('select, input, textarea, button'));
  }

  replace(body, tabs, panel);
  select('form');

  const close = app.openDrawer({ title: '投稿を登録', body });
  return close;
}

function buildCreateForm(app, { preselectedDate, close }) {
  const tz = app.timeZone;
  const defaultMs = preselectedDate
    ? Date.parse(`${preselectedDate}T18:30:00`) || app.clock.nowMs()
    : app.clock.nowMs() + 3600_000;

  const brandSelect = el('select', null, ...BRANDS.map((b) => el('option', { value: b.id }, b.name)));
  const titleInput = el('input', { type: 'text', placeholder: '例：今週のAIニュース5選', required: true });
  const whenInput = el('input', {
    type: 'datetime-local',
    value: preselectedDate
      ? `${preselectedDate}T18:30`
      : toLocalInputValue(defaultMs, tz),
    required: true,
  });

  const platformInputs = new Map();
  const platformChoices = el(
    'div',
    { class: 'choice-grid' },
    ...PLATFORMS.map((p) => {
      const input = el('input', { type: 'checkbox', value: p.id });
      platformInputs.set(p.id, input);
      return el('label', { class: 'choice' }, input, p.name);
    }),
  );

  const bodyInput = el('textarea', { placeholder: '各SNSへ送る本文。SNSごとの差分は登録後に編集できます。', required: true });
  const ctaInput = el('input', { type: 'text', placeholder: '例：詳しくはプロフィールのリンクから' });
  const hashtagInput = el('input', { type: 'text', placeholder: '例：#AIニュース #生成AI' });

  const fileInput = el('input', { type: 'file', multiple: true, accept: 'image/*,video/*' });
  const altInput = el('input', { type: 'text', placeholder: '例：発表スライドのサムネイル' });
  const assetList = el('ul', { class: 'kv' });
  let assets = [];

  fileInput.addEventListener('change', async () => {
    assets = [];
    clear(assetList);
    for (const [i, file] of [...fileInput.files].entries()) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      assets.push({
        asset_id: crypto.randomUUID(),
        sha256,
        mime: file.type || 'application/octet-stream',
        bytes: file.size,
        order: i,
        file_name: file.name,
        rights_status: 'UNKNOWN',
      });
      assetList.append(
        el('dt', null, file.name),
        el('dd', null, el('span', { class: 'hash' }, sha256.slice(0, 16) + '…')),
      );
    }
  });

  const ownerInput = el('input', { type: 'text', value: app.ctx.actor.userId });
  const approverInput = el('input', { type: 'text', value: app.ctx.actor.userId });
  const rightsCheck = el('input', { type: 'checkbox' });
  const sourceInput = el('input', { type: 'url', placeholder: 'https://…（一次情報のURL）' });

  const error = el('p', { class: 'form-error' });
  const modeNote = el('div', { class: 'field-hint' });

  function refreshModeNote() {
    const chosen = [...platformInputs].filter(([, i]) => i.checked).map(([id]) => id);
    if (!chosen.length) {
      modeNote.textContent = '';
      return;
    }
    const lines = chosen.map((id) => `${platformName(id)}：${publishMode(id).mode === 'DIRECT' ? '直接投稿' : '手動投稿'}`);
    modeNote.textContent = `公開方法 — ${lines.join(' / ')}（直接投稿は接続設定で能力が確認できたSNSだけ有効になります）`;
  }
  for (const [, input] of platformInputs) input.addEventListener('change', refreshModeNote);

  const form = el(
    'div',
    { style: { display: 'flex', 'flex-direction': 'column', gap: '16px', 'padding-top': '18px' } },
    field('系統', brandSelect, { required: true }),
    field('企画名', titleInput, { required: true }),
    field('投稿先SNS', platformChoices, { required: true, hint: '同じ企画のSNSはあとで一括承認できます。' }),
    modeNote,
    field('公開予定日時', whenInput, { required: true, hint: `タイムゾーン：${tz}（保存はUTC）` }),
    field('本文', bodyInput, { required: true }),
    field('CTA', ctaInput),
    field('ハッシュタグ', hashtagInput),
    field('素材', fileInput, { hint: '選んだファイルのSHA-256を承認根拠に含めます。' }),
    assetList,
    field('代替テキスト', altInput, { hint: '読み上げのために入れてください。' }),
    field('担当者', ownerInput),
    field('承認者', approverInput),
    el('div', { class: 'checkline' }, rightsCheck, el('label', null, '出典・権利を確認した')),
    field('出典URL', sourceInput),
    error,
    el(
      'div',
      { class: 'card-actions' },
      button('登録する', {
        class: 'btn btn-primary',
        onClick: async () => {
          error.textContent = '';
          const platforms = [...platformInputs].filter(([, i]) => i.checked).map(([id]) => id);
          const whenMs = fromLocalInputValue(whenInput.value, tz);
          try {
            if (!platforms.length) throw new Error('投稿先SNSを1つ以上選んでください。');
            if (!Number.isFinite(whenMs)) throw new Error('公開予定日時を入力してください。');
            for (const p of platforms) {
              for (const a of assets) {
                const v = validateAssetForPlatform(p, a);
                if (!v.ok) throw new Error(v.problems.join(' '));
              }
            }
            const payload = {
              body: bodyInput.value,
              title: titleInput.value,
              cta: ctaInput.value,
              hashtags: hashtagInput.value.split(/\s+/).filter(Boolean),
              visibility: 'PUBLIC',
            };
            await createPostGroup(app.ctx, {
              brandId: brandSelect.value,
              projectTitle: titleInput.value,
              platforms,
              scheduledAtIso: new Date(whenMs).toISOString(),
              timeZone: tz,
              payloads: Object.fromEntries(platforms.map((p) => [p, payload])),
              assets: assets.map((a) => ({ ...a, alt_text: altInput.value })),
              rights: {
                confirmed: rightsCheck.checked,
                rights_status: rightsCheck.checked ? 'CLEARED' : 'UNKNOWN',
                sources: sourceInput.value ? [{ claim_id: crypto.randomUUID(), source_url: sourceInput.value }] : [],
              },
              ownerUserId: ownerInput.value,
              approverUserId: approverInput.value,
            });
            close();
            app.update({ selectedDateKey: dateKey(whenMs, tz) });
            app.toast('登録しました。確認依頼へ進めます。');
          } catch (e) {
            error.textContent = e.message ?? '登録できませんでした。';
          }
        },
      }),
      button('やめる', { class: 'btn btn-quiet', onClick: () => close() }),
    ),
  );
  return form;
}

// --- ファイルから取り込む (§25 / §30 I0 手動取込) ----------------------------

function buildImportPanel(app, { close }) {
  const jsonInput = el('input', { type: 'file', accept: '.json,application/json' });
  const zipInput = el('input', { type: 'file', accept: '.zip,application/zip' });
  const log = el('div', { class: 'preview' });
  const runBtn = button('検証して取り込む', { class: 'btn btn-primary' });

  runBtn.addEventListener('click', async () => {
    log.textContent = '';
    const jsonFile = jsonInput.files?.[0];
    if (!jsonFile) {
      log.textContent = 'PublicationPackage の JSON を選んでください。';
      return;
    }
    try {
      const pkg = JSON.parse(await jsonFile.text());
      let assets = new Map();
      const zipFile = zipInput.files?.[0];
      if (zipFile) {
        assets = await readZipEntries(new Uint8Array(await zipFile.arrayBuffer()));
        log.textContent += `素材ZIP: ${assets.size}件を読み込みました。\n`;
      }
      const result = await ingestPackage(app.ctx, pkg, assets);
      log.textContent +=
        result.status === 200
          ? `同じPackageをすでに受理済みです。新しい版は作られません（package_id: ${result.packageId}）。\n`
          : `受理しました。企画1件・SNS別投稿${result.channelPostIds.length}件を登録しました。\n`;
      for (const w of result.warnings ?? []) log.textContent += `注意: ${w}\n`;
      log.textContent += '\n品質PASSは公開承認ではありません。承認待ちから人が公開を判断してください。';
      app.toast(result.status === 200 ? '受理済みのPackageです（再生）。' : 'Packageを受理しました。');
      await app.refresh();
    } catch (e) {
      log.textContent += `${e.code ? `[${e.code}] ` : ''}${e.message}\n`;
      for (const detail of e.errors ?? []) {
        log.textContent += `  ${detail.pointer} — ${detail.message}\n`;
      }
    }
  });

  return el(
    'div',
    { style: { display: 'flex', 'flex-direction': 'column', gap: '16px', 'padding-top': '18px' } },
    el('p', { class: 'field-hint' },
      '制作スキル（ORBIT／FORGE／AIクリエイティブ／AWEなど）が書き出した PublicationPackage を受け取ります。' +
      ' 同じ内容の再送は1件にまとめ、同じキーで内容が違うものは受け付けません。'),
    field('PublicationPackage (JSON)', jsonInput, { required: true }),
    field('素材 (ZIP)', zipInput, { hint: '各素材のSHA-256を照合します。一致しないものは取り込みません。' }),
    el('div', { class: 'card-actions' }, runBtn, button('閉じる', { class: 'btn btn-quiet', onClick: () => close() })),
    el('div', { class: 'field' }, el('span', { class: 'field-label' }, '結果'), log),
  );
}

// --- 編集 --------------------------------------------------------------------

/** 承認根拠に触れる編集。保存すると新しい版になり、承認は無効化される (§14)。 */
export function openEditDrawer(app, post, revision, onDone) {
  const tz = post.time_zone;
  const titleInput = el('input', { type: 'text', value: revision.title ?? '' });
  const bodyInput = el('textarea', { rows: 8 }, revision.body ?? '');
  const ctaInput = el('input', { type: 'text', value: revision.cta ?? '' });
  const whenInput = el('input', { type: 'datetime-local', value: toLocalInputValue(Date.parse(post.scheduled_at), tz) });
  const memoInput = el('textarea', { rows: 2 }, post.internal?.memo ?? '');
  const error = el('p', { class: 'form-error' });

  const close = app.openDrawer({
    title: `編集 — ${platformName(post.platform)}`,
    body: [
      el('div', { class: 'notice notice-attention' },
        el('div', null,
          el('div', { class: 'notice-title' }, '本文・素材・日時・投稿先を変えると承認は無効になります'),
          el('div', { class: 'notice-body' }, '社内メモだけの変更なら承認は維持されます。'))),
      field('タイトル', titleInput),
      field('本文', bodyInput),
      field('CTA', ctaInput),
      field('公開予定日時', whenInput, { hint: `タイムゾーン：${tz}` }),
      field('社内メモ', memoInput, { hint: '承認根拠には含まれません。' }),
      error,
    ],
    footer: [
      button('やめる', { class: 'btn btn-quiet', onClick: () => close() }),
      button('保存する', {
        class: 'btn btn-primary',
        onClick: async () => {
          error.textContent = '';
          try {
            const whenMs = fromLocalInputValue(whenInput.value, tz);
            const result = await reviseChannelPost(app.ctx, post.channel_post_id, {
              title: titleInput.value,
              body: bodyInput.value,
              cta: ctaInput.value,
              scheduledAtIso: Number.isFinite(whenMs) ? new Date(whenMs).toISOString() : undefined,
            });
            close();
            app.toast(
              result.invalidatedApproval
                ? `第${result.revisionNo}版として保存しました。${result.changes.map((c) => c.label).join('・')}が変わったため再承認が必要です。`
                : `第${result.revisionNo}版として保存しました。`,
            );
            await onDone?.();
          } catch (e) {
            error.textContent = e.message ?? '保存できませんでした。';
          }
        },
      }),
    ],
  });
  return close;
}
