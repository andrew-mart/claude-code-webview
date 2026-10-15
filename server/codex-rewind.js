// @ts-check
// Rewinding a live Codex session from the page: its backtrack, driven with keys in its terminal. Esc, Esc browses its
// prompts, the newest first; ← and → step between them; Enter reverts the conversation to before the one browsed and
// puts it back into the box. The one browsed — drawn in reverse video — is checked by its text before Enter: on any
// surprise Esc leaves, and nothing is reverted. Codex reverts the conversation alone: files stay as they are.
import { settleOn, squash } from './claude-screen.js';
import { codexBrowsedPrompt, codexInputBox } from './codex-screen.js';

/** What Codex says after one Esc with an empty box, while it waits for a prompt. */
const primedMarker = 'esc again to edit previous message';
/** Its footer while it browses its prompts. */
const browsingMarker = /Browsing\b.*\brewind\b/;
const revertedMarker = 'Conversation reverted';
/** How far from the counted prompt to look for it: Codex may list a prompt or two the count did not. */
const searchSteps = [0, 1, -1, 2, -2, 3, -3];
/** Codex draws the prompt browsed within a second or so after the keys. */
const browseStepMs = 150;
const browseLooks = 10;

/**
 * @param {import('./claude-screen.js').Terminal & { styled: () => Promise<string | undefined> }} terminal — styled: the
 *   screen with its styles
 * @param {{ stepsUp: number, prompt: string, wait: (ms: number) => Promise<void> }} options — stepsUp: how far from the
 *   newest prompt the one to rewind to is, the newest one 1
 * @returns {Promise<import('./rewind.js').RewindOutcome>}
 */
export async function driveCodexRewind(terminal, { stepsUp, prompt, wait }) {
  const settle = (/** @type {(screen: string) => boolean} */ ready) => settleOn(terminal, wait, ready);
  const screen = await terminal.read();
  if (screen === undefined || codexInputBox(screen) === undefined) return { ok: false, error: 'screen-unreadable' };
  // its backtrack starts from an empty box
  await terminal.keys('esc');
  if ((await settle((next) => next.includes(primedMarker))) === undefined) return { ok: false, error: 'menu-not-shown' };
  await terminal.keys('esc');
  if ((await settle((next) => browsingMarker.test(next))) === undefined) return { ok: false, error: 'menu-not-shown' };
  if (!(await browseTo(terminal, { stepsUp, prompt, wait }))) {
    await terminal.keys('esc');
    await settle((next) => !browsingMarker.test(next));
    return { ok: false, error: 'message-not-found' };
  }
  await terminal.keys('enter');
  const after = await settle((next) => next.includes(revertedMarker) && !browsingMarker.test(next));
  if (after === undefined) return { ok: false, error: 'not-finished' };
  // the prompt Codex put back into its box goes to the page's: it is taken out of Codex's box
  const box = codexInputBox(after);
  if (box === undefined || !sameStart(box, prompt)) return { ok: true, restoredPrompt: false };
  await terminal.keys(...repeat('backspace', [...box].length + 2));
  return { ok: true, restoredPrompt: true };
}

/**
 * Browses to the counted prompt, checked by its text; else to its neighbours.
 * @param {import('./claude-screen.js').Terminal & { styled: () => Promise<string | undefined> }} terminal
 * @param {{ stepsUp: number, prompt: string, wait: (ms: number) => Promise<void> }} options
 * @returns {Promise<boolean>} — whether Codex browses it now
 */
async function browseTo(terminal, { stepsUp, prompt, wait }) {
  const furthest = stepsUp + Math.max(...searchSteps);
  for (const step of searchSteps) {
    const target = stepsUp + step;
    if (target < 1) continue;
    // → past the newest prompt stays on it, whatever their number
    await terminal.keys(...repeat('right', furthest), ...repeat('left', target - 1));
    const browsed = await browsedOnceDrawn(terminal, wait);
    if (browsed !== undefined && sameStart(browsed, prompt)) return true;
  }
  return false;
}

/**
 * The prompt Codex shows browsed once it has drawn the keys: the same on two looks running.
 * @param {{ styled: () => Promise<string | undefined> }} terminal
 * @param {(ms: number) => Promise<void>} wait
 * @returns {Promise<string | undefined>}
 */
async function browsedOnceDrawn(terminal, wait) {
  /** @type {string | undefined} */
  let last;
  for (let look = 0; look < browseLooks; look++) {
    await wait(browseStepMs);
    const styled = await terminal.styled();
    const browsed = styled === undefined ? undefined : codexBrowsedPrompt(styled);
    if (browsed !== undefined && browsed === last) return browsed;
    last = browsed;
  }
  return last;
}

/**
 * Whether the screen shows the prompt, spaces aside: all of it, or — a long one — its start. Text past the prompt's end
 * is another prompt that begins with it.
 * @param {string} shown
 * @param {string} prompt
 */
function sameStart(shown, prompt) {
  const start = squash(shown);
  return start.length > 0 && squash(prompt).startsWith(start);
}

/**
 * @param {string} key
 * @param {number} times
 * @returns {string[]}
 */
function repeat(key, times) {
  return Array.from({ length: Math.max(0, times) }, () => key);
}
