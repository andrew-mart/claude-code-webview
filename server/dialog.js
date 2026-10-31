// @ts-check
// A choice Claude Code waits for, read off its terminal: its AskUserQuestion dialog — the tabs of several questions, the
// question, numbered answers with a line under each — or the review of the answers before they are sent. The dialog
// takes the prompt box's place, between a rule above it and its footer ("Enter to select · … · Esc to cancel") — or, in
// the review, the bottom of the screen; a rule inside it sets apart its last answers ("Chat about this"). Some are
// drawn their own way: the /model picker; /mcp's lists with no digits — its servers, a server's tools — and a tool's
// page, with nothing to choose.
import { inputBox } from './claude-screen.js';

const rule = /^\s*[─▔]{4,}\s*$/;
const footerLine = /Enter to select|Esc to cancel/;
/** A footer where Esc goes back to the screen before — /mcp's, under its first — not out of the dialog. */
const escBack = /Esc to (?:go )?back/;
/** Where a preview's frame starts on an answer's line, after a gap. */
const previewFrame = /(?<=\s{3})[┌│└]/;
const optionLine = /^\s*(❯)?\s*(\d+)\.\s+(?:\[([ ✔])\]\s+)?(.*\S)\s*$/;
/** A list with no digits — /mcp's — goes along with the arrows. */
const listFooter = /↑\/↓ to navigate/;
/** The row under the cursor, up to where its text starts; and that text. */
const cursorRow = /^(\s*❯\s+)(\S.*)$/;
/** A row's text opening with a mark — ✔ ✘ … ⚠, a server's state — before its name. */
const marked = /^[^\p{L}\p{N}\s]\s/u;
/** A screen with nothing to choose — a tool opened in /mcp — has this alone under it. */
const backOnly = /^\s*Esc to go back\s*$/;
/** How far from the terminal's edge a line may end and still have been broken there: a word that did not fit. */
const edgeSlack = 20;

/**
 * @param {string} screen
 * @returns {import('../public/model/dialog.js').Dialog | undefined}
 */
export function choiceDialog(screen) {
  if (inputBox(screen) !== undefined) return undefined;
  // the /model picker, /mcp's lists and pages: each drawn its own way
  const own = modelDialog(screen) ?? cursorList(screen) ?? pageToGoBackFrom(screen);
  if (own !== undefined) return own;
  const lines = screen.split('\n');
  const footer = endOf(lines);
  const top = footer < 0 ? -1 : topOf(lines, footer);
  if (top < 0) return undefined;
  /** @type {string[]} */
  const head = [];
  /** @type {import('../public/model/dialog.js').DialogOption[]} */
  const options = [];
  /** A rule under the answers: what comes after it unnumbered ("Chat about this" beside previews) is no answer. */
  let ruled = false;
  // answers drawn beside previews: the column the previews' frame starts in, which no description reaches
  const frames = lines.slice(top + 1, footer).flatMap((line) => (optionLine.test(line) && previewFrame.test(line) ? [line.search(previewFrame)] : []));
  const previewColumn = Math.min(Number.POSITIVE_INFINITY, ...frames);
  for (const line of lines.slice(top + 1, footer)) {
    const text = line.trim();
    const option = optionLine.exec(line);
    const last = options.at(-1);
    if (rule.test(line)) ruled = last !== undefined;
    if (text === '' || rule.test(line)) continue;
    if (option !== null) options.push(optionOf(option));
    // the question beside previews is set off by a bar
    else if (last === undefined) head.push(text.replace(/^│\s?/, ''));
    // a question with several answers lists a Submit of its own under them: → goes on as well. A line far in is the
    // previews' column — their frame, the note on notes — not a description
    else if (text !== 'Submit' && !ruled && indentOf(line) < previewColumn) options[options.length - 1] = { ...last, detail: last.detail === undefined ? text : `${last.detail} ${text}` };
  }
  return options.length === 0 ? undefined : { lines: head, options, tabs: head.some((text) => text.startsWith('←')), previews: frames.length > 0 || head[0] === 'Switch model?', ...goingBack(lines[footer]) };
}

/**
 * The /model picker has scrolling arrows beside numbered rows and is answered with arrows, not option digits.
 * @param {string} screen
 * @returns {import('../public/model/dialog.js').Dialog | undefined}
 */
function modelDialog(screen) {
  const lines = screen.split('\n');
  const footer = lines.findLastIndex((line) => /Enter to set as default/.test(line));
  if (footer < 0 || !/s to use this session only.*Esc to cancel/.test(lines.slice(footer).join(' ').replace(/\s+/g, ' '))) return undefined;
  const top = lines.findLastIndex((line, at) => at < footer && line.trim() === 'Select model');
  if (top < 0) return undefined;
  const options = lines.slice(top + 1, footer).flatMap((line) => {
    const match = /^\s*(?:([❯>])|[↑↓])?\s*(\d+)\.\s+(\S.*)$/.exec(line);
    if (match === null) return [];
    return [{ key: match[2] ?? '', label: (match[3] ?? '').trim(), detail: undefined, checked: undefined, current: match[1] !== undefined }];
  });
  return options.some((option) => option.current) ? { lines: ['Select model', 'Applies to this session only.'], options, tabs: false, previews: true, sessionOnly: true } : undefined;
}

/**
 * A list with no digits, gone along with the arrows under the cursor ❯ — /mcp's servers, a server's tools: what it is
 * above the rows, each row its name and, after a gap, what it has. Where the cursor's row opens with a mark — a server's
 * state — the rows without one are headings, not choices; what is under the rows is help. A numbered list is not one.
 * @param {string} screen
 * @returns {import('../public/model/dialog.js').Dialog | undefined}
 */
function cursorList(screen) {
  const lines = screen.split('\n');
  const footer = lines.findLastIndex((line) => listFooter.test(line));
  const top = lines.findLastIndex((line, at) => at < footer && rule.test(line));
  const body = lines.slice(top + 1, footer);
  const cursor = body.flatMap((line) => {
    const match = cursorRow.exec(line);
    return match === null || optionLine.test(line) ? [] : [{ column: (match[1] ?? '').length, mark: marked.test(match[2] ?? '') }];
  })[0];
  if (footer < 0 || top < 0 || cursor === undefined) return undefined;
  /** @param {string} line */
  const textOf = (line) => line.slice(cursor.column).trim();
  /** @param {string} line */
  const isRow = (line) => (cursorRow.test(line) || indentOf(line) === cursor.column) && marked.test(textOf(line)) === cursor.mark;
  const first = body.findIndex(isRow);
  const options = body.filter(isRow).map((line) => {
    const [label = '', ...rest] = textOf(line).split(/\s{2,}/);
    return { key: '', label, detail: rest.length === 0 ? undefined : rest.join(' '), checked: undefined, current: cursorRow.test(line) };
  });
  const head = body.slice(0, first).filter((line) => line.trim() !== '' && indentOf(line) < cursor.column).map((line) => line.trim());
  return { lines: head, options, tabs: false, previews: true, ...goingBack(lines[footer]) };
}

/**
 * A screen with nothing to choose, to read and go back from with Esc — a tool opened in /mcp: what it says.
 * @param {string} screen
 * @returns {import('../public/model/dialog.js').Dialog | undefined}
 */
function pageToGoBackFrom(screen) {
  const lines = screen.split('\n');
  const footer = lines.findLastIndex((line) => backOnly.test(line));
  const top = lines.findLastIndex((line, at) => at < footer && rule.test(line));
  const edge = lines[top];
  if (footer < 0 || edge === undefined) return undefined;
  return { lines: unbroken(lines.slice(top + 1, footer), edge.trim().length), options: [], tabs: false, previews: false, goesBack: true };
}

/**
 * Lines as they were before the terminal broke them at its edge: one reaching near the edge goes on in the line under
 * it; blank lines go.
 * @param {readonly string[]} lines
 * @param {number} width — the terminal's
 * @returns {string[]}
 */
function unbroken(lines, width) {
  /** @type {string[]} */
  const joined = [];
  let broken = false;
  for (const line of lines) {
    const text = line.trim();
    const last = joined.at(-1);
    if (text !== '' && broken && last !== undefined) joined[joined.length - 1] = `${last} ${text}`;
    else if (text !== '') joined.push(text);
    broken = text !== '' && line.trimEnd().length >= width - edgeSlack;
  }
  return joined;
}

/**
 * @param {string | undefined} footer
 * @returns {{ goesBack?: true }} — goesBack: Esc goes back to the screen before
 */
function goingBack(footer) {
  return footer !== undefined && escBack.test(footer) ? { goesBack: true } : {};
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
    if (below.some((line) => optionLine.test(line)) && below.some((line) => !optionLine.test(line))) return at;
  }
  return -1;
}

/** @param {string} line */
function indentOf(line) {
  return line.length - line.trimStart().length;
}

/**
 * @param {RegExpExecArray} match — of optionLine
 * @returns {import('../public/model/dialog.js').DialogOption}
 */
function optionOf(match) {
  const [, cursor, key = '', tick, line = ''] = match;
  // beside previews the answer's line runs on into the preview's frame
  const label = line.replace(/\s{3,}[┌│└].*$/, '');
  return { key, label, detail: undefined, checked: tick === undefined ? undefined : tick === '✔', current: cursor !== undefined };
}
