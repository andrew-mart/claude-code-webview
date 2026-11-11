// @ts-check
// Antigravity CLI's (agy) terminal, as its screen shows it: its prompt box — a line opened by ">" between two rules of ─
// — and what it asks, a dialog in the box's place: a list, its chosen row marked ">", over a row of the keys that
// answer it (as herdr's agy manifest tells them, from live panes of agy):
//   a permission:   "↑/↓ Navigate · tab Amend · ctrl+g edit/expand command" — or "· f full diff"
//   a question:     "↑/↓ Navigate · enter Select · esc Skip"
//   trust:          "↑/↓ Navigate · enter Confirm"
//   the slash menu: "↑/↓ Navigate · enter Select · tab Complete" — under the box, still there: no dialog

const rule = /^\s*─{3,}\s*$/;
/** The key rows of what agy asks; the slash menu's is not one. */
const askingKeys = /Navigate · (?:tab Amend|enter Select · esc Skip|enter Confirm)/;
/** A row of a list: the cursor ">" on the chosen one, then the text — numbered or not. */
const cursorRow = /^(\s*>\s+)(?:\d+\.\s+)?(\S.*)$/;

/**
 * The text in agy's prompt box — empty while nothing is typed; none while a dialog takes its place.
 * @param {string} screen
 * @returns {string | undefined}
 */
export function agyInputBox(screen) {
  const lines = screen.split('\n');
  if (lines.some((line) => askingKeys.test(line))) return undefined;
  // the box is under a rule and over the next one, only the typed text between them — its first line opened by ">", the
  // rest indented: a message sent stays on the screen drawn as the box was, agy's own lines after it; the slash menu's
  // rows under the box are opened by ">" as well
  for (let top = lines.length - 2; top >= 0; top--) {
    if (!rule.test(lines[top] ?? '') || !(lines[top + 1] ?? '').startsWith('>')) continue;
    const bottom = lines.findIndex((line, at) => at > top && rule.test(line));
    const box = bottom === -1 ? [] : lines.slice(top + 1, bottom);
    if (box.length > 0 && box.slice(1).every((line) => line.trim() === '' || line.startsWith(' '))) return box.map((line, at) => (at === 0 ? line.replace(/^>\s?/, '') : line.replace(/^ {2}/, '')).trimEnd()).join('\n');
  }
  return undefined;
}

/**
 * What agy asks: what it says above its choices — the command it would run, the question — and the choices, each row
 * its label and, after a gap, its note; the arrows go to one, Enter picks it.
 * @param {string} screen
 * @returns {import('../public/model/dialog.js').Dialog | undefined}
 */
export function agyDialog(screen) {
  const lines = screen.split('\n');
  const keys = lines.findLastIndex((line) => askingKeys.test(line));
  const chosen = lines.findLastIndex((line, at) => at < keys && cursorRow.test(line));
  if (keys === -1 || chosen === -1) return undefined;
  const column = (cursorRow.exec(lines[chosen] ?? '')?.[1] ?? '').length;
  /** @param {string | undefined} line */
  const isRow = (line) => line !== undefined && (cursorRow.test(line) || (line.trim() !== '' && line.length - line.trimStart().length === column));
  // the rows around the chosen one, one after another
  let first = chosen;
  while (isRow(lines[first - 1])) first--;
  let last = chosen;
  while (isRow(lines[last + 1])) last++;
  const options = lines.slice(first, last + 1).map((line) => {
    const [label = '', ...notes] = (cursorRow.exec(line)?.[2] ?? line.slice(column).replace(/^\d+\.\s+/, '')).trim().split(/\s{2,}/);
    return { key: '', label, detail: notes.length === 0 ? undefined : notes.join(' '), checked: undefined, current: cursorRow.test(line) };
  });
  // what it says: the lines above the rows, up to the rule over the dialog — or, with none, the gap under the banner
  const ruleAbove = lines.findLastIndex((line, at) => at < first && rule.test(line));
  const top = ruleAbove !== -1 ? ruleAbove : lines.findLastIndex((line, at) => at < first - 1 && line.trim() === '');
  const said = lines.slice(top + 1, first).map((line) => line.trim()).filter((line) => line !== '');
  return { lines: said, options, tabs: false, previews: true };
}
