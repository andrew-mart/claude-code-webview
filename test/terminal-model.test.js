import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redraw } from '../public/model/terminal.js';

const esc = String.fromCharCode(27);

// Each new screen replaces the last one in place: from the top, every line's colours reset before the rest of the line
// is cleared — a coloured background would spill over the cleared cells otherwise — and what is below the last line is
// cleared too. No line break after the last line: on the bottom row it would scroll the screen up by one. herdr tells no
// cursor position, so the cursor is hidden
test('redraw_Should_ReplaceWholeScreenFromTop_ResettingColoursBeforeClearing', () => {
  const screen = `${esc}[32m$ ls${esc}[0m\r\na.txt  ${esc}[44mb.txt\n`;

  assert.equal(redraw(screen), `${esc}[?25l${esc}[H` + `${esc}[32m$ ls${esc}[0m${esc}[0m${esc}[K\r\n` + `a.txt  ${esc}[44mb.txt${esc}[0m${esc}[K` + `${esc}[J`);
});
