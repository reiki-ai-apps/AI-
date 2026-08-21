import assert from 'node:assert/strict';
import test from 'node:test';

import { systemClock } from '../js/core/clock.js';
import { openPublicDatabase } from '../js/store/publicdb.js';
import { Repo } from '../js/store/repo.js';

test('公開DBは認証なしで読み取れ、書き込みを拒否する', async () => {
  const snapshot = {
    stores: {
      channelPosts: [{ channel_post_id: 'post-1', title: '公開予定' }],
    },
  };
  const url = `data:application/json,${encodeURIComponent(JSON.stringify(snapshot))}`;
  const db = await openPublicDatabase(url);

  const posts = await db.read(['channelPosts'], (tx) => tx.getAll('channelPosts'));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].title, '公開予定');
  await assert.rejects(() => db.write(['channelPosts'], () => {}), { code: 'READ_ONLY' });
});

test('状況画面用一覧は公開済み投稿を完了数の集計対象に残す', async () => {
  const snapshot = {
    stores: {
      channelPosts: [
        { channel_post_id: 'published', display_state: 'PUBLISHED', calendar_date_key: '2026-08-22', deleted_at: null, cancelled_at: null },
        { channel_post_id: 'pending', display_state: 'SCHEDULED', calendar_date_key: '2026-08-22', deleted_at: null, cancelled_at: null },
      ],
    },
  };
  const url = `data:application/json,${encodeURIComponent(JSON.stringify(snapshot))}`;
  const repo = new Repo(await openPublicDatabase(url), systemClock('Asia/Tokyo'));

  const posts = await repo.listPostsForReservationPlan();
  assert.deepEqual(posts.map((post) => post.channel_post_id), ['published', 'pending']);
});
