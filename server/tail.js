// @ts-check
// Reading the rest of a JSONL file that Claude Code keeps appending lines to, and one line of it again.
import { open } from 'node:fs/promises';

const readBytes = 1024 * 1024;
/** A transcript line longer than this is not an entry the stream could have sent. */
const maxLineBytes = 64 * 1024 * 1024;

/**
 * Splits only on the line-feed byte: it never occurs inside multi-byte UTF-8 characters,
 * so a character cut by a read boundary goes into carry whole.
 * Each line comes with the byte it starts at, counted from the start of carry.
 * @param {Buffer} carry — the unfinished line from the previous read
 * @param {Buffer} chunk — the new piece of the file
 * @returns {{ lines: { text: string, start: number }[], carry: Buffer }}
 */
export function splitLines(carry, chunk) {
  const bytes = carry.length === 0 ? chunk : Buffer.concat([carry, chunk]);
  /** @type {{ text: string, start: number }[]} */
  const lines = [];
  let start = 0;
  for (let end = bytes.indexOf(0x0a); end >= 0; end = bytes.indexOf(0x0a, start)) {
    const text = bytes.subarray(start, end).toString('utf8').replace(/\r$/, '');
    if (text !== '') lines.push({ text, start });
    start = end + 1;
  }
  return { lines, carry: Buffer.from(bytes.subarray(start)) };
}

/**
 * The whole line that starts at the offset; undefined if no line starts there (the offset points inside one).
 * @param {string} path
 * @param {number} lineStart
 * @returns {Promise<string | undefined>}
 */
export async function readLineAt(path, lineStart) {
  const handle = await open(path, 'r');
  try {
    if (lineStart > 0) {
      const before = Buffer.alloc(1);
      await handle.read(before, 0, 1, lineStart - 1);
      if (before[0] !== 0x0a) return undefined;
    }
    /** @type {Buffer[]} */
    const parts = [];
    for (let position = lineStart, length = 0; length < maxLineBytes; ) {
      const chunk = Buffer.alloc(readBytes);
      const { bytesRead } = await handle.read(chunk, 0, readBytes, position);
      if (bytesRead === 0) return undefined; // the line is not finished yet — the stream has not sent it
      const end = chunk.subarray(0, bytesRead).indexOf(0x0a);
      parts.push(chunk.subarray(0, end < 0 ? bytesRead : end));
      if (end >= 0) return Buffer.concat(parts).toString('utf8');
      position += bytesRead;
      length += bytesRead;
    }
    return undefined;
  } finally {
    await handle.close();
  }
}
