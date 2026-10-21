// @ts-check
// Where the page goes within itself — another session, a terminal — by the hash of its address. In the iPhone's
// home-screen app it goes there in place, adding nothing to the history: there the swipe from the left edge is Back,
// and WebKit slides in a picture of the page left that it at times never takes away — the page frozen under it. With
// nothing to go back to there is no picture, and the swipe is the page's own (edge-swipe.js).

/**
 * @param {{ location: Location, history: 'kept' | 'replaced' }} parts — history: whether going on adds a page to go
 *   back to, or replaces the one shown
 */
export function createPageAddress({ location, history }) {
  /** @param {string} hash */
  const go = (hash) => {
    if (history === 'replaced') location.replace(hash);
    else location.hash = hash;
  };
  return {
    go,
    /**
     * The links within the page — the session list's, herdr's — go as go does; one a click was already taken for is
     * left alone.
     * @param {Document} document
     */
    followLinksIn(document) {
      const view = document.defaultView;
      if (history === 'kept' || view === null) return;
      document.addEventListener('click', (event) => {
        const link = event.target instanceof view.Element ? event.target.closest('a[href^="#"]') : null;
        const hash = link?.getAttribute('href');
        if (event.defaultPrevented || hash === undefined || hash === null) return;
        event.preventDefault();
        go(hash);
      });
    },
  };
}
