import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWeekView, rollingWeekStartKey } from '../js/domain/calendar.js';

test('今日を起点に6日後までを同じ7日表示にする', () => {
  const today = '2026-08-16';
  assert.equal(rollingWeekStartKey(today, today), today);
  assert.equal(rollingWeekStartKey('2026-08-22', today), today);
  assert.equal(rollingWeekStartKey('2026-08-23', today), '2026-08-23');
  assert.equal(rollingWeekStartKey('2026-08-15', today), '2026-08-09');
});

test('週表示は指定した今日から7日間を返す', () => {
  const view = buildWeekView({
    startDateKey: '2026-08-16',
    todayKey: '2026-08-16',
    timeZone: 'Asia/Tokyo',
  });

  assert.equal(view.startDateKey, '2026-08-16');
  assert.equal(view.endDateKey, '2026-08-22');
  assert.deepEqual(view.days.map((day) => day.dateKey), [
    '2026-08-16',
    '2026-08-17',
    '2026-08-18',
    '2026-08-19',
    '2026-08-20',
    '2026-08-21',
    '2026-08-22',
  ]);
});
