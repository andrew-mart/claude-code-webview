// @ts-check
// Polls of the viewer: each asks again only a while after its last answer came — on a slow link an answer can take
// longer than the poll's interval, and asks sent on a clock would pile up on the link, each slowing the others — and not
// while the page is out of sight: a phone's app put away, a tab behind others. In sight again, it asks at once.

/**
 * @typedef {{ document: { visibilityState: DocumentVisibilityState, addEventListener: (type: 'visibilitychange', listener: () => void) => void, removeEventListener: (type: 'visibilitychange', listener: () => void) => void }, setTimeout: (run: () => void, ms: number) => number, clearTimeout: (id: number) => void }} PollingPage
 */

/**
 * Asks while the page is in sight, everyMs after each answer; stopped, asks no more.
 * @param {PollingPage} page
 * @param {{ ask: () => Promise<void>, everyMs: number, first: 'now' | 'after-a-while' }} poll — ask: one that fails is
 *   told on the console, and the poll goes on; first: the first ask at once, or everyMs after the poll starts — its
 *   first answer asked for by the page itself
 * @returns {{ poke: () => void, stop: () => void }} — poke: something changed, the viewer says — asked at once; told so
 *   while it asks, once more as that answer comes, read perhaps before the change
 */
export function pollWhileShown(page, { ask, everyMs, first }) {
  let asking = false;
  let stopped = false;
  /** Told something changed while it asked. */
  let pokedMeanwhile = false;
  /** @type {number | undefined} */
  let timer;
  const answered = () => {
    asking = false;
    if (stopped) return;
    if (pokedMeanwhile) {
      pokedMeanwhile = false;
      run();
    } else timer = page.setTimeout(run, everyMs);
  };
  function run() {
    timer = undefined;
    if (stopped || asking || page.document.visibilityState === 'hidden') return;
    asking = true;
    ask().then(answered, (error) => {
      console.error(error);
      answered();
    });
  }
  const onVisibility = () => {
    if (page.document.visibilityState !== 'visible' || asking) return;
    if (timer !== undefined) page.clearTimeout(timer);
    run();
  };
  page.document.addEventListener('visibilitychange', onVisibility);
  if (first === 'now') run();
  else timer = page.setTimeout(run, everyMs);
  return {
    poke() {
      if (asking) {
        pokedMeanwhile = true;
        return;
      }
      if (timer !== undefined) page.clearTimeout(timer);
      run();
    },
    stop() {
      stopped = true;
      if (timer !== undefined) page.clearTimeout(timer);
      page.document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
