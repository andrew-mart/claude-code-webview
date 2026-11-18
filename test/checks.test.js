import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeChecks, parseCheckChange, parseChecks } from '../public/model/checks.js';

// A message is checked once however many times it is — two devices may send the same change — and unchecked; the
// messages checked keep the order they were checked in
test('changeChecks_Should_CheckAMessageOnce_AndUncheckIt', () => {
  const once = changeChecks(changeChecks(['a1'], { action: 'check', id: 'u2' }), { action: 'check', id: 'u2' });
  const unchecked = changeChecks(once, { action: 'uncheck', id: 'a1' });
  const notThere = changeChecks(unchecked, { action: 'uncheck', id: 'a9' });

  assert.deepEqual({ once, unchecked, notThere }, { once: ['a1', 'u2'], unchecked: ['u2'], notThere: ['u2'] });
});

// What is stored, and what the page sends, read as checks and changes: anything of another shape is dropped, or refused
test('parseChecks_Should_KeepMessageIdsOnly_And_parseCheckChange_RefuseOtherShapes', () => {
  assert.deepEqual(
    {
      stored: parseChecks(['a1', 3, null, 'u2']),
      notAList: parseChecks({ a1: true }),
      check: parseCheckChange({ action: 'check', id: 'a1' }),
      uncheck: parseCheckChange({ action: 'uncheck', id: 'a1' }),
      refused: [parseCheckChange({ action: 'check', id: 1 }), parseCheckChange({ action: 'toggle', id: 'a1' }), parseCheckChange(undefined)],
    },
    { stored: ['a1', 'u2'], notAList: [], check: { action: 'check', id: 'a1' }, uncheck: { action: 'uncheck', id: 'a1' }, refused: [undefined, undefined, undefined] },
  );
});
