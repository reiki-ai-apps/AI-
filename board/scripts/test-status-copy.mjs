import test from 'node:test';
import assert from 'node:assert/strict';

import { blockerSummary, productionOverview, reservationOverview, channelBrief } from '../js/ui/statusView.js';

test('長い運用メッセージを短い行動文へ変換する', () => {
  assert.deepEqual(blockerSummary({ id: 'news-primary-source-quorum' }), {
    title: '次回ニュース',
    action: '新しい公式情報が3件そろうまで待機',
  });
  assert.equal(channelBrief({ id: 'youtube', state: 'ATTENTION', reservation_state: 'COVERED' }), 'Shortsの公開結果を確認');
});

test('次回制作を進捗と次の確認時刻だけで要約する', () => {
  assert.deepEqual(productionOverview({
    cadence: 'PT6H',
    last_run: { verified_primary_count: 0, required_primary_count: 3 },
  }), {
    headline: '新しい公式情報を確認中',
    progress: '0 / 3件',
    next: '次の確認：6時間後',
  });
});

test('今日から2日先まで1日でも未予約なら危険にする', () => {
  assert.deepEqual(reservationOverview({
    horizon_days: 2,
    days: [
      { date: '2026-08-16', state: 'RESERVED' },
      { date: '2026-08-17', state: 'MISSING' },
      { date: '2026-08-18', state: 'RESERVED' },
    ],
  }), {
    complete: false,
    missingCount: 1,
    headline: '危険：1日分が未予約です',
    instruction: '今日・明日・2日後の予約をすべて完了してください。',
    days: [
      { label: '今日', date: '8/16', reserved: true },
      { label: '明日', date: '8/17', reserved: false },
      { label: '2日後', date: '8/18', reserved: true },
    ],
  });
  assert.equal(channelBrief({ reservation_state: 'MISSING' }), '危険：2日先まで予約されていません');
});
