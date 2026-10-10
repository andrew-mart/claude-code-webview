// @ts-check
// Stopping a turn from the page, as Esc in the terminal does. If Claude had not started on the prompt yet, Claude Code
// takes it back into its prompt box; the page takes it over from there and the box is emptied (the text stays in the
// terminal's history).
import { inputBox, settleOn, squash } from './claude-screen.js';

/**
 * @typedef {{ ok: true, prompt: string | undefined } | { ok: false, error: 'esc-failed' | 'box-not-cleared' }} StopOutcome
 */

/**
 * @param {import('./claude-screen.js').Terminal} terminal
 * @param {{ sent: readonly string[], wait: (ms: number) => Promise<void> }} options
 *   sent — prompts the page typed into this terminal lately: the box shows a prompt wrapped at the terminal's width,
 *   where a wrap and a new line look the same, so the exact text comes from here
 * @returns {Promise<StopOutcome>}
 */
export async function driveStop(terminal, { sent, wait }) {
  const before = await terminal.read();
  if (!(await terminal.keys('esc'))) return { ok: false, error: 'esc-failed' };
  const box = before === undefined ? undefined : inputBox(before);
  // A dialog was open instead of the box: Esc answered it, nothing comes back.
  if (box === undefined || before === undefined) return { ok: true, prompt: undefined };
  // A turn Claude had started gets one more interrupt mark on the screen and gives nothing back: no need to wait.
  const marks = interruptMarks(before);
  const after = await settleOn(terminal, wait, (screen) => takenBack(screen, box) !== undefined || interruptMarks(screen) > marks);
  const back = after === undefined ? undefined : takenBack(after, box);
  if (back === undefined) return { ok: true, prompt: undefined };
  await terminal.keys('esc', 'esc');
  if ((await settleOn(terminal, wait, (screen) => inputBox(screen) === '')) === undefined) return { ok: false, error: 'box-not-cleared' };
  return { ok: true, prompt: exactText(back, sent) };
}

/**
 * The prompt as it was sent, if the page sent it; a prompt typed in the terminal comes as the box shows it.
 * @param {string} box
 * @param {readonly string[]} sent
 * @returns {string}
 */
function exactText(box, sent) {
  const original = sent.findLast((text) => squash(text) === squash(box));
  return original === undefined ? box : original;
}

/**
 * "⎿  Interrupted · What should Claude do instead?", "⎿  Interrupted by user" — under a stopped answer or tool call.
 * @param {string} screen
 */
function interruptMarks(screen) {
  return screen.match(/⎿\s+Interrupted\b/g)?.length ?? 0;
}

/**
 * The prompt Claude Code took back: text the box holds now and did not hold before Esc.
 * @param {string} screen
 * @param {string} before — the box before Esc
 * @returns {string | undefined}
 */
function takenBack(screen, before) {
  const now = inputBox(screen);
  return now === '' || now === before ? undefined : now;
}
