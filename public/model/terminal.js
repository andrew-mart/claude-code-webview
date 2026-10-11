// @ts-check
// A herdr pane's screen (herdr pane read --format ansi) as what the page's terminal writes to show it.

const esc = '\u001b';

/**
 * The whole screen in place of the last one: from the top-left corner, each line's colours reset before the rest of it
 * is cleared, and what is below the last line cleared too. No line break after the last line — on the bottom row it
 * would scroll the screen. herdr tells no cursor position, so the cursor is hidden.
 * @param {string} screen — lines with ANSI colours
 * @returns {string}
 */
export function redraw(screen) {
  const lines = screen.replace(/\r?\n$/, '').split(/\r?\n/);
  return `${esc}[?25l${esc}[H${lines.map((line) => `${line}${esc}[0m${esc}[K`).join('\r\n')}${esc}[J`;
}
