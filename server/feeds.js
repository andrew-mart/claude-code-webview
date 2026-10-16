// @ts-check
// The feeds a page follows, over one stream of its own: a session's transcript each, its events marked with the page's
// name for it. A stream each would use up the few connections a browser opens to the viewer once a page follows a few
// sessions at once — the one it shows and those it keeps ready in the background. The page opens its stream, then asks
// for each feed and lets each go; its stream closed or opened again lets go of them all.

/**
 * @typedef {(event: string, data: unknown) => void} Send
 * @typedef {{ send: Send, signal: AbortSignal, done: () => void }} Following — send: a feed's event, marked with its
 *   name; signal: aborted once the feed is let go of or the page's stream closes; done: the feed ended by itself
 */

export function createFeedPages() {
  /** The pages' streams, by the page's name for itself. */
  /** @type {Map<string, { send: Send, signal: AbortSignal, feeds: Map<string, AbortController> }>} */
  const pages = new Map();

  return {
    /**
     * A page's stream opened: the feeds it follows go over it. One opened again takes the place of the one before, and
     * lets go of its feeds.
     * @param {string} page
     * @param {{ send: Send, signal: AbortSignal }} stream
     */
    open(page, stream) {
      for (const feed of pages.get(page)?.feeds.values() ?? []) feed.abort();
      const opened = { send: stream.send, signal: stream.signal, feeds: new Map() };
      pages.set(page, opened);
      stream.signal.addEventListener(
        'abort',
        () => {
          for (const feed of opened.feeds.values()) feed.abort();
          if (pages.get(page) === opened) pages.delete(page);
        },
        { once: true },
      );
    },
    /**
     * A feed asked for by the page: one of the same name before is let go of. None while the page's stream is not open.
     * @param {string} page
     * @param {string} feed
     * @returns {Following | undefined}
     */
    watch(page, feed) {
      const opened = pages.get(page);
      if (opened === undefined) return undefined;
      opened.feeds.get(feed)?.abort();
      const controller = new AbortController();
      opened.feeds.set(feed, controller);
      return {
        send: (event, data) => opened.send(event, { feed, data }),
        signal: AbortSignal.any([opened.signal, controller.signal]),
        done: () => {
          if (opened.feeds.get(feed) === controller) opened.feeds.delete(feed);
        },
      };
    },
    /**
     * @param {string} page
     * @param {string} feed
     */
    unwatch(page, feed) {
      const opened = pages.get(page);
      opened?.feeds.get(feed)?.abort();
      opened?.feeds.delete(feed);
    },
  };
}
