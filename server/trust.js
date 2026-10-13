// @ts-check
// Claude Code asks, the first time it starts in a folder, whether to trust it — a dialog of arrow keys and Enter that a
// phone cannot get through. Claude Code the viewer starts — in a new tab or workspace, or resuming a session — is
// started in a folder the user chose: the viewer answers yes for them.
import { setTimeout as delay } from 'node:timers/promises';

/**
 * @typedef {{ cursor: 'yes' | 'no' }} TrustDialog — where the cursor stands among the answers
 */

/** The question, as Claude Code 2 asks it and as older versions did. */
const trustQuestion = /trust this folder|Do you trust the files in this folder/i;
/** The answer yes, in either. */
const yesAnswer = /Yes, (?:I trust this folder|proceed)/;
/** Claude Code at work: its welcome or its prompt box's hint. */
const atWork = /Claude Code v\d|Welcome to Claude Code|for shortcuts/;

/**
 * The trust question on a pane's screen, if it is there.
 * @param {string} screen
 * @returns {TrustDialog | undefined}
 */
export function trustDialogOf(screen) {
  if (!trustQuestion.test(screen)) return undefined;
  const chosen = screen.split('\n').find((line) => /^\s*❯/.test(line));
  if (chosen === undefined) return undefined;
  return { cursor: yesAnswer.test(chosen) ? 'yes' : 'no' };
}

/**
 * Watches a pane Claude Code was just started in: when it asks whether to trust the folder, the cursor goes to yes
 * and Enter answers; when it starts without asking, nothing is sent.
 * @param {import('./composer.js').RunHerdr} herdr
 * @param {string} pane
 * @param {{ looks: number, stepMs: number }} pace — how many times the screen is looked at, how far apart
 * @returns {Promise<'trusted' | 'not-asked' | 'gave-up'>}
 */
export async function acceptTrust(herdr, pane, { looks, stepMs }) {
  for (let look = 0; look < looks; look++) {
    const read = await herdr(['pane', 'read', pane, '--source', 'visible', '--format', 'text']);
    const screen = read.ok ? read.text : '';
    const dialog = trustDialogOf(screen);
    if (dialog?.cursor === 'yes') {
      await herdr(['pane', 'send-keys', pane, 'enter']);
      return 'trusted';
    }
    if (dialog?.cursor === 'no') await herdr(['pane', 'send-keys', pane, 'down']);
    else if (atWork.test(screen)) return 'not-asked';
    await delay(stepMs);
  }
  return 'gave-up';
}
