import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queueAfter, waitingPrompts } from '../public/model/queue.js';

const at = '2026-10-11T09:00:00.000Z';
/** @param {string} content */
const enqueue = (content) => ({ type: 'queue-operation', operation: 'enqueue', timestamp: at, content });
const dequeue = { type: 'queue-operation', operation: 'dequeue', timestamp: at };
/** @param {string} content */
const remove = (content) => ({ type: 'queue-operation', operation: 'remove', timestamp: at, content });
const popAll = { type: 'queue-operation', operation: 'popAll', timestamp: at };
const answer = { type: 'assistant', uuid: 'a1', timestamp: at, message: { role: 'assistant', content: [{ type: 'text', text: 'Working on it' }] } };
const notification = '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>';

/**
 * The prompts the page shows as waiting after these entries, from an empty queue.
 * @param {readonly unknown[]} entries
 */
const waitingAfter = (entries) => waitingPrompts(entries.reduce((/** @type {import('../public/model/queue.js').Queue} */ queue, entry) => queueAfter(queue, entry), []));

test('queue_Should_ShowPromptsSentWhileClaudeWorks_UntilClaudeTakesTheOldest', () => {
  assert.deepEqual(waitingAfter([enqueue('First'), answer, enqueue('Second')]), ['First', 'Second']);
  assert.deepEqual(waitingAfter([enqueue('First'), answer, enqueue('Second'), dequeue]), ['Second']);
});

// remove: Claude took the prompt in the middle of its turn, or it was taken back into the input box; popAll: all taken back
test('queue_Should_DropPromptTakenOutOfTurn', () => {
  assert.deepEqual(waitingAfter([enqueue('First'), enqueue('Second'), remove('Second')]), ['First']);
  assert.deepEqual(waitingAfter([enqueue('First'), enqueue('Second'), popAll]), []);
});

// Claude Code queues its own notes on finished background tasks too: not the user's to see as waiting, but in the line
test('queue_Should_HideNotesOnBackgroundTasks_ButKeepTheirPlaceInLine', () => {
  assert.deepEqual(waitingAfter([enqueue(notification), enqueue('Next')]), ['Next']);
  assert.deepEqual(waitingAfter([enqueue(notification), enqueue('Next'), dequeue]), ['Next']);
});

// An image without words is queued with no text at all
test('queue_Should_KeepPromptWithoutText', () => {
  const imageOnly = { type: 'queue-operation', operation: 'enqueue', timestamp: at };

  assert.deepEqual(waitingAfter([imageOnly]), ['']);
  assert.deepEqual(waitingAfter([imageOnly, enqueue('Text'), dequeue]), ['Text']);
});
