// 常設画面④: 接続設定 (§08 / §21 / §38)
// SNS正式名・アカウント・能力・最終同期・認証期限を管理する。
// 能力がUNKNOWNのままの機能は有効化しない (G27)。

import { el, button, field, replace } from '../core/dom.js';
import { stampLabel, relativeLabel } from '../core/fmt.js';
import { isEd25519Available } from '../core/ed25519.js';
import { PLATFORM_ORDER, platformName } from '../domain/platforms.js';
import { BRANDS } from '../domain/brands.js';
import {
  PLATFORM_CAPABILITIES,
  CAPABILITY_LABELS,
  capabilityLabel,
  capabilityTone,
  publishMode,
  needsRecheck,
  RECHECK_INTERVAL_DAYS,
} from '../domain/capabilities.js';
import { syncStatus } from '../domain/invariants.js';
import { createEmergencyStop, releaseEmergencyStop } from '../services/api.js';
import { listIssuerKeys, listConsumedIntents, registerIssuerKey, revokeIssuerKey, submitIntent } from '../services/api.js';
import { INTENT_ACTIONS } from '../domain/intent.js';
import { loadSampleMonth } from '../services/api.js';
import { guardedButton, permissionNotice } from './states.js';
import { buildGithubSetupForm } from './connectionSetup.js';

export async function renderConnectionsScreen(app) {
  const { repo } = app.ctx;
  const tz = app.timeZone;
  const nowMs = app.clock.nowMs();

  const accounts = await repo.listSocialAccounts();
  const stops = await repo.activeEmergencyStops();
  const sampleLoadedAt = await repo.getSetting('sample_loaded_at');

  const screen = el('div', { class: 'screen' });
  screen.appendChild(
    el('div', { class: 'screen-head' },
      el('h1', { class: 'screen-title' }, '接続設定'),
      el('p', { class: 'screen-desc' }, 'SNSアカウント・能力・同期状態を管理します。確認できていない機能は無効のままにします。')),
  );

  const notice = permissionNotice(app.state.role, 'connection.manage');
  if (notice) screen.appendChild(notice);

  // URLで届いた意図の結果 (§26)。一度出したら消す。
  const linkResults = app.state.intentResults;
  if (linkResults?.length) {
    app.state.intentResults = null;
    screen.appendChild(
      el('div', { class: linkResults.some((r) => r.tone === 'danger') ? 'notice notice-danger' : 'notice' },
        el('div', null,
          el('div', { class: 'notice-title' }, 'URLで届いた意図を処理しました'),
          ...linkResults.map((r) => el('div', { class: `notice-body tone-${r.tone}` }, r.text)))),
    );
  }

  // --- 緊急停止 ---------------------------------------------------------------
  if (stops.length) {
    screen.appendChild(
      el('div', { class: 'notice notice-danger' },
        el('div', null,
          el('div', { class: 'notice-title' }, `緊急停止中（${stops.length}件）`),
          el('div', { class: 'notice-body' },
            stops.map((s) => `${s.scope_label}：${s.reason}`).join(' / '),
            '　新しい実行は開始しません。台帳・承認・カレンダーはそのまま使えます。')),
        el('div', { class: 'notice-actions' },
          ...stops.map((s) =>
            guardedButton(app, 'emergency.stop', `${s.scope_label} を解除`, {
              class: 'btn btn-sm',
              onClick: async () => {
                await releaseEmergencyStop(app.ctx, s.stop_id, { reason: '運用再開' });
                app.toast('停止を解除しました。');
                await app.refresh();
              },
            })))),
    );
  }

  // --- SNSアカウント ----------------------------------------------------------
  const cards = el('div', { class: 'cards' });
  for (const platform of PLATFORM_ORDER) {
    const entry = PLATFORM_CAPABILITIES[platform];
    const account = accounts.find((a) => a.platform === platform);
    const lastSynced = account?.last_synced_at ? Date.parse(account.last_synced_at) : undefined;
    const sync = syncStatus(lastSynced, nowMs);
    const mode = publishMode(platform);

    cards.appendChild(
      el('div', { class: 'card' },
        el('div', { class: 'card-head' },
          el('h2', { class: 'card-title' }, platformName(platform)),
          el('span', { class: 'card-meta' }, account?.account_name ?? '未接続'),
          el('span', { class: `card-meta tone-${mode.mode === 'DIRECT' ? 'published' : 'attention'}` },
            mode.mode === 'DIRECT' ? '直接投稿：有効' : '直接投稿：無効（手動投稿で運用）')),

        el('dl', { class: 'kv' },
          el('dt', null, '接続状態'),
          el('dd', null, account?.connected ? '接続済み' : '未接続 — 手動投稿で運用します'),
          el('dt', null, '最終同期'),
          el('dd', null, lastSynced
            ? `${stampLabel(lastSynced, tz)}（${relativeLabel(lastSynced, nowMs)}）${sync.stale ? ' — 同期が遅れています' : ''}`
            : 'まだ同期していません'),
          el('dt', null, '認証期限'),
          el('dd', null, account?.credential_expires_at ? stampLabel(Date.parse(account.credential_expires_at), tz) : '—'),
          el('dt', null, '確認日'),
          el('dd', null, `${entry.verifiedAt}（${RECHECK_INTERVAL_DAYS}日ごとに再確認）${needsRecheck(platform, nowMs) ? ' — 再確認の時期です' : ''}`)),

        el('div', { style: { 'margin-top': '12px' } },
          el('div', { class: 'field-label' }, '能力'),
          el('div', { class: 'table-wrap', style: { 'margin-top': '6px' } },
            el('table', null,
              el('tbody', null,
                ...Object.entries(CAPABILITY_LABELS).map(([key, label]) => {
                  const value = entry.capabilities[key];
                  return el('tr', null,
                    el('td', null, label),
                    el('td', null, el('span', { class: `tone-${capabilityTone(value)}` }, capabilityLabel(value))));
                }))))),

        el('div', { style: { 'margin-top': '12px' } },
          el('div', { class: 'field-hint' }, `確認済み：${entry.confirmed}`),
          el('div', { class: 'field-hint' }, `未確認のまま無効：${entry.unknownNote}`),
          el('div', { class: 'field-hint' },
            '一次情報：',
            ...entry.primaryUrls.map((u, i) =>
              el('span', null, i > 0 ? ' / ' : '', el('a', { href: u, target: '_blank', rel: 'noreferrer noopener' }, new URL(u).hostname))))),

        el('div', { class: 'card-actions' },
          guardedButton(app, 'connection.manage', '接続する', {
            class: 'btn btn-sm',
            onClick: () =>
              app.toast(
                `${platformName(platform)} のOAuth接続は次のフェーズで実装します。現在は手動投稿で運用してください。`,
                'error',
              ),
          }),
          guardedButton(app, 'emergency.stop', 'このアカウントを停止', {
            class: 'btn btn-sm btn-danger',
            onClick: async () => {
              const reason = await app.askReason({ title: `${platformName(platform)} を緊急停止`, confirmLabel: '停止する', tone: 'danger' });
              if (!reason) return;
              await createEmergencyStop(app.ctx, { scope: 'ACCOUNT', scopeId: account?.social_account_id ?? `${platform.toLowerCase()}-default`, reason });
              app.toast('停止しました。新しい実行は開始しません。');
              await app.refresh();
            },
          })),
      ),
    );
  }
  screen.appendChild(cards);

  // --- 運用の安全装置 ---------------------------------------------------------
  screen.appendChild(
    el('div', { class: 'card', style: { 'margin-top': '18px' } },
      el('h2', { class: 'card-title' }, '運用の安全装置'),
      el('p', { class: 'field-hint' }, '停止しても、台帳・承認・カレンダーの閲覧と編集は続けられます。'),
      el('div', { class: 'card-actions' },
        guardedButton(app, 'emergency.stop', '全体を緊急停止', {
          class: 'btn btn-danger',
          onClick: async () => {
            const reason = await app.askReason({ title: '全体を緊急停止', message: '停止後は新しい実行を開始しません。', confirmLabel: '停止する', tone: 'danger' });
            if (!reason) return;
            await createEmergencyStop(app.ctx, { scope: 'ALL', reason });
            app.toast('全体を緊急停止しました。');
            await app.refresh();
          },
        }),
        ...BRANDS.map((b) =>
          guardedButton(app, 'emergency.stop', `${b.name}を停止`, {
            class: 'btn',
            onClick: async () => {
              const reason = await app.askReason({ title: `${b.name}を緊急停止`, confirmLabel: '停止する', tone: 'danger' });
              if (!reason) return;
              await createEmergencyStop(app.ctx, { scope: 'BRAND', scopeId: b.id, reason });
              app.toast(`${b.name}を停止しました。`);
              await app.refresh();
            },
          }))),
    ),
  );

  // --- データの保存先 ----------------------------------------------------------
  screen.appendChild(
    el('div', { class: 'card', style: { 'margin-top': '18px' } },
      el('h2', { class: 'card-title' }, 'データの保存先'),
      el('p', { class: 'field-hint' },
        app.ctx.backend === 'github'
          ? 'いまは GitHub の非公開リポジトリに保存しています。スマホでも同じ設定を入れれば同じデータが見えます。'
          : 'いまは このPCのサーバー（npm start）に保存しています。スマホから見るには GitHub 保存へ切り替えます。'),
      buildGithubSetupForm()),
  );

  // --- 外部からの操作の受け口 (§26/§28A) --------------------------------------
  screen.appendChild(await renderGatewayCard(app));

  // --- データ -----------------------------------------------------------------
  screen.appendChild(
    el('div', { class: 'card', style: { 'margin-top': '18px' } },
      el('h2', { class: 'card-title' }, 'データ'),
      el('p', { class: 'field-hint' },
        'このツールはブラウザのIndexedDBだけにデータを保存します。SNSの資格情報は保持しません。'),
      el('div', { class: 'card-actions' },
        button(sampleLoadedAt ? 'サンプルデータを読み込み直す' : 'サンプルデータを読み込む', {
          class: 'btn',
          onClick: async () => {
            const ok = await app.askReason({
              title: 'サンプルデータを読み込む',
              message: '今月ぶんのサンプル投稿を作ります。既存のデータは消えません。理由を記録します。',
              confirmLabel: '読み込む',
              placeholder: '例：動作確認のため',
            });
            if (!ok) return;
            try {
              app.toast('サンプルデータを作成しています…');
              await loadSampleMonth(app.ctx);
              app.toast('サンプルデータを読み込みました。');
              app.go('calendar');
            } catch (e) { app.fail(e); }
          },
        }),
        button('すべて書き出す (JSON)', {
          class: 'btn',
          onClick: async () => {
            const data = await app.ctx.repo.exportAll();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = el('a', { href: URL.createObjectURL(blob), download: `reiki-post-board-${app.todayKey()}.json` });
            a.click();
            URL.revokeObjectURL(a.href);
            app.toast('書き出しました。');
          },
        }),
        app.ctx.backend === 'server'
          ? button('受入ゲートを実行 (G01–G15)', {
              class: 'btn',
              onClick: () => window.open('gates.html', '_blank', 'noopener'),
            })
          : null,
        guardedButton(app, 'connection.manage', 'すべて削除', {
          class: 'btn btn-danger',
          onClick: async () => {
            const reason = await app.askReason({
              title: 'すべてのデータを削除',
              message: 'この端末のIndexedDBを空にします。元に戻せません。先に書き出しておくことをおすすめします。',
              confirmLabel: '削除する',
              tone: 'danger',
            });
            if (!reason) return;
            await app.ctx.repo.clearAll();
            app.toast('削除しました。');
            app.go('calendar');
          },
        })),
    ),
  );

  // --- 次フェーズの説明 -------------------------------------------------------
  screen.appendChild(
    el('div', { class: 'notice', style: { 'margin-top': '18px' } },
      el('div', null,
        el('div', { class: 'notice-title' }, 'いまの版でできること／できないこと'),
        el('div', { class: 'notice-body' },
          'できること：登録・取込・承認・予約・手動投稿・履歴・監査・緊急停止・復元。',
          el('br'),
          'できないこと：SNSへの直接投稿と自動実行（実行CASのfencing・照合ライフサイクル・統合HTTP APIは次のフェーズ）。',
          el('br'),
          `設計書§38のとおり、4SNSとも直接投稿の可否が確認できていないため、能力は無効のままにしています。`)),
  ));

  return screen;
}

const INTENT_STATE_VIEW = Object.freeze({
  COMPLETED: { label: '実行済み', tone: 'published' },
  FAILED: { label: '失敗', tone: 'danger' },
  IN_FLIGHT: { label: '結果未記録 — 要確認', tone: 'attention' },
});

/**
 * §26/§28A 外部からの操作の受け口。
 * 保持するのは発行者の公開鍵だけで、秘密鍵はこのアプリのどこにも保存しない (§19 / G11)。
 */
async function renderGatewayCard(app) {
  const keys = await listIssuerKeys(app.ctx);
  const intents = await listConsumedIntents(app.ctx, { limit: 10 });
  const available = await isEd25519Available();
  const tz = app.timeZone;

  const labelInput = el('input', { type: 'text', placeholder: '例：AIニュース制作スキル' });
  const keyInput = el('input', { type: 'text', placeholder: 'base64url（raw 32バイト）', spellcheck: 'false' });

  const card = el('div', { class: 'card', style: { 'margin-top': '18px' } },
    el('h2', { class: 'card-title' }, '外部からの操作の受け口（Action Gateway）'),
    el('p', { class: 'field-hint' },
      '外部のスキルから状態を変える操作を受けるときは、Ed25519で署名された意図（ActionIntent）だけを受け付けます。',
      el('br'),
      `意図IDは1回しか使えません。同じ意図を何回送っても実行は1回で、2回目からは最初の結果をそのまま返します。`,
      el('br'),
      `受け付ける操作は ${Object.keys(INTENT_ACTIONS).length} 種類（承認・差し戻し・予約変更・取消・手動投稿・緊急停止）です。`),
  );

  if (!available) {
    card.appendChild(
      el('div', { class: 'notice notice-danger', style: { 'margin-top': '12px' } },
        el('div', null,
          el('div', { class: 'notice-title' }, 'この環境では Ed25519 を使えません'),
          el('div', { class: 'notice-body' },
            'ブラウザのWebCryptoが Ed25519 に対応していないため、署名を検証できません。'
            + '新しいバージョンのChrome / Edge で開いてください。鍵の登録はできません。'))),
    );
  }

  // --- 登録済みの発行者 -------------------------------------------------------
  card.appendChild(
    el('div', { style: { 'margin-top': '14px' } },
      el('div', { class: 'field-label' }, `登録済みの発行者（${keys.filter((k) => k.active).length}件が有効）`),
      keys.length === 0
        ? el('p', { class: 'field-hint' }, 'まだ登録がありません。公開鍵を登録するまで、外部からの操作はすべて拒否されます。')
        : el('div', { class: 'table-wrap', style: { 'margin-top': '6px' } },
            el('table', null,
              el('thead', null,
                el('tr', null,
                  el('th', null, '名前'),
                  el('th', null, '鍵ID'),
                  el('th', null, '登録'),
                  el('th', null, '状態'),
                  el('th', null, ''))),
              el('tbody', null,
                ...keys.map((k) =>
                  el('tr', null,
                    el('td', null, k.label),
                    el('td', null, el('code', null, `${k.keyId.slice(0, 16)}…`)),
                    el('td', null, stampLabel(Date.parse(k.registeredAt), tz)),
                    el('td', null,
                      el('span', { class: `tone-${k.active ? 'published' : 'danger'}` },
                        k.active ? '有効' : `失効（${k.revokedReason ?? '理由なし'}）`)),
                    el('td', null,
                      k.active
                        ? guardedButton(app, 'connection.manage', '失効させる', {
                            class: 'btn btn-sm btn-danger',
                            onClick: async () => {
                              const reason = await app.askReason({
                                title: `${k.label} の鍵を失効`,
                                message: '失効すると、失効前に署名された意図もすべて拒否されます。',
                                confirmLabel: '失効させる',
                                tone: 'danger',
                              });
                              if (!reason) return;
                              try {
                                await revokeIssuerKey(app.ctx, k.keyId, { reason });
                                app.toast('鍵を失効させました。');
                                await app.refresh();
                              } catch (e) { app.fail(e); }
                            },
                          })
                        : null))))))),
  );

  // --- 追加 -------------------------------------------------------------------
  card.appendChild(
    el('div', { style: { 'margin-top': '14px' } },
      field('発行者の名前', labelInput, { required: true }),
      field('公開鍵', keyInput, {
        required: true,
        hint: '鍵の作り方： node scripts/make-issuer-key.mjs — 公開鍵だけをここに貼り、秘密鍵は呼び出し側で保管してください。',
      }),
      el('div', { class: 'card-actions' },
        guardedButton(app, 'connection.manage', '公開鍵を登録する', {
          class: 'btn btn-primary',
          disabled: !available,
          onClick: async () => {
            try {
              const { keyId } = await registerIssuerKey(app.ctx, {
                publicKey: keyInput.value.trim(),
                label: labelInput.value,
              });
              app.toast(`登録しました（鍵ID ${keyId.slice(0, 16)}…）`);
              await app.refresh();
            } catch (e) { app.fail(e); }
          },
        }))),
  );

  // --- 意図を読み込む ---------------------------------------------------------
  const intentFile = el('input', { type: 'file', accept: '.json,application/json' });
  const intentPaste = el('textarea', {
    placeholder: '署名済みのActionIntent（JSON）。複数まとめて実行するなら配列で渡せます。',
    spellcheck: 'false',
  });
  const resultBox = el('div', { style: { 'margin-top': '10px' } });
  const intentsBox = el('div', null, intentsTable(intents, tz));

  async function runIntents(text) {
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      replace(resultBox, el('p', { class: 'tone-danger' }, `JSONとして読めません：${error.message}`));
      return;
    }
    const list = Array.isArray(payload) ? payload : [payload];
    const lines = [];
    for (const envelope of list) {
      try {
        const out = await submitIntent(app.ctx, envelope);
        const label = INTENT_ACTIONS[out.action]?.label ?? out.action;
        lines.push(el('div', { class: `tone-${out.replayed ? 'attention' : 'published'}` },
          out.replayed ? `${label}：この意図はすでに実行済みです。前回の結果を返しました。` : `${label}：実行しました。`));
      } catch (error) {
        lines.push(el('div', { class: 'tone-danger' }, `${error.code ?? 'ERROR'}：${error.message}`));
      }
    }
    replace(resultBox, ...lines);
    // 業務データが動いているので、受理の一覧をその場で入れ替える。
    replace(intentsBox, intentsTable(await listConsumedIntents(app.ctx, { limit: 10 }), tz));
  }

  card.appendChild(
    el('div', { style: { 'margin-top': '18px' } },
      el('div', { class: 'field-label' }, '意図を読み込む'),
      el('p', { class: 'field-hint' },
        'スキルが作った署名済みJSONを渡します。',
        el('code', null, ' node scripts/sign-intent.mjs '),
        'で作れます。',
        el('br'),
        '操作は封筒に書かれた実行者の権限で走ります。読み込む人の役割は関係ありません（authorityは署名側にあります）。'),
      field('ファイルから', intentFile),
      field('貼り付けから', intentPaste),
      el('div', { class: 'card-actions' },
        button('読み込んで実行する', {
          class: 'btn btn-primary',
          disabled: !available,
          onClick: async () => {
            const file = intentFile.files?.[0];
            const text = file ? await file.text() : intentPaste.value.trim();
            if (!text) {
              replace(resultBox, el('p', { class: 'tone-danger' }, 'ファイルを選ぶか、JSONを貼り付けてください。'));
              return;
            }
            await runIntents(text);
          },
        })),
      resultBox),
  );

  // --- 受理した意図 -----------------------------------------------------------
  card.appendChild(
    el('div', { style: { 'margin-top': '14px' } },
      el('div', { class: 'field-label' }, '最近受理した意図'),
      intentsBox),
  );

  return card;
}

function intentsTable(intents, tz) {
  if (intents.length === 0) {
    return el('p', { class: 'field-hint' }, 'まだ受理した意図はありません。');
  }
  return el('div', { class: 'table-wrap', style: { 'margin-top': '6px' } },
    el('table', null,
      el('thead', null,
        el('tr', null,
          el('th', null, '受理'),
          el('th', null, '操作'),
          el('th', null, '発行者'),
          el('th', null, '実行者'),
          el('th', null, '結果'))),
      el('tbody', null,
        ...intents.map((i) => {
          const view = INTENT_STATE_VIEW[i.state] ?? { label: i.state, tone: 'neutral' };
          return el('tr', null,
            el('td', null, stampLabel(Date.parse(i.consumed_at), tz)),
            el('td', null, INTENT_ACTIONS[i.action]?.label ?? i.action),
            el('td', null, i.issuer_label),
            el('td', null, i.actor_user_id),
            el('td', null,
              el('span', { class: `tone-${view.tone}` }, view.label),
              i.error ? el('div', { class: 'field-hint' }, `${i.error.code}：${i.error.message}`) : null));
        }))));
}
