import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReservationPlan } from '../js/domain/reservationPlan.js';
import {
  blockerSummary,
  productionOverview,
  channelBrief,
  badgeProgressSummary,
  planDayResultLabel,
} from '../js/ui/statusView.js';

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
      {
        channel_post_id: 'post-published',
        post_group_id: 'group-published',
        brand_id: 'news',
        platform: 'NOTE',
        title: '公開済みの記事',
        scheduled_at: '2026-08-17T02:00:00.000Z',
        calendar_date_key: '2026-08-17',
        display_state: 'PUBLISHED',
      },
    ],
    postGroups: [
      { post_group_id: 'group-approval', brand_id: 'creative', project_title: '承認してほしい投稿' },
      {
        post_group_id: 'group-scheduled',
        brand_id: 'news',
        project_title: '予約済みニュース',
        internal: { tags: ['external-schedule-verified'] },
      },
      { post_group_id: 'group-approval-actual', brand_id: 'news', project_title: '本当に承認待ちの投稿' },
      { post_group_id: 'group-published', brand_id: 'news', project_title: '公開済みの記事' },
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
  assert.deepEqual(plan.days[0].counts, {
    CREATING: 0,
    READY: 1,
    APPROVAL: 1,
    CONNECTION_REQUIRED: 0,
    EXTERNAL_PENDING: 0,
    SCHEDULED: 1,
  });
  assert.equal(plan.days[0].publishedCount, 1);
  assert.equal(plan.days[0].items[0].stage, 'PUBLISHED');
  assert.equal(plan.days[0].items[1].title, '承認してほしい投稿');
  assert.equal(plan.days[0].items[1].stage, 'READY');
  assert.equal(plan.days[0].items[3].stage, 'APPROVAL');
  assert.equal(plan.totals.PUBLISHED, 1);
  assert.equal(planDayResultLabel(plan.days[0]), '1済');
  assert.equal(plan.days[1].items.length, 0);
  assert.equal(plan.totals.UNPLANNED_DAYS, 2);
  assert.equal(channelBrief({ reservation_state: 'MISSING' }), '危険：2日先まで予約されていません');
});

test('金曜日は本編を必要としShortsを要求しない', () => {
  const plan = buildReservationPlan({ todayKey: '2026-08-21' });
  assert.equal(plan.days[0].requirements.YOUTUBE, 1);
  assert.equal(plan.days[0].requirements.YOUTUBE_SHORTS, 0);
  assert.equal(plan.days[0].requirements.NOTE, 2);
  assert.equal(plan.days[0].requirements.X, 2);
  assert.equal(plan.days[0].requirements.INSTAGRAM, 2);
});

test('内部予定だけのSCHEDULEDは外部予約待ちで予約完了に数えない', () => {
  const plan = buildReservationPlan({
    todayKey: '2026-08-21',
    posts: [{
      channel_post_id: 'internal-only',
      post_group_id: 'group-internal-only',
      brand_id: 'news',
      platform: 'YOUTUBE',
      scheduled_at: '2026-08-21T10:00:00.000Z',
      calendar_date_key: '2026-08-21',
      display_state: 'SCHEDULED',
    }],
    postGroups: [{ post_group_id: 'group-internal-only', brand_id: 'news' }],
  });
  assert.equal(plan.days[0].items[0].stage, 'EXTERNAL_PENDING');
  assert.equal(plan.days[0].counts.EXTERNAL_PENDING, 1);
  assert.equal(plan.days[0].counts.SCHEDULED, 0);
  assert.equal(plan.days[0].complete, false);
});

test('媒体カードは完了数と未完了分の現在地を別々に示す', () => {
  const note = { platform: 'NOTE', required: 2 };
  const mixed = badgeProgressSummary([
    { platform: 'NOTE', stage: 'PUBLISHED' },
    { platform: 'NOTE', stage: 'APPROVAL' },
  ], note);
  assert.equal(mixed.mark, '1/2');
  assert.equal(mixed.confirmed, 1);
  assert.deepEqual(mixed.progress.map((part) => part.label), ['承認待ち 1']);

  const empty = badgeProgressSummary([], note);
  assert.equal(empty.mark, '0/2');
  assert.deepEqual(empty.progress.map((part) => part.label), ['未登録 2']);

  const split = badgeProgressSummary([
    { platform: 'NOTE', stage: 'CREATING' },
    { platform: 'NOTE', stage: 'EXTERNAL_PENDING' },
  ], note);
  assert.equal(split.mark, '0/2');
  assert.deepEqual(split.progress.map((part) => part.label), ['制作中 1', '予約待ち 1']);
});

test('承認済みでSNS接続だけがない投稿は承認待ちに戻さない', () => {
  const plan = buildReservationPlan({
    todayKey: '2026-08-22',
    posts: [{
      channel_post_id: 'x-approved-needs-connection',
      post_group_id: 'x-approved-needs-connection-group',
      brand_id: 'news',
      platform: 'X',
      scheduled_at: '2026-08-22T00:15:00.000Z',
      calendar_date_key: '2026-08-22',
      display_state: 'ACTION_REQUIRED',
      failure_kind: 'CREDENTIAL_EXPIRED',
      approval_id: 'approval-current-revision',
    }],
    postGroups: [{ post_group_id: 'x-approved-needs-connection-group', brand_id: 'news' }],
  });
  assert.equal(plan.days[0].counts.CONNECTION_REQUIRED, 1);
  assert.equal(plan.days[0].counts.APPROVAL, 0);
  assert.equal(plan.days[0].items[0].stage, 'CONNECTION_REQUIRED');

  const summary = badgeProgressSummary(plan.days[0].items, { platform: 'X', required: 2 });
  assert.deepEqual(summary.progress.map((part) => part.label), ['未登録 1', '接続のみ 1']);
});

test('note・X・Instagramは各2件の外部確定で日次達成になる', () => {
  const posts = [];
  const groups = [];
  for (const platform of ['NOTE', 'X', 'INSTAGRAM']) {
    for (let index = 1; index <= 2; index += 1) {
      const groupId = `${platform}-${index}`;
      groups.push({ post_group_id: groupId, brand_id: 'news', internal: { tags: ['external-schedule-verified'] } });
      posts.push({
        channel_post_id: `post-${groupId}`,
        post_group_id: groupId,
        brand_id: 'news',
        platform,
        scheduled_at: `2026-08-21T0${index}:00:00.000Z`,
        calendar_date_key: '2026-08-21',
        display_state: 'SCHEDULED',
      });
    }
  }
  groups.push({ post_group_id: 'youtube-main', brand_id: 'news', internal: { tags: ['external-schedule-verified'] } });
  posts.push({
    channel_post_id: 'youtube-main',
    post_group_id: 'youtube-main',
    brand_id: 'news',
    platform: 'YOUTUBE',
    scheduled_at: '2026-08-21T10:00:00.000Z',
    calendar_date_key: '2026-08-21',
    display_state: 'SCHEDULED',
  });
  const plan = buildReservationPlan({ todayKey: '2026-08-21', posts, postGroups: groups });
  assert.equal(plan.days[0].complete, true);
  assert.equal(plan.days[0].coverage.NOTE.confirmed, 2);
  assert.equal(plan.days[0].coverage.X.confirmed, 2);
  assert.equal(plan.days[0].coverage.INSTAGRAM.confirmed, 2);
});
