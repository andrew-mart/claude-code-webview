import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkOf, rewoundEntries } from '../server/branch.js';

/** @param {string} uuid @param {string | null} parentUuid @param {string} text */
const prompt = (uuid, parentUuid, text) => ({ type: 'user', uuid, parentUuid, message: { role: 'user', content: text } });
/** @param {string} uuid @param {string} parentUuid */
const answer = (uuid, parentUuid) => ({ type: 'assistant', uuid, parentUuid, message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } });
/** @param {string} uuid @param {string} parentUuid */
const toolResult = (uuid, parentUuid) => ({ type: 'user', uuid, parentUuid, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'done' }] } });

/** @param {readonly unknown[]} records @param {string} [rewoundAt] */
const hidden = (records, rewoundAt) => [...rewoundEntries(records.map(linkOf), rewoundAt)].sort();

test('rewoundEntries_Should_HideBranchAPromptWasRewoundFrom', () => {
  // p2 was sent, then the conversation was rewound to before it and p3 sent instead
  const records = [prompt('p1', null, 'Build it'), answer('a1', 'p1'), toolResult('r1', 'a1'), answer('a2', 'r1'), prompt('p2', 'a2', 'Now test it'), answer('a3', 'p2'), prompt('p3', 'a2', 'Now test it properly'), answer('a4', 'p3')];

  assert.deepEqual(hidden(records), ['a3', 'p2']);
});

test('rewoundEntries_Should_KeepOnlyLastOfSeveralPromptsSentFromSamePoint', () => {
  const records = [prompt('p1', null, 'Build it'), answer('a1', 'p1'), prompt('p2', 'a1', 'One'), answer('a2', 'p2'), prompt('p3', 'a1', 'Two'), answer('a3', 'p3'), prompt('p4', 'a1', 'Three')];

  assert.deepEqual(hidden(records), ['a2', 'a3', 'p2', 'p3']);
});

test('rewoundEntries_Should_NotTakeResultsOfParallelToolCallsForRewind', () => {
  const records = [prompt('p1', null, 'Read both'), answer('a1', 'p1'), toolResult('r1', 'a1'), toolResult('r2', 'a1'), answer('a2', 'r2')];

  assert.deepEqual(hidden(records), []);
});

test('rewoundEntries_Should_HideFromPointRewoundFromThePageBeforeNextPromptArrives', () => {
  const records = [prompt('p1', null, 'Build it'), answer('a1', 'p1'), prompt('p2', 'a1', 'Now test it'), answer('a2', 'p2'), toolResult('r1', 'a2')];

  assert.deepEqual(hidden(records, 'p2'), ['a2', 'p2', 'r1']);
});
