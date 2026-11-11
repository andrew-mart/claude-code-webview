// @ts-check
// A fragment of a file quoted with its lines' numbers: each line led by its number, right-aligned in a column, then two
// spaces and the code; "..." in the column where lines are left out. The numbers are told apart from the code.

/** A line of the fragment: its number right-aligned, then the code after two spaces — none on an empty line. */
const numberedLine = /^( *)(\d+)(?: {2}(.*))?$/;
/** Lines left out: "..." in the numbers' column. */
const leftOut = /^ *\.\.\.$/;

/**
 * @param {string} text — a code block's text
 * @returns {{ numbers: string, code: string } | undefined} — the numbers' column and the code, line by line, "..." and
 *   an empty line where lines are left out; none for a block that is no such fragment: a line neither numbered nor
 *   left out, numbers not in one column, or not growing
 */
export function splitLineNumbers(text) {
  /** @type {string[]} */
  const numbers = [];
  /** @type {string[]} */
  const code = [];
  /** @type {number | undefined} */
  let column;
  let last = 0;
  for (const line of text.replace(/\n+$/, '').split('\n')) {
    if (leftOut.test(line)) {
      numbers.push('...');
      code.push('');
      continue;
    }
    const match = numberedLine.exec(line);
    if (match === null) return undefined;
    const [, padding = '', digits = '', rest = ''] = match;
    const number = Number(digits);
    column ??= padding.length + digits.length;
    if (padding.length + digits.length !== column || number <= last) return undefined;
    last = number;
    numbers.push(digits);
    code.push(rest);
  }
  return column === undefined ? undefined : { numbers: numbers.join('\n'), code: code.join('\n') };
}
