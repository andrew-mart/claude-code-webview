// @ts-check
// A side question from the page, as /btw in the terminal: Claude answers from the conversation, without tools and
// without adding to it. Claude Code shows the answer only in a panel over its prompt box — nothing is written to the
// transcript — so it is read off the screen: scrolled through with ↓ to the end, then the panel is closed with Esc.
// Claude Code keeps the side questions asked: its panel lists the earlier ones over the latest, whose answer it shows. A
// panel left open in the terminal covers the prompt box: it is closed before the question is asked.
import { inputBox, settleOn, squash } from './claude-screen.js';

/**
 * @typedef {'screen-unreadable' | 'box-not-empty' | 'not-asked' | 'no-answer' | 'answer-unreadable'} BtwRefusal
 * @typedef {{ ok: true, answer: string } | { ok: false, error: BtwRefusal }} BtwOutcome
 * @typedef {{ state: 'answering' } | { state: 'answered', lines: readonly string[], width: number }} SidePanel — width: the
 *   columns the panel wraps the answer at
 */

/** The panel indents the answer by six columns and wraps it at the terminal's width less those. */
const answerIndent = 6;
/** Box-drawing characters a line of a table starts with, as Claude Code draws tables. */
const tableLine = /^\s*[┌│├└]/;
/** A side answer takes as long as Claude thinks: up to a few minutes. */
const answerStepMs = 500;
const answerLooks = 360;
/** After ↓ the panel moves within a frame or two: when it has not moved in this time, the end of the answer is in view. */
const scrollStepMs = 100;
const scrollLooks = 8;
/** No answer is this long: the scrolling stops here whatever the screen shows. */
const maxScrolls = 1000;

/**
 * @param {import('./claude-screen.js').Terminal} terminal
 * @param {{ question: string, wait: (ms: number) => Promise<void> }} options
 * @returns {Promise<BtwOutcome>}
 */
export async function driveBtw(terminal, { question, wait }) {
  // the box takes one line: Enter in it would ask too early
  const asked = question.replace(/\s+/g, ' ').trim();
  const screen = await withPanelClosed(terminal, wait);
  const box = screen === undefined ? undefined : inputBox(screen);
  if (box === undefined) return { ok: false, error: 'screen-unreadable' };
  // a draft typed in the terminal would run into the question
  if (box !== '') return { ok: false, error: 'box-not-empty' };
  await terminal.text(`/btw ${asked}`);
  await terminal.keys('enter');
  if ((await settleOn(terminal, wait, (next) => sidePanel(next, asked) !== undefined)) === undefined) return { ok: false, error: 'not-asked' };
  const first = await answerShown(terminal, wait, asked);
  const lines = first === undefined ? undefined : await readToEnd(terminal, wait, asked, first.lines);
  await closePanel(terminal, wait, asked);
  if (first === undefined) return { ok: false, error: 'no-answer' };
  if (lines === undefined) return { ok: false, error: 'answer-unreadable' };
  return { ok: true, answer: unwrapped(withoutBlankEnds(lines), first.width).join('\n') };
}

/**
 * The side panel for this question: "Answering…" while Claude thinks, then the lines of the answer in view, without
 * the panel's indent. Undefined when the screen shows no panel for it.
 * @param {string} screen
 * @param {string} question
 * @returns {SidePanel | undefined}
 */
export function sidePanel(screen, question) {
  const lines = screen.split('\n');
  const panel = panelOf(lines);
  if (panel === undefined) return undefined;
  const { top, echoAt, bottom } = panel;
  // the question as the panel repeats it: one line, cut with an ellipsis when the question is longer
  const echo = lines[echoAt] ?? '';
  const asked = squash(`/btw ${question}`);
  const echoed = squash(echo);
  const cut = echo.trimEnd().endsWith('…');
  if (!(cut ? echoed.length > '/btw'.length && asked.startsWith(echoed) : echoed === asked)) return undefined;
  const body = lines.slice(echoAt + 1, bottom);
  if (body.some((line) => /^\s*\S\s+Answering…\s*$/.test(line))) return { state: 'answering' };
  // The panel pads its lines with a blank line above and below. A blank line of the answer itself at the edge of the
  // view is inside the next view: the views overlap by all but three lines.
  const width = [...(lines[top] ?? '')].length - answerIndent;
  return { state: 'answered', lines: withoutBlankEnds(body.map((line) => line.trimEnd().replace(/^ {1,6}/, ''))), width };
}

/**
 * Where the side panel is on the screen: its top edge; the question whose answer it shows — the latest asked, under a
 * blank line, the earlier ones listed over it a line each; its footer. None without one.
 * @param {readonly string[]} lines
 * @returns {{ top: number, echoAt: number, bottom: number } | undefined}
 */
function panelOf(lines) {
  const top = lines.findLastIndex((line) => /▔{8,}/.test(line));
  if (top < 0) return undefined;
  const bottom = lines.findIndex((line, index) => index > top && /Esc to close\s*$/.test(line));
  const first = lines.findIndex((line, index) => index > top && line.trim() !== '');
  if (bottom < 0 || first < 0 || first >= bottom || !isAsked(lines[first])) return undefined;
  const latest = lines.findIndex((line, index) => index >= first && !isAsked(lines[index + 1]));
  return { top, echoAt: latest, bottom };
}

/**
 * Whether the line is a side question as the panel lists it.
 * @param {string | undefined} line
 */
function isAsked(line) {
  return line !== undefined && line.trimStart().startsWith('/btw');
}

/**
 * The screen once a side panel left open over the prompt box — an answer read in the terminal — is closed with Esc;
 * with none open, Esc is not pressed: in the prompt box it would stop Claude's turn.
 * @param {import('./claude-screen.js').Terminal} terminal
 * @param {(ms: number) => Promise<void>} wait
 * @returns {Promise<string | undefined>}
 */
async function withPanelClosed(terminal, wait) {
  const screen = await terminal.read();
  if (screen === undefined || panelOf(screen.split('\n')) === undefined) return screen;
  await terminal.keys('esc');
  return settleOn(terminal, wait, (next) => inputBox(next) !== undefined);
}

/**
 * Esc for the side panel, only while it is open: in the prompt box Esc would stop Claude's turn.
 * @param {import('./claude-screen.js').Terminal} terminal
 * @param {(ms: number) => Promise<void>} wait
 * @param {string} question
 */
async function closePanel(terminal, wait, question) {
  const screen = await terminal.read();
  if (screen === undefined || sidePanel(screen, question) === undefined) return;
  await terminal.keys('esc');
  await settleOn(terminal, wait, (next) => inputBox(next) !== undefined);
}

/**
 * The first lines of the answer, once Claude has written it, and the width the panel wraps it at.
 * @param {import('./claude-screen.js').Terminal} terminal
 * @param {(ms: number) => Promise<void>} wait
 * @param {string} question
 * @returns {Promise<{ lines: readonly string[], width: number } | undefined>}
 */
async function answerShown(terminal, wait, question) {
  for (let look = 0; look < answerLooks; look++) {
    const screen = await terminal.read();
    const panel = screen === undefined ? undefined : sidePanel(screen, question);
    if (panel?.state === 'answered') return panel;
    await wait(answerStepMs);
  }
  return undefined;
}

/**
 * The whole answer: ↓ until the panel stops moving, each view joined to the lines before it where they overlap.
 * Undefined when a view does not continue the one before it.
 * @param {import('./claude-screen.js').Terminal} terminal
 * @param {(ms: number) => Promise<void>} wait
 * @param {string} question
 * @param {readonly string[]} first — the lines in view before scrolling
 * @returns {Promise<readonly string[] | undefined>}
 */
async function readToEnd(terminal, wait, question, first) {
  /** @type {string[]} */
  const all = [...first];
  let view = first;
  for (let scroll = 0; scroll < maxScrolls; scroll++) {
    await terminal.keys('down');
    const next = await nextView(terminal, wait, question, view);
    if (next === undefined) return all; // the panel did not move: the end of the answer is in view
    const overlap = overlapOf(view, next);
    if (overlap === 0) return undefined;
    all.push(...next.slice(overlap));
    view = next;
  }
  return all;
}

/**
 * The lines in view once the panel has moved from these; undefined if it does not move.
 * @param {import('./claude-screen.js').Terminal} terminal
 * @param {(ms: number) => Promise<void>} wait
 * @param {string} question
 * @param {readonly string[]} view
 * @returns {Promise<readonly string[] | undefined>}
 */
async function nextView(terminal, wait, question, view) {
  for (let look = 0; look < scrollLooks; look++) {
    const screen = await terminal.read();
    const panel = screen === undefined ? undefined : sidePanel(screen, question);
    if (panel?.state === 'answered' && !sameLines(panel.lines, view)) return panel.lines;
    await wait(scrollStepMs);
  }
  return undefined;
}

/**
 * How many lines at the start of the next view repeat the end of the one before: the most that do.
 * @param {readonly string[]} before
 * @param {readonly string[]} next
 */
function overlapOf(before, next) {
  for (let size = Math.min(before.length, next.length - 1); size > 0; size--) {
    if (sameLines(before.slice(before.length - size), next.slice(0, size))) return size;
  }
  return 0;
}

/** @param {readonly string[]} a @param {readonly string[]} b */
function sameLines(a, b) {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

/** @param {readonly string[]} lines */
function withoutBlankEnds(lines) {
  const first = lines.findIndex((line) => line !== '');
  const last = lines.findLastIndex((line) => line !== '');
  return first < 0 ? [] : lines.slice(first, last + 1);
}

/**
 * The answer with the lines the panel wrapped joined again, so the page wraps them at its own width: a line was
 * wrapped when the next one's first word would not have fitted after it. A table's lines are never joined.
 * @param {readonly string[]} lines
 * @param {number} width
 * @returns {string[]}
 */
function unwrapped(lines, width) {
  /** @type {string[]} */
  const joined = [];
  lines.forEach((line, index) => {
    const before = lines[index - 1];
    const word = line.trimStart().split(/\s/, 1)[0] ?? '';
    const wrapped = before !== undefined && before !== '' && word !== '' && !tableLine.test(before) && !tableLine.test(line) && [...before].length + 1 + [...word].length > width;
    if (wrapped) joined.push(`${joined.pop() ?? ''} ${line.trimStart()}`);
    else joined.push(line);
  });
  return joined;
}
