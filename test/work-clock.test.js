import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkClock } from '../public/view/work-clock.js';

// How long each thing has been at work, by its key: counted from when it was first seen at work, so a row drawn again
// goes on with its story; once it stops, the next work counts from its own start
test('workClock_Should_CountFromFirstSeenAtWork_AndStartAgainAfterStop', () => {
  let now = 1000;
  const clock = createWorkClock(() => now);

  const first = clock.elapsed('w1:p1', true);
  now = 6000;
  const later = clock.elapsed('w1:p1', true);
  const other = clock.elapsed('w1:p2', true);
  clock.elapsed('w1:p1', false);
  now = 9000;
  const again = clock.elapsed('w1:p1', true);

  assert.deepEqual({ first, later, other, again }, { first: 0, later: 5000, other: 0, again: 0 });
});
