import assert from 'node:assert/strict';
import test from 'node:test';

import { openPublicDatabase } from '../js/store/publicdb.js';

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
