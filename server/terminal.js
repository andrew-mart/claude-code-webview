// @ts-check
// A herdr pane's terminal in the page — a shell, nvim, another agent:
//   its screen with colours, read again and again while a page shows it, sent when it changes;
//   the keys the page's terminal produced, typed into it as they are: Enter as \r, an arrow as its escape sequence,
//   Ctrl+C as \x03 — herdr passes the text to the terminal untouched.
// herdr tells no cursor position, so the page hides the cursor. How the screen is read and the keys typed — herdr's
// socket, or its program — is the PaneIo given.

/**
 * @typedef {{ ok: true } | { ok: false, error: 'herdr-missing' | 'gone' }} TypeOutcome — gone: the pane closed, or
 *   herdr does not answer
 * @typedef {{ ok: true, text: string } | { ok: false, missing: boolean }} ScreenRead — missing: herdr is not installed
 * @typedef {{ read: (pane: string) => Promise<ScreenRead>, type: (pane: string, text: string) => Promise<TypeOutcome> }} PaneIo
 */

/**
 * @param {{ io: PaneIo, quickMs: number, slowMs: number, quickForMs: number }} deps — the screen is read every quickMs
 *   for quickForMs after it changed or was typed into, every slowMs otherwise
 */
export function createTerminals({ io, quickMs, slowMs, quickForMs }) {
  /** When each pane was typed into or changed last. */
  /** @type {Map<string, number>} */
  const lively = new Map();
  /** The keys waiting for a send to the pane to finish, and that send's outcome. */
  /** @type {Map<string, { waiting: string, flight: Promise<TypeOutcome> }>} */
  const outboxes = new Map();
  /** The streams of each pane waiting for their next read: keys typed into the pane wake them. */
  /** @type {Map<string, Set<() => void>>} */
  const sleepers = new Map();

  /**
   * Waits ms — less if the signal is aborted, or keys are typed into the pane meanwhile.
   * @param {string} pane
   * @param {number} ms
   * @param {AbortSignal} signal
   * @returns {Promise<void>}
   */
  const pause = (pane, ms, signal) =>
    new Promise((resolve) => {
      const waiting = sleepers.get(pane) ?? new Set();
      sleepers.set(pane, waiting);
      const wake = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', wake);
        waiting.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, ms);
      signal.addEventListener('abort', wake, { once: true });
      waiting.add(wake);
    });

  /**
   * Sends what waits in the pane's outbox until nothing does; keys typed meanwhile go with the next send. Each send
   * wakes the pane's streams: the screen with the keys in it is read at once.
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
      outcome = await io.type(pane, text);
      for (const wake of [...(sleepers.get(pane) ?? [])]) wake();
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
        const screen = await io.read(pane);
        if (!screen.ok) {
          send('gone', { missing: screen.missing });
          return;
        }
        if (screen.text !== shown) {
          shown = screen.text;
          lively.set(pane, Date.now());
          send('screen', { text: screen.text });
        }
        const quick = Date.now() - (lively.get(pane) ?? 0) < quickForMs;
        await pause(pane, quick ? quickMs : slowMs, signal);
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
