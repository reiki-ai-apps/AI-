// データ保存先の設定フォーム。
// 初回起動（Pagesで開いたが設定が無い）と、接続設定の「データの保存先」カードの両方で使う。
//
// 見せ方の方針（利用者の指示「分かりにくい」への対応）:
//   ・専門用語（リポジトリ・トークン・ブランチ）を前面に出さない
//   ・「①押す ②押す ③貼る」の3手順だけにする
//   ・保存場所の名前は決め打ちにして、変えたい人だけ「詳しい設定」を開く

import { el, button, field } from '../core/dom.js';
import { loadConnection, saveConnection, clearConnection } from '../store/backend.js';
import { testGithubConnection } from '../store/githubdb.js';

const DEFAULTS = Object.freeze({
  owner: 'reiki-ai-apps',
  repo: 'reiki-post-board-data',
  branch: 'main',
});

/**
 * @param {{onSaved?:()=>void}} options
 */
export function buildGithubSetupForm({ onSaved } = {}) {
  const current = loadConnection();

  const ownerInput = el('input', { type: 'text', value: current?.owner ?? DEFAULTS.owner, spellcheck: 'false' });
  const repoInput = el('input', { type: 'text', value: current?.repo ?? DEFAULTS.repo, spellcheck: 'false' });
  const branchInput = el('input', { type: 'text', value: current?.branch ?? DEFAULTS.branch, spellcheck: 'false' });
  const tokenInput = el('input', {
    type: 'password',
    value: current?.token ?? '',
    placeholder: 'github_pat_ で始まる文字列',
    autocomplete: 'off',
    spellcheck: 'false',
    style: { 'font-size': '16px' }, // スマホで自動ズームさせない
  });
  const status = el('p', { class: 'field-hint', role: 'status', 'aria-live': 'polite' });

  const readForm = () => ({
    owner: ownerInput.value.trim() || DEFAULTS.owner,
    repo: repoInput.value.trim() || DEFAULTS.repo,
    branch: branchInput.value.trim() || DEFAULTS.branch,
    token: tokenInput.value.trim(),
  });

  const stepBox = (number, title, ...children) =>
    el('div', { class: 'setup-step' },
      el('div', { class: 'setup-step-head' },
        el('span', { class: 'setup-step-no' }, number),
        el('span', { class: 'setup-step-title' }, title)),
      el('div', { class: 'setup-step-body' }, ...children));

  const openButton = (label, url) =>
    button(label, {
      class: 'btn btn-primary',
      onClick: () => window.open(url, '_blank', 'noopener'),
    });

  // すでに設定済みなら、手順は畳んで「いまの状態」を先に見せる
  const configured = Boolean(current);

  const form = el('div', null,
    configured
      ? el('p', { class: 'field-hint' },
          `設定済み：${current.owner}／${current.repo} に保存しています。`,
          el('br'),
          '別の端末（スマホなど）でも使うには、同じ鍵をその端末で1回貼ってください。')
      : el('p', null,
          'データはあなたのGitHubの中の、',
          el('strong', null, '自分だけが見られる場所'),
          'に保存します。',
          el('br'),
          '下の3つを上から順にやってください（合計3分・1回だけ）。'),

    configured ? null : stepBox('1', '保存場所を作る',
      el('p', { class: 'field-hint' },
        'ボタンを押すと作成ページが開きます。開いたら',
        el('strong', null, ' Private を選んで'),
        '、緑の Create repository を押すだけ。名前は最初から入っています。'),
      openButton('保存場所の作成ページを開く', `https://github.com/new?owner=${DEFAULTS.owner}&name=${DEFAULTS.repo}&visibility=private`)),

    configured ? null : stepBox('2', '合鍵を作る',
      el('p', { class: 'field-hint' },
        'ボタンを押すと鍵の作成ページが開きます。開いたら次の3つだけ：',
        el('br'), '・Repository access → Only select repositories → ', el('code', null, DEFAULTS.repo), ' を選ぶ',
        el('br'), '・Permissions → Repository permissions → Contents を ', el('strong', null, 'Read and write'), ' にする',
        el('br'), '・いちばん下の緑の Generate token を押す → ', el('strong', null, '緑色の文字列が出るのでコピー')),
      openButton('合鍵の作成ページを開く', 'https://github.com/settings/personal-access-tokens/new')),

    stepBox(configured ? '鍵' : '3', configured ? '鍵を貼り直す' : 'コピーした合鍵をここに貼る',
      field('合鍵', tokenInput, {
        required: !configured,
        hint: 'この端末の中だけに保存します。ほかの誰かに送られることはありません。',
      }),
      el('div', { class: 'card-actions' },
        button(configured ? '保存し直す' : '貼ったら押す — 接続して始める', {
          class: 'btn btn-primary',
          onClick: async () => {
            const config = readForm();
            if (!config.token) {
              status.textContent = '合鍵（github_pat_ で始まる文字列）を貼ってください。';
              return;
            }
            status.textContent = '接続を確認しています…';
            try {
              const check = await testGithubConnection(config);
              saveConnection(config);
              status.textContent = check.empty
                ? '接続できました。読み込み直します…'
                : `接続できました（${check.records}件のデータ）。読み込み直します…`;
              if (onSaved) onSaved();
              else location.reload();
            } catch (error) {
              status.textContent = `接続できません：${error.message}`;
            }
          },
        }),
        current
          ? button('この端末の設定を消す', {
              class: 'btn btn-danger',
              onClick: () => {
                clearConnection();
                location.reload();
              },
            })
          : null),
      status),

    // 変えたい人だけ開く。ふつうは触らない。
    el('details', { style: { 'margin-top': '10px' } },
      el('summary', { class: 'field-hint' }, '詳しい設定（保存場所の名前を変えたい場合だけ）'),
      field('保存場所の持ち主', ownerInput),
      field('保存場所の名前', repoInput),
      field('ブランチ', branchInput, { hint: 'ふつうは main のまま' })),
  );
  return form;
}
