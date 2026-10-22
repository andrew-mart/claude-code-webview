import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeLaterPrompts, parseLaterChange } from '../public/model/later.js';

/** @typedef {import('../public/model/later.js').LaterPrompt} LaterPrompt */

/** @type {LaterPrompt} */
const first = { id: 'l1', text: 'Then add tests for the parser', at: '2026-10-22T09:00:00.000Z' };
/** @type {LaterPrompt} */
const second = { id: 'l2', text: 'And update the README', at: '2026-10-22T09:05:00.000Z' };

// Prompts set aside stay in the order they were written — the order to go on in; the same one twice is kept once, as
// two devices sending one change must not double it
test('changeLaterPrompts_Should_KeepOrderWritten_AddOnce_AndRemoveById', () => {
  const added = changeLaterPrompts(changeLaterPrompts([second], { action: 'add', prompt: first }), { action: 'add', prompt: first });

  assert.deepEqual(added, [first, second]);
  assert.deepEqual(changeLaterPrompts(added, { action: 'remove', id: first.id }), [second]);
});

// A change the page sends, read as it is or not at all
test('parseLaterChange_Should_ReadOnlyWellFormedChanges', () => {
  assert.deepEqual(parseLaterChange({ action: 'add', prompt: first }), { action: 'add', prompt: first });
  assert.deepEqual(parseLaterChange({ action: 'remove', id: 'l1' }), { action: 'remove', id: 'l1' });
  assert.deepEqual([parseLaterChange({ action: 'add', prompt: { id: 'l3', text: 5, at: 'now' } }), parseLaterChange({ action: 'add', prompt: { ...first, text: '  ' } }), parseLaterChange({ action: 'drop', id: 'l1' }), parseLaterChange('add')], [undefined, undefined, undefined, undefined]);
});
