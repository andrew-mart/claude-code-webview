// @ts-check
// A side question from the page, as /btw in the terminal: Claude answers from the conversation, without tools and
// without adding to it. Claude Code shows the answer only in a panel over its prompt box — nothing is written to the
// transcript — so it is read off the screen: scrolled through with ↓ to the end, then the panel is closed with Esc.
import { inputBox, settleOn, squash } from './claude-screen.js';

/**
 * @typedef {'screen-unreadable' | 'box-not-empty' | 'not-asked' | 'no-answer' | 'answer-unreadable'} BtwRefusal
 * @typedef {{ ok: true, answer: string } | { ok: false, error: BtwRefusal }} BtwOutcome
 * @typedef {{ state: 'answering' } | { state: 'answered', lines: readonly string[] }} SidePanel
 */

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
  const screen = await terminal.read();
  const box = screen === undefined ? undefined : inputBox(screen);
  if (box === undefined) return { ok: false, error: 'screen-unreadable' };
  // a draft typed in the terminal would run into the question
  if (box !== '') return { ok: false, error: 'box-not-empty' };
  await terminal.text(`/btw ${asked}`);
  await terminal.keys('enter');
  if ((await settleOn(terminal, wait, (next) => sidePanel(next, asked) !== undefined)) === undefined) return { ok: false, error: 'not-asked' };
  const first = await answerShown(terminal, wait, asked);
  const lines = first === undefined ? undefined : await readToEnd(terminal, wait, asked, first);
  await closePanel(terminal, wait, asked);
  if (first === undefined) return { ok: false, error: 'no-answer' };
  if (lines === undefined) return { ok: false, error: 'answer-unreadable' };
  return { ok: true, answer: withoutBlankEnds(lines).join('\n') };
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
  const top = lines.findLastIndex((line) => /▔{8,}/.test(line));
  if (top < 0) return undefined;
  // the question as the panel repeats it, wrapped at the terminal's width
  const asked = squash(`/btw ${question}`);
  let echoed = '';
  let at = top + 1;
  while (at < lines.length && echoed.length < asked.length) echoed += squash(lines[at++] ?? '');
  if (echoed !== asked) return undefined;
  const bottom = lines.findIndex((line, index) => index >= at && /Esc to close\s*$/.test(line));
  if (bottom < 0) return undefined;
  const body = lines.slice(at, bottom);
  if (body.some((line) => /^\s*\S\s+Answering…\s*$/.test(line))) return { state: 'answering' };
  // The panel pads its lines with a blank line above and below. A blank line of the answer itself at the edge of the
  // view is inside the next view: the views overlap by all but three lines.
  return { state: 'answered', lines: withoutBlankEnds(body.map((line) => line.trimEnd().replace(/^ {1,6}/, ''))) };
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
 * The first lines of the answer, once Claude has written it.
 * @param {import('./claude-screen.js').Terminal} terminal
 * @param {(ms: number) => Promise<void>} wait
 * @param {string} question
 * @returns {Promise<readonly string[] | undefined>}
 */
async function answerShown(terminal, wait, question) {
  for (let look = 0; look < answerLooks; look++) {
    const screen = await terminal.read();
    const panel = screen === undefined ? undefined : sidePanel(screen, question);
    if (panel?.state === 'answered') return panel.lines;
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
