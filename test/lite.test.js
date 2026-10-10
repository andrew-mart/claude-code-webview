import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liteEntry } from '../server/lite.js';

const timestamp = '2026-10-11T07:02:11.686Z';
/** @param {string} id @param {string} name @param {Record<string, unknown>} input */
const call = (id, name, input) => ({ type: 'assistant', uuid: `a-${id}`, timestamp, message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', id, name, input }] } });
/** @param {string} id @param {unknown} content @param {unknown} details */
const result = (id, content, details) => ({ type: 'user', uuid: `u-${id}`, timestamp, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] }, toolUseResult: details });

test('liteEntry_Should_SendBigToolResultWithoutItsOutputButWithWhatFoldedRowShows', () => {
  const calls = new Map();
  liteEntry(call('t1', 'Read', { file_path: 'D:\\x\\a.cs' }), { at: 0, calls });

  const lite = liteEntry(result('t1', 'x'.repeat(5000), { type: 'text', file: { filePath: 'D:\\x\\a.cs', content: 'x'.repeat(5000), numLines: 120 } }), { at: 345, calls });

  assert.deepEqual(lite, {
    type: 'user',
    uuid: 'u-t1',
    timestamp,
    full: 345,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, deferred: { meta: '120 lines' } }] },
  });
});

test('liteEntry_Should_CutBigToolInputToWhatRowHeadShows', () => {
  const lite = JSON.parse(JSON.stringify(liteEntry(call('t2', 'Write', { file_path: 'D:\\x\\b.md', content: 'line\n'.repeat(2000) }), { at: 900, calls: new Map() })));

  const [block] = lite.message.content;
  assert.equal(lite.full, 900);
  assert.equal(block.cut, true);
  assert.equal(block.input.file_path, 'D:\\x\\b.md');
  assert.ok(block.input.content.length < 1000, 'the file text is cut');
});

test('liteEntry_Should_KeepSmallToolResultWhole', () => {
  const calls = new Map();
  liteEntry(call('t3', 'Bash', { command: 'ls' }), { at: 0, calls });
  const small = result('t3', 'a.txt\nb.txt', { stdout: 'a.txt\nb.txt', stderr: '', interrupted: false });

  assert.deepEqual(liteEntry(small, { at: 50, calls }), small);
});
