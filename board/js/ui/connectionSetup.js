// GitHub接続の設定フォーム。
// 初回起動（Pagesで開いたが設定が無い）と、接続設定の「データの保存先」カードの両方で使う。

import { el, button, field } from '../core/dom.js';
import { loadConnection, saveConnection, clearConnection } from '../store/backend.js';
import { testGithubConnection } from '../store/githubdb.js';

/**
 * @param {{onSaved?:()=>void, compact?:boolean}} options
 */
export function buildGithubSetupForm({ onSaved } = {}) {
  const current = loadConnection();

  const ownerInput = el('input', { type: 'text', value: current?.owner ?? 'reiki-ai-apps', spellcheck: 'false' });
  const repoInput = el('input', { type: 'text', value: current?.repo ?? 'reiki-post-board-data', spellcheck: 'false' });
  const branchInput = el('input', { type: 'text', value: current?.branch ?? 'main', spellcheck: 'false' });
  const tokenInput = el('input', {
    type: 'password',
    value: current?.token ?? '',
    placeholder: 'github_pat_…',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const status = el('p', { class: 'field-hint', role: 'status' });

  const readForm = () => ({
    owner: ownerInput.value.trim(),
    repo: repoInput.value.trim(),
    branch: branchInput.value.trim() || 'main',
    token: tokenInput.value.trim(),
  });

  const form = el('div', null,
    el('p', { class: 'field-hint' },
      'データは自分のGitHubの非公開リポジトリに保存します。準備は2つだけ：',
      el('br'),
      '① github.com/new で非公開リポジトリを作る（例：reiki-post-board-data）',
      el('br'),
      '② Settings → Developer settings → Fine-grained tokens でトークンを作る',
      el('br'),
      '　（対象＝そのリポジトリだけ、Permissions は Contents: Read and write）'),
    field('リポジトリの持ち主（ユーザー名または組織名）', ownerInput, { required: true }),
    field('リポジトリ名', repoInput, { required: true }),
    field('ブランチ', branchInput, { hint: 'ふつうは main のまま' }),
    field('アクセストークン', tokenInput, {
      required: true,
      hint: 'この端末の中だけに保存します。リポジトリ側には保存されません。',
    }),
    el('div', { class: 'card-actions' },
      button('接続して保存する', {
        class: 'btn btn-primary',
        onClick: async () => {
          const config = readForm();
          if (!config.owner || !config.repo || !config.token) {
            status.textContent = '持ち主・リポジトリ名・トークンをすべて入れてください。';
            return;
          }
          status.textContent = '接続を確認しています…';
          try {
            const check = await testGithubConnection(config);
            saveConnection(config);
            status.textContent = check.empty
              ? '接続できました。データはまだ空です。保存して読み込み直します…'
              : `接続できました（${check.records}件のデータ）。読み込み直します…`;
            if (onSaved) onSaved();
            else location.reload();
          } catch (error) {
            status.textContent = `接続できません：${error.message}`;
          }
        },
      }),
      current
        ? button('この端末の接続設定を消す', {
            class: 'btn btn-danger',
            onClick: () => {
              clearConnection();
              location.reload();
            },
          })
        : null),
    status,
  );
  return form;
}
