// @ts-check
// Reading the rest of a JSONL file that Claude Code keeps appending lines to.

/**
 * Splits only on the line-feed byte: it never occurs inside multi-byte UTF-8 characters,
 * so a character cut by a read boundary goes into carry whole.
 * @param {Buffer} carry — the unfinished line from the previous read
 * @param {Buffer} chunk — the new piece of the file
 * @returns {{ lines: string[], carry: Buffer }}
 */
export function splitLines(carry, chunk) {
  const bytes = carry.length === 0 ? chunk : Buffer.concat([carry, chunk]);
  const end = bytes.lastIndexOf(0x0a);
  if (end < 0) return { lines: [], carry: bytes };
  const lines = bytes
    .subarray(0, end)
    .toString('utf8')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line !== '');
  return { lines, carry: Buffer.from(bytes.subarray(end + 1)) };
}
