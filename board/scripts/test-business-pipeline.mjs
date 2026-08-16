import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeBusinessPipeline } from '../js/ui/businessPipelinePanel.js';

test('別事業を分離し、日付・媒体ごとに制作中、確認待ち、予約済みを数える', () => {
  const postGroups = [
    { post_group_id: 'news-group', brand_id: 'news', source_skill: 'ai_news_v1' },
    { post_group_id: 'creative-group', brand_id: 'creative', source_skill: 'ai_creative_v1' },
  ];
  const publicationPackages = [{
    post_group_id: 'creative-group',
    status: 'ACCEPTED',
    quality_reviews: [
      { review_type: 'X_CONTRACT', verdict: 'PASS' },
      { review_type: 'HUMAN_APPROVAL', verdict: 'EVIDENCE_MISSING' },
    ],
  }];
  const posts = [
    {
      post_group_id: 'news-group', brand_id: 'news', platform: 'YOUTUBE', display_state: 'DRAFT',
      calendar_date_key: '2026-08-16', internal: { tags: ['production-run'] },
      production: { steps: [{ done: false }] },
    },
    {
      post_group_id: 'creative-group', brand_id: 'creative', platform: 'X', display_state: 'DRAFT',
      calendar_date_key: '2026-08-17', internal: { tags: [] },
    },
    {
      post_group_id: 'creative-group', brand_id: 'creative', platform: 'INSTAGRAM', display_state: 'SCHEDULED',
      calendar_date_key: '2026-08-18', internal: { tags: [] },
    },
  ];

  const summary = summarizeBusinessPipeline({ posts, postGroups, publicationPackages });
  assert.deepEqual(summary.map((business) => business.id), ['news', 'creative']);

  const news = summary[0];
  assert.equal(news.days[0].dateKey, 'UNSCHEDULED');
  assert.equal(news.days[0].platforms.YOUTUBE.CREATING, 1);

  const creative = summary[1];
  assert.equal(creative.days[0].dateKey, '2026-08-17');
  assert.equal(creative.days[0].platforms.X.APPROVAL, 1);
  assert.equal(creative.days[1].platforms.INSTAGRAM.SCHEDULED, 1);
});

