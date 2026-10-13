// @ts-check
// A diff as a table: the old and the new line number, the sign, the line highlighted in its language; a gap between
// hunks. An edit in the feed and a file of a branch's changes show alike.
import { h } from './dom.js';
import { highlightInto } from './markdown.js';

/**
 * @param {readonly import('../model/tool.js').DiffRow[]} rows
 * @param {string | undefined} language
 * @param {number} limit — rows drawn at most
 * @returns {HTMLElement}
 */
export function diffTable(rows, language, limit) {
  const table = h('table', { className: 'diff' });
  for (const row of rows.slice(0, limit)) {
    if (row.kind === 'gap') {
      table.append(h('tr', { className: 'gap' }, [h('td', { attrs: { colspan: '4' }, text: '⋯' })]));
      continue;
    }
    const code = h('td', { className: 'line' });
    highlightInto(code, row.text, language ?? 'plaintext');
    const sign = row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : '';
    table.append(
      h('tr', { className: row.kind }, [
        h('td', { className: 'no', text: row.oldNo === undefined ? '' : String(row.oldNo) }),
        h('td', { className: 'no', text: row.newNo === undefined ? '' : String(row.newNo) }),
        h('td', { className: 'sign', text: sign }),
        code,
      ]),
    );
  }
  return h('div', { className: 'diff-frame' }, [table]);
}
