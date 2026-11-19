import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agyRecordAt, agyRewoundFrom, createAgyReading } from '../server/agy.js';
import { linkOf } from '../server/branch.js';

const at = (/** @type {number} */ second) => `2026-11-10T06:35:${String(second).padStart(2, '0')}Z`;
/**
 * A step of agy's transcript, done, written at its own second.
 * @param {number} index
 * @param {string} type
 * @param {Record<string, unknown>} fields
 */
const step = (index, type, fields) => ({ step_index: index, source: type === 'USER_INPUT' ? 'USER_EXPLICIT' : type === 'SYSTEM_MESSAGE' || type === 'ERROR_MESSAGE' || type === 'CHECKPOINT' ? 'SYSTEM' : 'MODEL', type, status: 'DONE', created_at: at(index), ...fields });
/** What agy writes ahead of a tool's output. */
const stamped = (/** @type {string} */ output) => `Created At: 2026-11-10T11:35:02+05:00\nCompleted At: 2026-11-10T11:35:02+05:00\n${output}`;

/** agy's steps read in turn, as the page gets them. */
function read(/** @type {unknown[]} */ steps) {
  const reading = createAgyReading();
  return steps.flatMap((one) => reading.translate(one));
}

// An agy conversation reads as Claude Code writes one: the request alone, out of agy's wrapping; the model's response —
// its thinking, its words, the tools it calls as Claude Code's tools of the same work, what it took — the tools'
// outputs in the order they were called, an error as one; the turn's end after the last words, each after the one before
test('agyReading_Should_TellConversationAsClaudeCodeWritesIt', () => {
  const records = read([
    step(0, 'USER_INPUT', { content: '<USER_REQUEST>\nCount the tests in the shop\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-11-10T11:35:00+05:00.\n</ADDITIONAL_METADATA>' }),
    step(1, 'PLANNER_RESPONSE', {
      input_tokens: 1200,
      cache_read_tokens: 30000,
      output_tokens: 80,
      thinking: 'Looking for the test folder',
      content: 'Reading the config first.',
      tool_calls: [
        { name: 'read_file', args: { Path: 'D:\\shop\\package.json', StartLine: 1, EndLine: 40 } },
        { name: 'run_command', args: { CommandLine: 'npm test -- --list', toolSummary: 'List the tests' } },
      ],
    }),
    step(2, 'GENERIC', { content: stamped('Showing lines 1-2 of 2\n1: {\n2: }') }),
    { ...step(3, 'GENERIC', { content: stamped('Encountered error in step execution: npm not found'), error: 'npm not found' }), status: 'ERROR' },
    step(4, 'PLANNER_RESPONSE', { input_tokens: 1300, cache_read_tokens: 31000, output_tokens: 20, content: 'There are 12 tests.' }),
  ]);

  assert.deepEqual(
    records.map(({ type, subtype, uuid, parentUuid, timestamp, message, durationMs }) => ({ type, subtype, uuid, parentUuid, timestamp, message, durationMs })),
    [
      { type: 'user', subtype: undefined, uuid: 'agy-0', parentUuid: null, timestamp: at(0), message: { role: 'user', content: 'Count the tests in the shop' }, durationMs: undefined },
      {
        type: 'assistant',
        subtype: undefined,
        uuid: 'agy-1',
        parentUuid: 'agy-0',
        timestamp: at(1),
        message: {
          id: 'agy-1',
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Looking for the test folder' },
            { type: 'text', text: 'Reading the config first.' },
            { type: 'tool_use', id: 'agy-1-0', name: 'Read', input: { file_path: 'D:\\shop\\package.json', offset: 1, limit: 40 } },
            { type: 'tool_use', id: 'agy-1-1', name: 'Bash', input: { command: 'npm test -- --list', description: 'List the tests' } },
          ],
          usage: { input_tokens: 1200, cache_read_input_tokens: 30000, output_tokens: 80 },
        },
        durationMs: undefined,
      },
      { type: 'user', subtype: undefined, uuid: 'agy-2', parentUuid: 'agy-1', timestamp: at(2), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'agy-1-0', content: 'Showing lines 1-2 of 2\n1: {\n2: }' }] }, durationMs: undefined },
      { type: 'user', subtype: undefined, uuid: 'agy-3', parentUuid: 'agy-2', timestamp: at(3), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'agy-1-1', content: 'Encountered error in step execution: npm not found', is_error: true }] }, durationMs: undefined },
      { type: 'assistant', subtype: undefined, uuid: 'agy-4', parentUuid: 'agy-3', timestamp: at(4), message: { id: 'agy-4', role: 'assistant', content: [{ type: 'text', text: 'There are 12 tests.' }], usage: { input_tokens: 1300, cache_read_input_tokens: 31000, output_tokens: 20 } }, durationMs: undefined },
      { type: 'system', subtype: 'turn_duration', uuid: 'agy-4-end', parentUuid: 'agy-4', timestamp: at(4), message: undefined, durationMs: 4000 },
    ],
  );
});

// What agy itself puts into the conversation reads as Claude Code's own of the kind: the summary a compaction leaves, as
// the summary Claude Code's leaves; a message from another agent, as context not the user's; a failure, as an error
test('agyReading_Should_TellCompactionMessagesAndErrorsAsClaudeCodesOwn', () => {
  const records = read([
    step(0, 'CHECKPOINT', { content: '# Resuming from a compaction\n\nThe tests were counted.' }),
    step(1, 'SYSTEM_MESSAGE', { content: '<SYSTEM_MESSAGE>\n[Message] sender=9a1c/task-5\nwatch stopped\n</SYSTEM_MESSAGE>' }),
    step(2, 'ERROR_MESSAGE', { content: '', error: 'API error (attempt 1): UNAVAILABLE (code 503)' }),
  ]);

  assert.deepEqual(
    records.map(({ type, uuid, parentUuid, ...rest }) => ({ type, uuid, parentUuid, said: rest.message?.content ?? rest.content, compact: rest.isCompactSummary, meta: rest.isMeta, level: rest.level })),
    [
      { type: 'user', uuid: 'agy-0', parentUuid: null, said: '# Resuming from a compaction\n\nThe tests were counted.', compact: true, meta: undefined, level: undefined },
      { type: 'user', uuid: 'agy-1', parentUuid: 'agy-0', said: '<SYSTEM_MESSAGE>\n[Message] sender=9a1c/task-5\nwatch stopped\n</SYSTEM_MESSAGE>', compact: undefined, meta: true, level: undefined },
      { type: 'system', uuid: 'agy-2', parentUuid: 'agy-1', said: 'API error (attempt 1): UNAVAILABLE (code 503)', compact: undefined, meta: undefined, level: 'error' },
    ],
  );
});

// agy writing a file and editing one reads as Claude Code's Write and Edit; a tool Claude Code has no like of, by its own
// name with its arguments; a command left running in the background, with what agy says of it
test('agyReading_Should_TellWritesAndEditsAsClaudeCodesTools_AndOtherToolsByName', () => {
  const records = read([
    step(0, 'USER_INPUT', { content: '<USER_REQUEST>Fix the title</USER_REQUEST>' }),
    step(1, 'PLANNER_RESPONSE', {
      tool_calls: [
        { name: 'write_file', args: { Path: 'D:\\shop\\notes.md', Content: '# Notes\n', Overwrite: true } },
        { name: 'edit_file', args: { Path: 'D:\\shop\\index.html', Target: '<title>Shp</title>', Replacement: '<title>Shop</title>' } },
        { name: 'manage_task', args: { Action: 'list' } },
        { name: 'run_command', args: { CommandLine: 'npm run watch' } },
      ],
    }),
    step(2, 'GENERIC', { content: stamped('Created file D:\\shop\\notes.md') }),
    step(3, 'GENERIC', { content: stamped('Edited D:\\shop\\index.html') }),
    step(4, 'GENERIC', { content: stamped('No tasks') }),
    { ...step(5, 'GENERIC', { content: 'Created At: 2026-11-10T11:35:05+05:00\nTool is running as a background task with task id: 9a1c/task-5\nTask Description: npm run watch' }), status: 'RUNNING' },
  ]);

  assert.deepEqual(
    records.map((record) => record.message?.content),
    [
      'Fix the title',
      [
        { type: 'tool_use', id: 'agy-1-0', name: 'Write', input: { file_path: 'D:\\shop\\notes.md', content: '# Notes\n' } },
        { type: 'tool_use', id: 'agy-1-1', name: 'Edit', input: { file_path: 'D:\\shop\\index.html', old_string: '<title>Shp</title>', new_string: '<title>Shop</title>' } },
        { type: 'tool_use', id: 'agy-1-2', name: 'manage_task', input: { Action: 'list' } },
        { type: 'tool_use', id: 'agy-1-3', name: 'Bash', input: { command: 'npm run watch' } },
      ],
      [{ type: 'tool_result', tool_use_id: 'agy-1-0', content: 'Created file D:\\shop\\notes.md' }],
      [{ type: 'tool_result', tool_use_id: 'agy-1-1', content: 'Edited D:\\shop\\index.html' }],
      [{ type: 'tool_result', tool_use_id: 'agy-1-2', content: 'No tasks' }],
      [{ type: 'tool_result', tool_use_id: 'agy-1-3', content: 'Tool is running as a background task with task id: 9a1c/task-5\nTask Description: npm run watch' }],
    ],
  );
});

// Stopped, agy writes nothing of it: the calls it made wait for outputs that never come. Its next prompt tells it — the
// calls left waiting were cut short, each answered so, and the turn interrupted, as Claude Code writes it
test('agyReading_Should_TellCallsLeftWaitingWhenNextPromptCame_AsInterrupted', () => {
  const records = read([
    step(0, 'USER_INPUT', { content: '<USER_REQUEST>Write the notes</USER_REQUEST>' }),
    step(1, 'PLANNER_RESPONSE', {
      tool_calls: [
        { name: 'write_file', args: { Path: 'D:\\shop\\notes.md', Content: '# Notes\n' } },
        { name: 'write_file', args: { Path: 'D:\\shop\\todo.md', Content: '# Todo\n' } },
      ],
    }),
    step(2, 'USER_INPUT', { content: '<USER_REQUEST>Only the notes, please</USER_REQUEST>' }),
  ]);

  assert.deepEqual(
    records.slice(2).map((record) => record.message?.content),
    [
      [{ type: 'tool_result', tool_use_id: 'agy-1-0', content: 'Interrupted: agy was stopped before this ran', is_error: true }],
      [{ type: 'tool_result', tool_use_id: 'agy-1-1', content: 'Interrupted: agy was stopped before this ran', is_error: true }],
      '[Request interrupted by user]',
      'Only the notes, please',
    ],
  );
});

// Rewound, agy writes the step it went back to anew, under the same number, and goes on from there: the conversation
// goes on from the step before it, as Claude Code's rewound does — a branch of its own, its records named apart from
// those left behind; the calls left waiting there are not cut short in it
test('agyReading_Should_TellARewoundStepAsABranchFromTheStepBeforeIt', () => {
  const records = read([
    step(0, 'USER_INPUT', { content: '<USER_REQUEST>Write the notes</USER_REQUEST>' }),
    step(1, 'PLANNER_RESPONSE', { content: 'Which notes?' }),
    step(2, 'USER_INPUT', { content: '<USER_REQUEST>The shop ones</USER_REQUEST>' }),
    step(3, 'PLANNER_RESPONSE', { tool_calls: [{ name: 'write_file', args: { Path: 'D:\\shop\\notes.md', Content: '# Notes\n' } }] }),
    step(2, 'USER_INPUT', { content: '<USER_REQUEST>The shop ones, in Russian</USER_REQUEST>' }),
    step(3, 'PLANNER_RESPONSE', { content: 'Done.' }),
  ]);

  assert.deepEqual(
    records.map((record) => [record.uuid, record.parentUuid]),
    [
      ['agy-0', null],
      ['agy-1', 'agy-0'],
      ['agy-1-end', 'agy-1'],
      ['agy-2', 'agy-1-end'],
      ['agy-3', 'agy-2'],
      ['agy-2-r1', 'agy-1-end'],
      ['agy-3-r1', 'agy-2-r1'],
      ['agy-3-r1-end', 'agy-3-r1'],
    ],
  );
});

// agy rewound to a step — as its run's log tells, when — took back the steps after it in the branch it was on then,
// writing nothing of it until the next message: they are gone from the conversation from their first record on; a
// message sent since — even in the same second, the transcript telling seconds alone — goes on from the step and is
// not rewound; rewound again to the same step, the branch rewound is the one written in between; rewound to the
// last step, nothing is
test('agyRewoundFrom_Should_TellFirstRecordOfStepsTakenBack_InBranchOfThen', () => {
  const records = read([
    step(0, 'USER_INPUT', { content: '<USER_REQUEST>Write the notes</USER_REQUEST>' }),
    step(1, 'PLANNER_RESPONSE', { content: 'Which notes?' }),
    step(2, 'USER_INPUT', { content: '<USER_REQUEST>The shop ones</USER_REQUEST>' }),
    step(3, 'PLANNER_RESPONSE', { content: 'Done.' }),
    { ...step(2, 'USER_INPUT', { content: '<USER_REQUEST>The shop ones, in Russian</USER_REQUEST>' }), created_at: at(10) },
    { ...step(3, 'PLANNER_RESPONSE', { content: 'Готово.' }), created_at: at(11) },
  ]);
  const links = records.map(linkOf);
  const when = (/** @type {number} */ second) => Date.parse(at(second)) + 400;

  assert.deepEqual(
    [agyRewoundFrom(links, { step: 1, at: when(5) }), agyRewoundFrom(links, { step: 1, at: when(9) }), agyRewoundFrom(links, { step: 1, at: when(10) }), agyRewoundFrom(links, { step: 1, at: when(12) }), agyRewoundFrom(links, { step: 3, at: when(5) })],
    ['agy-2', 'agy-2', 'agy-2', 'agy-2-r1', undefined],
  );
});

// A line of the transcript read alone — the page asks for an entry in full — is the record it was read as in turn: a
// tool's output answers the call made before it, in a line of its own
test('agyRecordAt_Should_ReadLineAsItWasReadInTurn', () => {
  const lines = [
    step(0, 'USER_INPUT', { content: '<USER_REQUEST>List the tests</USER_REQUEST>' }),
    step(1, 'PLANNER_RESPONSE', { tool_calls: [{ name: 'read_file', args: { Path: 'D:\shop\a.js' } }, { name: 'run_command', args: { CommandLine: 'npm test' } }] }),
    step(2, 'GENERIC', { content: stamped('const a = 1;') }),
    step(3, 'GENERIC', { content: stamped('12 tests — ✓') }),
  ].map((one) => `${JSON.stringify(one)}\n`);
  const content = Buffer.from(lines.join(''));
  const startOf = (/** @type {number} */ line) => Buffer.byteLength(lines.slice(0, line).join(''));

  assert.deepEqual(
    [agyRecordAt(content, startOf(3))?.message?.content, agyRecordAt(content, startOf(0))?.message?.content, agyRecordAt(content, startOf(3) + 1)],
    [[{ type: 'tool_result', tool_use_id: 'agy-1-1', content: '12 tests — ✓' }], 'List the tests', undefined],
  );
});

// The model's output may come back empty — no words, no call: agy writes the error and goes on with the turn, which
// ends after its last words, timed from the request — not after the empty output
test('agyReading_Should_EndTurnAfterItsLastWords_When_AnEmptyOutputErredOnTheWay', () => {
  const records = read([
    step(0, 'USER_INPUT', { content: '<USER_REQUEST>\nLook at the shop tests\n</USER_REQUEST>' }),
    step(2, 'PLANNER_RESPONSE', {}),
    step(3, 'ERROR_MESSAGE', { error: 'Error: model output error: model output must contain either output text or tool calls' }),
    step(4, 'PLANNER_RESPONSE', { tool_calls: [{ name: 'read_file', args: { AbsolutePath: 'D:/shop/shop.test.js' } }] }),
    step(5, 'GENERIC', { content: stamped('12 tests') }),
    step(8, 'PLANNER_RESPONSE', { content: 'All 12 tests look right.' }),
  ]);

  assert.deepEqual(
    records.filter((record) => record.subtype === 'turn_duration').map((record) => ({ after: record.parentUuid, durationMs: record.durationMs })),
    [{ after: 'agy-8', durationMs: 8000 }],
  );
});

// A turn agy goes on with after its end — woken by another agent's message, a background task done or a subagent's
// report — ends again after its last words, timed from that message: the answer it ends with says when, as the first
test('agyReading_Should_EndATurnAgain_When_AMessageWakesTheModelAfterItsEnd', () => {
  const records = read([
    step(0, 'USER_INPUT', { content: '<USER_REQUEST>\nRun the shop tests in the background\n</USER_REQUEST>' }),
    step(2, 'PLANNER_RESPONSE', { content: 'Started them; I will look once they finish.' }),
    step(5, 'SYSTEM_MESSAGE', { content: '[Message] timestamp=2026-11-10T06:35:05Z sender=background priority=normal content=Task t1 finished' }),
    step(9, 'PLANNER_RESPONSE', { content: 'All 12 tests pass.' }),
  ]);

  assert.deepEqual(
    records.filter((record) => record.subtype === 'turn_duration').map((record) => ({ after: record.parentUuid, durationMs: record.durationMs })),
    [
      { after: 'agy-2', durationMs: 2000 },
      { after: 'agy-9', durationMs: 4000 },
    ],
  );
});
