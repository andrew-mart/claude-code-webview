// @ts-check
// Claude Code reads a long prompt from its terminal a kilobyte at a time and, on Windows, now and then drops one read:
// the prompt it works on lacks a piece, and nothing says so. agy takes a prompt pasted, and none was seen lost so, but
// is watched alike. After a prompt goes into an agent's terminal, what the agent writes down is read till the prompt
// comes; written with a piece gone, the agent is stopped at once — as the page's Stop does: Claude Code, not begun on
// it, gives the prompt back to its box and the box is emptied — and the prompt is held whole for a page to put back
// into its box, whichever page opens the session first.
import { promptCut } from '../public/model/composer.js';

/** How much of its terminal Claude Code reads at a time: a prompt no longer comes in one read — whole, or not at all. */
const readBytes = 1024;

/**
 * @typedef {import('../public/model/composer.js').PromptCut} PromptCut
 * @typedef {{ text: string, cut: PromptCut }} HeldCut — the prompt as the page sent it, and what the agent lost of it
 */

/**
 * @template Mark
 * @param {{ written: (session: string, mark: Mark) => Promise<{ prompts: readonly string[], mark: Mark }>, stop: (session: string) => Promise<unknown>, wait: (ms: number) => Promise<void>, now: () => number, pollMs: number, giveUpMs: number }} deps
 *   — written: the prompts the session's transcript wrote down past a mark, and the mark after them; stop: Claude
 *   stopped, as the page's Stop does; pollMs: how often the transcript is read; giveUpMs: how long a prompt is waited
 *   for — Claude Code writes one it queued only once it takes it
 */
export function createCutWatch({ written, stop, wait, now, pollMs, giveUpMs }) {
  /** @type {Map<string, HeldCut>} */
  const held = new Map();
  return {
    /**
     * Reads what the session writes down till the prompt sent comes, or the watch gives up. A prompt that comes in one
     * read is not watched.
     * @param {string} session
     * @param {string} sent — the prompt as it went into the terminal
     * @param {Mark} mark — where the transcript stood before it went
     */
    async watch(session, sent, mark) {
      if (Buffer.byteLength(sent) <= readBytes) return;
      const until = now() + giveUpMs;
      let at = mark;
      while (now() < until) {
        const read = await written(session, at);
        at = read.mark;
        for (const prompt of read.prompts) {
          if (oneSpaced(prompt) === oneSpaced(sent)) return;
          const cut = promptCut(sent, prompt);
          if (cut === undefined) continue;
          held.set(session, { text: sent, cut });
          await stop(session);
          return;
        }
        await wait(pollMs);
      }
    },
    /**
     * The prompt the session got cut short, held whole till a page takes it.
     * @param {string} session
     * @returns {HeldCut | undefined}
     */
    held: (session) => held.get(session),
    /**
     * Taken by a page — put back into its box: no other page puts it there again.
     * @param {string} session
     */
    take(session) {
      held.delete(session);
    },
  };
}

/** @param {string} text — its spaces and line ends one space each, none at its ends */
function oneSpaced(text) {
  return text.replace(/\s+/g, ' ').trim();
}
