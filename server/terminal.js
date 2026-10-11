// @ts-check
// A herdr pane's terminal in the page — a shell, nvim, another agent:
//   herdr pane read --format ansi  → its screen with colours, read again and again while a page shows it
//   herdr pane send-text           → the keys the page's terminal produced, as they are: Enter as \r, an arrow as its
//                                    escape sequence, Ctrl+C as \x03 — herdr passes the text to the terminal untouched
// herdr tells no cursor position, so the page hides the cursor.
import { setTimeout as delay } from 'node:timers/promises';
import { succeeded } from './herdr.js';

/**
 * @typedef {{ ok: true } | { ok: false, error: 'herdr-missing' | 'gone' }} TypeOutcome — gone: the pane closed, or
 *   herdr does not answer
 */

/**
 * @param {{ herdr: import('./composer.js').RunHerdr, quickMs: number, slowMs: number, quickForMs: number }} deps
 *   the screen is read every quickMs for quickForMs after it changed or was typed into, every slowMs otherwise
 */
export function createTerminals({ herdr, quickMs, slowMs, quickForMs }) {
  /** When each pane was typed into or changed last. */
  /** @type {Map<string, number>} */
  const lively = new Map();
  /** The keys waiting for a send to the pane to finish, and that send's outcome. */
  /** @type {Map<string, { waiting: string, flight: Promise<TypeOutcome> }>} */
  const outboxes = new Map();

  /**
   * Sends what waits in the pane's outbox until nothing does; keys typed meanwhile go with the next send.
   * @param {string} pane
   * @param {{ waiting: string }} outbox
   * @returns {Promise<TypeOutcome>}
   */
  const flush = async (pane, outbox) => {
    /** @type {TypeOutcome} */
    let outcome = { ok: true };
    while (outbox.waiting !== '' && outcome.ok) {
      const text = outbox.waiting;
      outbox.waiting = '';
      const reply = await herdr(['pane', 'send-text', pane, text]);
      outcome = succeeded(reply) ? { ok: true } : { ok: false, error: !reply.ok && reply.missing ? 'herdr-missing' : 'gone' };
    }
    outboxes.delete(pane);
    return outcome;
  };

  return {
    /**
     * Sends the pane's screen whenever it changes, until the signal is aborted or the pane is gone.
     * @param {string} pane
     * @param {(event: 'screen' | 'gone', data: unknown) => void} send — screen: { text } with ANSI colours; gone:
     *   { missing } — whether herdr is not installed
     * @param {AbortSignal} signal
     */
    async stream(pane, send, signal) {
      /** @type {string | undefined} */
      let shown;
      while (!signal.aborted) {
        const reply = await herdr(['pane', 'read', pane, '--source', 'visible', '--format', 'ansi']);
        if (!reply.ok) {
          send('gone', { missing: reply.missing });
          return;
        }
        if (reply.text !== shown) {
          shown = reply.text;
          lively.set(pane, Date.now());
          send('screen', { text: reply.text });
        }
        const quick = Date.now() - (lively.get(pane) ?? 0) < quickForMs;
        await delay(quick ? quickMs : slowMs, undefined, { signal }).catch(() => undefined);
      }
    },
    /**
     * @param {string} pane
     * @param {string} data — what the page's terminal produced
     * @returns {Promise<TypeOutcome>} — of the send that took these keys
     */
    type(pane, data) {
      lively.set(pane, Date.now());
      // a NUL cannot go in a program's arguments, and no terminal program needs it from the page
      const keys = data.replaceAll('\0', '');
      const pending = outboxes.get(pane);
      if (pending !== undefined) {
        pending.waiting += keys;
        return pending.flight;
      }
      // In the map before the send starts: the keys typed while it is on its way join this outbox.
      const outbox = { waiting: keys, flight: Promise.resolve(/** @type {TypeOutcome} */ ({ ok: true })) };
      outboxes.set(pane, outbox);
      outbox.flight = flush(pane, outbox);
      return outbox.flight;
    },
  };
}
