import assert from 'node:assert/strict';
import test from 'node:test';

import { progressStageSummary } from '../js/ui/progressPanel.js';

test('投稿工程を制作中・完成・確認待ち・予約済み・投稿済み・要対応へ集計する', () => {
  const posts = [
    { display_state: 'DRAFT', production: { steps: [{ done: false }] } },
    { display_state: 'DRAFT', production: { steps: [{ done: true }] } },
    { display_state: 'PENDING_APPROVAL' },
    { display_state: 'SCHEDULED' },
    { display_state: 'PUBLISHED' },
    { display_state: 'ACTION_REQUIRED' },
  ];
  const counts = Object.fromEntries(progressStageSummary(posts).map((stage) => [stage.id, stage.count]));
  assert.deepEqual(counts, {
    WORKING: 1,
    COMPLETE: 1,
    PENDING_APPROVAL: 1,
    SCHEDULED: 1,
    PUBLISHED: 1,
    ACTION_REQUIRED: 1,
  });
});
