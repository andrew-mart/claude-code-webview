// @ts-check
// A table in a text file — comma, semicolon, tab or bar separated — with its columns told apart. A cell in double
// quotes keeps the splitting signs and line breaks in it; "" in it is a quote.

/**
 * @typedef {{ text: string, column: number | undefined }} CsvPiece — a cell's text in a line, or a splitting sign:
 *   no column
 */

const candidates = [',', ';', '\t', '|'];
/** Rows looked at to tell the splitting sign. */
const sampleRows = 20;

/**
 * The sign that splits every row of the first ones the same number of times — the most of them if several do; the one
 * met most often if none does; a comma in a text with none of them.
 * @param {string} text
 * @returns {string}
 */
export function csvDelimiterOf(text) {
  const rows = rowsOf(text).filter((row) => row !== '').slice(0, sampleRows);
  const counts = candidates.map((sign) => ({ sign, counts: rows.map((row) => countOutsideQuotes(row, sign)) }));
  const even = counts.filter(({ counts: [first, ...rest] }) => first !== undefined && first > 0 && rest.every((count) => count === first));
  const ranked = (even.length > 0 ? even : counts).map(({ sign, counts: found }) => ({ sign, total: found.reduce((sum, count) => sum + count, 0) }));
  const best = ranked.reduce((top, next) => (next.total > top.total ? next : top), { sign: ',', total: 0 });
  return best.sign;
}

/**
 * The text's lines, each split into its cells — told by their column — and the signs between them.
 * @param {string} text
 * @param {string} delimiter
 * @returns {CsvPiece[][]}
 */
export function csvLines(text, delimiter) {
  /** @type {CsvPiece[][]} */
  const lines = [];
  /** @type {CsvPiece[]} */
  let line = [];
  let cell = '';
  let column = 0;
  let quoted = false;
  const endCell = () => {
    if (cell !== '') line.push({ text: cell, column });
    cell = '';
  };
  for (const char of text.replace(/\r\n/g, '\n')) {
    if (char === '\n') {
      endCell();
      lines.push(line);
      line = [];
      if (!quoted) column = 0;
    } else if (char === delimiter && !quoted) {
      endCell();
      line.push({ text: char, column: undefined });
      column++;
    } else {
      if (char === '"') quoted = !quoted;
      cell += char;
    }
  }
  endCell();
  lines.push(line);
  return lines;
}

/**
 * The rows of a table: lines, except where a quoted cell runs on to the next one.
 * @param {string} text
 * @returns {string[]}
 */
function rowsOf(text) {
  /** @type {string[]} */
  const rows = [];
  let row = '';
  let quoted = false;
  for (const char of text.replace(/\r\n/g, '\n')) {
    if (char === '\n' && !quoted) {
      rows.push(row);
      row = '';
      continue;
    }
    if (char === '"') quoted = !quoted;
    row += char;
  }
  rows.push(row);
  return rows;
}

/**
 * @param {string} row
 * @param {string} sign
 */
function countOutsideQuotes(row, sign) {
  let count = 0;
  let quoted = false;
  for (const char of row) {
    if (char === '"') quoted = !quoted;
    else if (char === sign && !quoted) count++;
  }
  return count;
}
