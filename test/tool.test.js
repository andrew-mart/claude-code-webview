import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffRows, summarizeCall, summarizeResult } from '../public/model/tool.js';

/** @type {readonly [string, unknown, import('../public/model/tool.js').CallSummary][]} */
const cases = [
  ['Bash', { command: 'ls -la\nwc -l', description: 'List files' }, { family: 'shell', label: 'List files', target: 'ls -la' }],
  ['Bash', { command: 'git status' }, { family: 'shell', label: 'Bash', target: 'git status' }],
  ['Read', { file_path: 'D:\\dev\\x\\a.cs', offset: 10, limit: 5 }, { family: 'read', label: 'Read', target: 'D:\\dev\\x\\a.cs' }],
  ['Edit', { file_path: 'D:/dev/x/a.cs', old_string: 'a', new_string: 'b' }, { family: 'edit', label: 'Edit', target: 'D:/dev/x/a.cs' }],
  ['Grep', { pattern: 'interpretEntry', path: 'D:/dev/x' }, { family: 'search', label: 'Grep', target: 'interpretEntry' }],
  ['Agent', { description: 'Study reference', subagent_type: 'Explore', prompt: '...' }, { family: 'agent', label: 'Explore', target: 'Study reference' }],
  ['WebFetch', { url: 'https://example.com/a', prompt: 'q' }, { family: 'web', label: 'WebFetch', target: 'https://example.com/a' }],
  ['mcp__claude-in-chrome__navigate', { url: 'https://example.com', tabId: 1 }, { family: 'mcp', label: 'claude-in-chrome · navigate', target: 'https://example.com' }],
  ['SomethingNew', { count: 3, note: 'first line\nsecond' }, { family: 'other', label: 'SomethingNew', target: 'first line' }],
  ['Weird', 'not an object', { family: 'other', label: 'Weird', target: '' }],
];

for (const [index, [name, input, expected]] of cases.entries()) {
  test(`summarizeCall_Should_DescribeRowFor_${name}_${index}`, () => {
    assert.deepEqual(summarizeCall(name, input), expected);
  });
}

test('diffRows_Should_NumberLinesFromStructuredPatchAndMarkGapBetweenHunks', () => {
  const details = {
    structuredPatch: [
      { oldStart: 46, oldLines: 2, newStart: 46, newLines: 2, lines: ['   storage', '-  old', '+  new'] },
      { oldStart: 90, oldLines: 1, newStart: 90, newLines: 2, lines: [' }', '+// end', '\\ No newline at end of file'] },
    ],
  };

  assert.deepEqual(diffRows('Edit', {}, details), [
    { kind: 'ctx', oldNo: 46, newNo: 46, text: '  storage' },
    { kind: 'del', oldNo: 47, newNo: undefined, text: '  old' },
    { kind: 'add', oldNo: undefined, newNo: 47, text: '  new' },
    { kind: 'gap', oldNo: undefined, newNo: undefined, text: '' },
    { kind: 'ctx', oldNo: 90, newNo: 90, text: '}' },
    { kind: 'add', oldNo: undefined, newNo: 91, text: '// end' },
  ]);
});

test('diffRows_Should_BuildUnnumberedDiffFromCallWhileResultIsMissing', () => {
  const edit = { file_path: 'a.cs', old_string: 'var a = 1;\nvar b = 2;', new_string: 'var a = 3;' };
  const write = { file_path: 'b.md', content: '# Title\ntext' };

  assert.deepEqual(diffRows('Edit', edit, undefined), [
    { kind: 'del', oldNo: undefined, newNo: undefined, text: 'var a = 1;' },
    { kind: 'del', oldNo: undefined, newNo: undefined, text: 'var b = 2;' },
    { kind: 'add', oldNo: undefined, newNo: undefined, text: 'var a = 3;' },
  ]);
  assert.deepEqual(diffRows('Write', write, undefined), [
    { kind: 'add', oldNo: undefined, newNo: undefined, text: '# Title' },
    { kind: 'add', oldNo: undefined, newNo: undefined, text: 'text' },
  ]);
  assert.equal(diffRows('Bash', { command: 'ls' }, undefined), undefined);
});

/** @type {readonly [string, boolean, unknown, string | undefined][]} */
const results = [
  ['Edit', false, { structuredPatch: [{ oldStart: 1, newStart: 1, lines: ['-a', '+b', '+c', ' d'] }] }, '+2 −1'],
  ['Write', false, { type: 'create', content: 'a\nb\nc', structuredPatch: [] }, '+3'],
  ['Read', false, { type: 'text', file: { numLines: 52 } }, '52 lines'],
  ['Grep', false, { mode: 'files_with_matches', numFiles: 72 }, '72 files'],
  ['Grep', false, { mode: 'content', numLines: 5 }, '5 lines'],
  ['Grep', false, { mode: 'count', numMatches: 1299 }, '1299 matches'],
  ['Glob', false, { numFiles: 1 }, '1 file'],
  ['Agent', false, { status: 'async_launched', agentId: 'a1' }, 'in background'],
  ['Agent', false, { status: 'completed', totalToolUseCount: 12, totalDurationMs: 65000 }, '12 actions · 1m 5s'],
  ['Bash', false, { stdout: '', stderr: '', interrupted: true }, 'interrupted'],
  ['Bash', true, 'Error: Exit code 4', 'error'],
  ['Bash', false, { stdout: 'ok', stderr: '', interrupted: false }, undefined],
];

for (const [index, [name, isError, details, expected]] of results.entries()) {
  test(`summarizeResult_Should_ShowCountsFor_${name}_${index}`, () => {
    assert.equal(summarizeResult(name, { isError, details }), expected);
  });
}
