import test from 'node:test';
import assert from 'node:assert/strict';

import { publicApprovalRoute } from '../js/ui/approvalsView.js';

const group = { project_title: '確認用企画' };
const post = {
  channel_post_id: 'post-1',
  current_revision_id: 'revision-1',
  platform: 'NOTE',
  social_account_id: 'note-default',
  scheduled_at: '2026-08-23T03:00:00.000Z',
  time_zone: 'Asia/Tokyo',
};
const revision = {
  revision_id: 'revision-1',
  revision_no: 6,
  title: '確認用タイトル',
  body: '確認用本文',
  hashtags: [],
  cta: '',
  visibility: 'PUBLIC',
  rights: { confirmed: true, rights_status: 'CONFIRMED', sources: [] },
  assets: [],
};

test('registered browser keeps the one-tap gateway approval route', async () => {
  const route = await publicApprovalRoute({
    group, post, revision, componentScope: 'CONTENT', deviceReady: true,
  });
  assert.deepEqual(route, { kind: 'gateway', href: null });
});

test('browser without a device key falls back to revision-bound GitHub approval', async () => {
  const route = await publicApprovalRoute({
    group, post, revision, componentScope: 'CONTENT', deviceReady: false,
  });
  assert.equal(route.kind, 'github');
  const url = new URL(route.href);
  assert.equal(url.origin, 'https://github.com');
  assert.equal(url.pathname, '/reiki-ai-apps/AI-/issues/new');
  const body = url.searchParams.get('body');
  assert.match(body, /REIKI_POST_BOARD_APPROVAL_V1/);
  assert.match(body, /revision-1/);
  assert.match(body, /CONTENT/);
});
