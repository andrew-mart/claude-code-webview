// @ts-check
// Reading the rest of a JSONL file that Claude Code keeps appending lines to.

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
