import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitLines } from '../server/tail.js';

/** @param {readonly { text: string }[]} lines */
const texts = (lines) => lines.map((line) => line.text);

test('splitLines_Should_KeepUnfinishedLineForNextChunk', () => {
  const first = splitLines(Buffer.alloc(0), Buffer.from('{"a":1}\n{"b":'));
  const second = splitLines(first.carry, Buffer.from('2}\r\n\n{"c":3}\n'));

  assert.deepEqual(texts(first.lines), ['{"a":1}']);
  assert.deepEqual(texts(second.lines), ['{"b":2}', '{"c":3}']);
  assert.equal(second.carry.length, 0);
});

test('splitLines_Should_NotBreakLetterSplitBetweenChunks', () => {
  const bytes = Buffer.from('{"a":1}\n{"t":"héllo wörld"}\n');
  const cut = Buffer.from('{"a":1}\n{"t":"h').length + 1; // inside the two-byte "é"

  const first = splitLines(Buffer.alloc(0), bytes.subarray(0, cut));
  const second = splitLines(first.carry, bytes.subarray(cut));

  assert.deepEqual(texts([...first.lines, ...second.lines]), ['{"a":1}', '{"t":"héllo wörld"}']);
});

test('splitLines_Should_TellWhereEachLineStartsInBytesCountingCarry', () => {
  const first = splitLines(Buffer.alloc(0), Buffer.from('{"a":1}\n{"t":"é'));
  const second = splitLines(first.carry, Buffer.from('"}\r\n\n{"c":3}\n'));

  // the carry {"t":"é is 8 bytes ("é" takes two) and starts at byte 8 of the file; the second read begins
  // with the carry, so its offsets count from byte 8: {"t":"é"} is 10 bytes, then \r, \n and an empty line
  assert.deepEqual(first.lines, [{ text: '{"a":1}', start: 0 }]);
  assert.deepEqual(second.lines, [
    { text: '{"t":"é"}', start: 0 },
    { text: '{"c":3}', start: 13 },
  ]);
});
