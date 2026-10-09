import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitLines } from '../server/tail.js';

test('splitLines_Should_KeepUnfinishedLineForNextChunk', () => {
  const first = splitLines(Buffer.alloc(0), Buffer.from('{"a":1}\n{"b":'));
  const second = splitLines(first.carry, Buffer.from('2}\r\n\n{"c":3}\n'));

  assert.deepEqual(first.lines, ['{"a":1}']);
  assert.deepEqual(second.lines, ['{"b":2}', '{"c":3}']);
  assert.equal(second.carry.length, 0);
});

test('splitLines_Should_NotBreakLetterSplitBetweenChunks', () => {
  const bytes = Buffer.from('{"a":1}\n{"t":"héllo wörld"}\n');
  const cut = Buffer.from('{"a":1}\n{"t":"h').length + 1; // inside the two-byte "é"

  const first = splitLines(Buffer.alloc(0), bytes.subarray(0, cut));
  const second = splitLines(first.carry, bytes.subarray(cut));

  assert.deepEqual([...first.lines, ...second.lines], ['{"a":1}', '{"t":"héllo wörld"}']);
});
