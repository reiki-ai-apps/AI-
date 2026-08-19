import test from 'node:test';
import assert from 'node:assert/strict';

import * as api from '../js/services/api.js?v=2';

test('承認画面が記事・動画とサムネイルの確認APIを利用できる', () => {
  assert.equal(typeof api.verifyComponentApprovals, 'function');
  assert.equal(typeof api.recordComponentApproval, 'function');
});
