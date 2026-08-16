import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReservationPlan } from '../js/domain/reservationPlan.js';
import { blockerSummary, productionOverview, channelBrief } from '../js/ui/statusView.js';

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

test('3日分を投稿名・媒体・予約・承認待ち・未準備へ分ける', () => {
  const plan = buildReservationPlan({
    todayKey: '2026-08-17',
    posts: [
      {
        channel_post_id: 'post-approval',
        post_group_id: 'group-approval',
        brand_id: 'creative',
        platform: 'X',
        title: '短い題名',
        scheduled_at: '2026-08-17T03:00:00.000Z',
        calendar_date_key: '2026-08-17',
        display_state: 'DRAFT',
      },
      {
        channel_post_id: 'post-scheduled',
        post_group_id: 'group-scheduled',
        brand_id: 'news',
        platform: 'YOUTUBE',
        title: '予約済みニュース',
        scheduled_at: '2026-08-17T10:00:00.000Z',
        calendar_date_key: '2026-08-17',
        display_state: 'SCHEDULED',
      },
      {
        channel_post_id: 'post-approval-actual',
        post_group_id: 'group-approval-actual',
        brand_id: 'news',
        platform: 'INSTAGRAM',
        title: '本当に承認待ちの投稿',
        scheduled_at: '2026-08-17T11:00:00.000Z',
        calendar_date_key: '2026-08-17',
        display_state: 'PENDING_APPROVAL',
      },
    ],
    postGroups: [
      { post_group_id: 'group-approval', brand_id: 'creative', project_title: '承認してほしい投稿' },
      { post_group_id: 'group-scheduled', brand_id: 'news', project_title: '予約済みニュース' },
      { post_group_id: 'group-approval-actual', brand_id: 'news', project_title: '本当に承認待ちの投稿' },
    ],
    publicationPackages: [{
      post_group_id: 'group-approval',
      status: 'ACCEPTED',
      quality_reviews: [
        { review_type: 'X_CONTRACT', verdict: 'PASS' },
        { review_type: 'HUMAN_APPROVAL', verdict: 'EVIDENCE_MISSING' },
      ],
    }],
  });

  assert.equal(plan.complete, false);
  assert.deepEqual(plan.days.map((day) => day.dateKey), ['2026-08-17', '2026-08-18', '2026-08-19']);
  assert.deepEqual(plan.days[0].counts, { CREATING: 0, READY: 1, APPROVAL: 1, SCHEDULED: 1 });
  assert.equal(plan.days[0].items[0].title, '承認してほしい投稿');
  assert.equal(plan.days[0].items[0].stage, 'READY');
  assert.equal(plan.days[0].items[2].stage, 'APPROVAL');
  assert.equal(plan.days[1].items.length, 0);
  assert.equal(plan.totals.UNPLANNED_DAYS, 2);
  assert.equal(channelBrief({ reservation_state: 'MISSING' }), '危険：2日先まで予約されていません');
});
