import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChanges } from '../server/changes.js';

// What the pages asked about every few seconds the viewer looks at itself, once for all of them: a look tells which
// changed since the one before — the first only notes what each is — and one it cannot read now is taken for unchanged
test('changes_Should_TellWhatChangedSinceTheLookBefore', async () => {
  /** @type {Record<string, number>} */
  let seen = { 'w1:p1': 2 };
  let herdr = { tabs: ['shop'] };
  let herdrGone = false;
  /** @type {string[][]} */
  const told = [];
  const changes = createChanges({
    topics: {
      seen: async () => seen,
      herdr: async () => {
        if (herdrGone) throw new Error('herdr is not running');
        return herdr;
      },
    },
    tell: (topics) => void told.push([...topics]),
  });

  await changes.look();
  seen = { 'w1:p1': 3 };
  await changes.look();
  herdr = { tabs: ['shop', 'billing'] };
  herdrGone = true;
  await changes.look();
  herdrGone = false;
  await changes.look();
  await changes.look();

  assert.deepEqual(told, [['seen'], ['herdr']]);
});
