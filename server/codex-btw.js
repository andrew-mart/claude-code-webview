// @ts-check
// A side question from the page, as Codex's own /btw: Codex answers it in a side conversation — an ephemeral fork of
// the thread, which its terminal switches over to — so the answer is read off the screen, and the terminal is switched
// back to the main thread: the page's next prompt goes there, not into the side conversation.
import { settleOn, squash } from './claude-screen.js';
import { codexInputBox, showsSideConversation, showsWorking } from './codex-screen.js';

/** Codex's box, empty. */
const placeholder = 'Ask Codex to do anything';
/** A side answer takes as long as Codex thinks: up to a few minutes. */
const answerStepMs = 500;
const answerLooks = 360;

/**
 * @param {import('./claude-screen.js').Terminal} terminal
 * @param {{ question: string, wait: (ms: number) => Promise<void>, recent: () => Promise<string | undefined> }} options
 *   recent — what the terminal showed lately, lines scrolled off its screen included: an answer taller than it
 * @returns {Promise<import('./btw.js').BtwOutcome>}
 */
export async function driveCodexBtw(terminal, { question, wait, recent }) {
  // the box takes one line: Enter in it would ask too early
  const asked = question.replace(/\s+/g, ' ').trim();
  const screen = await terminal.read();
  const box = screen === undefined ? undefined : codexInputBox(screen);
  if (screen === undefined || box === undefined || showsSideConversation(screen)) return { ok: false, error: 'screen-unreadable' };
  // a draft typed in the terminal would run into the question
  if (box !== placeholder) return { ok: false, error: 'box-not-empty' };
  await terminal.text(`/btw ${asked}`);
  await settleOn(terminal, wait, (next) => squash(codexInputBox(next) ?? '').includes(squash(asked).slice(-24)));
  await terminal.keys('enter');
  if ((await settleOn(terminal, wait, showsSideConversation)) === undefined) {
    // a thread with nothing said yet opens none: Codex leaves the question in its box, where it is taken out
    const left = codexInputBox((await terminal.read()) ?? '');
    if (left !== undefined && left !== placeholder && squash(left).includes(squash(asked).slice(-24))) await terminal.keys(...Array.from({ length: [...left].length + 2 }, () => 'backspace'));
    return { ok: false, error: 'not-asked' };
  }
  /** @type {string | undefined} */
  let answer;
  for (let look = 0; look < answerLooks && answer === undefined; look++) {
    const now = await terminal.read();
    if (now !== undefined && answered(now)) answer = answerIn(now) ?? answerIn((await recent()) ?? '') ?? '';
    else await wait(answerStepMs);
  }
  // back to the main thread, answered or not, with the key Codex names for it — its Ctrl+/ does not come through a
  // terminal on Windows: there the terminal stays, and the page says so (composer.js)
  const key = switchKeyOf((await terminal.read()) ?? '');
  if (key !== undefined) {
    await terminal.keys(key);
    // the main thread drawn anew, its box back
    await settleOn(terminal, wait, (next) => !showsSideConversation(next) && codexInputBox(next) !== undefined);
  }
  if (answer === undefined) return { ok: false, error: 'no-answer' };
  return answer === '' ? { ok: false, error: 'answer-unreadable' } : { ok: true, answer };
}

/**
 * The key Codex names to switch from its side conversation to the main thread — "ctrl+/", or one given in its keymap
 * (tui.keymap.global.toggle_side_conversation) — as herdr names keys. None off a side conversation.
 * @param {string} screen
 * @returns {string | undefined}
 */
function switchKeyOf(screen) {
  return /Side from main thread · (\S+) to switch/.exec(screen)?.[1];
}

/**
 * Whether Codex is done with the side conversation's answer: it shows the side conversation, not at work, the answer
 * closed by "Worked for".
 * @param {string} screen
 */
function answered(screen) {
  return showsSideConversation(screen) && !showsWorking(screen) && screen.split('\n').some((line) => /^\s*Worked for\b/.test(line));
}

/**
 * The side conversation's answer: the lines under the question, up to "Worked for", their bullets and indents taken
 * off. None when the question is not shown — scrolled off, the answer taller than the screen.
 * @param {string} shown — the screen, or what the terminal showed lately
 * @returns {string | undefined}
 */
function answerIn(shown) {
  const lines = shown.split('\n');
  const done = lines.findLastIndex((line) => /^\s*Worked for\b/.test(line));
  const question = lines.findLastIndex((line, at) => at < done && line.startsWith('› '));
  if (done === -1 || question === -1) return undefined;
  return lines
    .slice(question + 1, done)
    .map((line) => line.replace(/^• /, '').replace(/^ {2}/, '').trimEnd())
    .join('\n')
    .trim();
}
