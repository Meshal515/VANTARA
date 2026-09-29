import { expect, it } from 'vitest';
import { createActiveClock } from './reader-core.js';
import { duration } from './insights.js';

it('credits the visible interval before hiding, excludes hidden time and keeps short visits', () => {
  let now = 0;
  const clock = createActiveClock(() => now);
  const work = { activeMs: 0 };
  clock.sample(work);
  now = 2300; clock.sample(null);
  now = 62300; clock.sample(work);
  now = 66000; clock.sample(null);
  expect(work.activeMs).toBe(6000);
});
it('periodic samples count a full minute without scrolling and do not double credit a flush', () => {
  let now = 0;
  const clock = createActiveClock(() => now);
  const work = { activeMs: 0 };
  clock.sample(work);
  for (now = 10000; now <= 60000; now += 10000) clock.sample(work);
  now = 60000; clock.sample(null); clock.sample(null);
  expect(work.activeMs).toBe(60000);
});
it('chapter loading is excluded and time stays attributed to its chapter', () => {
  let now = 0;
  const clock = createActiveClock(() => now);
  const first = { activeMs: 0 }, next = { activeMs: 0 };
  clock.sample(first);
  now = 1500; clock.sample(null);
  now = 9000; clock.sample(next);
  now = 11250; clock.sample(null);
  expect([first.activeMs, next.activeMs]).toEqual([1500, 2250]);
});
it('displays minutes, with a truthful subminute value', () => {
  expect(duration(0)).toBe('0 د');
  expect(duration(2300)).toBe('أقل من دقيقة');
  expect(duration(65000)).toBe('1 د');
  expect(duration(58320000)).toBe('16 س 12 د');
});
