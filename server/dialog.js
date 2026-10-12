// @ts-check
// A choice Claude Code waits for, read off its terminal: its AskUserQuestion dialog — the tabs of several questions, the
// question, numbered answers with a line under each — or the review of the answers before they are sent. The dialog
// takes the prompt box's place, between a rule above it and its footer ("Enter to select · … · Esc to cancel") — or, in
// the review, the bottom of the screen; a rule inside it sets apart its last answers ("Chat about this").
import { inputBox } from './claude-screen.js';

const rule = /^\s*─{4,}\s*$/;
const footerLine = /Enter to select|Esc to cancel/;
const optionLine = /^\s*(❯)?\s*(\d+)\.\s+(?:\[([ ✔])\]\s+)?(.*\S)\s*$/;

/**
 * @param {string} screen
 * @returns {import('../public/model/dialog.js').Dialog | undefined}
 */
export function choiceDialog(screen) {
  if (inputBox(screen) !== undefined) return undefined;
  const lines = screen.split('\n');
  const footer = endOf(lines);
  const top = footer < 0 ? -1 : topOf(lines, footer);
  if (top < 0) return undefined;
  /** @type {string[]} */
  const head = [];
  /** @type {import('../public/model/dialog.js').DialogOption[]} */
  const options = [];
  for (const line of lines.slice(top + 1, footer)) {
    const text = line.trim();
    const option = optionLine.exec(line);
    const last = options.at(-1);
    if (text === '' || rule.test(line)) continue;
    if (option !== null) options.push(optionOf(option));
    // a question with several answers lists a Submit of its own under them: → goes on as well
    else if (last === undefined) head.push(text);
    else if (text !== 'Submit') options[options.length - 1] = { ...last, detail: last.detail === undefined ? text : `${last.detail} ${text}` };
  }
  return options.length === 0 ? undefined : { lines: head, options, tabs: head.some((text) => text.startsWith('←')) };
}

/**
 * Where the dialog ends: its footer, or — the review of the answers has none — its last choice, ending the screen.
 * @param {readonly string[]} lines
 * @returns {number} — the line after the dialog; -1 when the screen ends in no dialog
 */
function endOf(lines) {
  const footer = lines.findLastIndex((line) => footerLine.test(line));
  if (footer >= 0) return footer;
  const last = lines.findLastIndex((line) => line.trim() !== '');
  return last >= 0 && optionLine.test(lines[last] ?? '') ? last + 1 : -1;
}

/**
 * The rule above the dialog: going up from its footer, the first rule with more than answers under it — the one that
 * sets apart its last answers has nothing else below it.
 * @param {readonly string[]} lines
 * @param {number} footer
 */
function topOf(lines, footer) {
  for (let at = footer - 1; at >= 0; at--) {
    if (!rule.test(lines[at] ?? '')) continue;
    const below = lines.slice(at + 1, footer).filter((line) => line.trim() !== '' && !rule.test(line));
    if (below.some((line) => !optionLine.test(line))) return at;
  }
  return -1;
}

/**
 * @param {RegExpExecArray} match — of optionLine
 * @returns {import('../public/model/dialog.js').DialogOption}
 */
function optionOf(match) {
  const [, cursor, key = '', tick, label = ''] = match;
  return { key, label, detail: undefined, checked: tick === undefined ? undefined : tick === '✔', current: cursor !== undefined };
}
