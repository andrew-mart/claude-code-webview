// @ts-check
// The page's feeds over one stream of its own (server/feeds.js), where an EventSource each would use up the few
// connections a browser opens to the viewer once the page follows a few sessions at once — the one it shows and those
// it keeps ready. Each feed is asked for by a name of the page's; the stream's events come marked with it and go to that
// feed alone. The stream reconnected, every feed opens again and is asked for anew from the token of its copy as it is
// then: it goes on where it stopped. A feed the viewer refuses — it no longer knows the page's stream, restarted — and
// the stream is opened anew. So is a stream that heard nothing, not even the viewer's pings, for a while before the page
// came back into sight: a phone's browser may not notice a stream gone while its app was away, the feeds standing still.
// Over it too the viewer tells what changed of what the page shows (server/changes.js), where the page asked every few
// seconds whether anything had.

/**
 * @typedef {{ addEventListener: (type: string, listener: (message: { data: string }) => void) => void, close: () => void, readonly readyState: number }} SourceLike
 *   — an EventSource
 * @typedef {{ session: string, agent?: string, tail?: number, from: () => string | undefined }} Wanted — the session and
 *   its subagent, how many of its latest entries it opens with, and the token of the copy it goes on from as the copy is
 *   when the feed is asked for — none: from its start
 * @typedef {{ on: (event: string, listener: (data: unknown) => void) => void, close: () => void, closed: () => boolean }} FeedSource
 *   — a feed as an EventSource is to the page: "open" with { resumed } — whether it goes on from a copy — "error",
 *   and the viewer's events, their data read; closed: the stream given up on, opened again by the next feed asked for
 */

/** The events a feed is sent (server/stream.js). */
const feedEvents = ['entries', 'earlier', 'ready', 'reset', 'missing', 'cursor', 'session-status'];
/** What the viewer sends now and then over a stream that has nothing else to say (server/app.js: eventStream). */
const pingEvent = 'ping';
const open = 1;
const closed = 2;

/**
 * @param {{ page: string, connect: (url: string) => SourceLike, post: (path: string, body: Record<string, unknown>) => Promise<boolean>, retryMs: number, onBackInSight: (listener: () => void) => void, now: () => number, silentMs: number }} parts
 *   — page: the page's name for itself; connect: opens an EventSource; post: asks the viewer, whether it agreed;
 *   retryMs: how long after a refused feed the stream is opened anew; onBackInSight: tells when the page comes back
 *   into sight; now: the page's clock; silentMs: how long a stream that hears nothing is taken for gone — longer than
 *   the viewer's pings come apart
 */
export function createFeedHub({ page, connect, post, retryMs, onBackInSight, now, silentMs }) {
  /** The feeds followed, by their names. */
  /** @type {Map<string, { wanted: Wanted, listeners: Map<string, ((data: unknown) => void)[]> }>} */
  const feeds = new Map();
  let named = 0;
  /** @type {SourceLike | undefined} */
  let source;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let reopening;
  /** When the stream last told anything, a ping too. */
  let heardAt = now();
  /** Those told what changed of what the page shows (server/changes.js). */
  /** @type {((topics: readonly string[] | 'all') => void)[]} */
  const changeListeners = [];
  /** Whether the page's stream has opened before: opened again, what changed meanwhile went unheard. */
  let openedBefore = false;
  /** Whether the page needs its stream: a feed followed, or what changed listened for. */
  const needed = () => feeds.size > 0 || changeListeners.length > 0;

  /** @param {string} name @param {string} event @param {unknown} data */
  const tell = (name, event, data) => {
    for (const listener of feeds.get(name)?.listeners.get(event) ?? []) listener(data);
  };
  /** The feed asked for over the stream open now: opened, from the token of its copy as it is now. @param {string} name */
  const ask = (name) => {
    const feed = feeds.get(name);
    if (feed === undefined) return;
    const { from, ...wanted } = feed.wanted;
    const token = from();
    tell(name, 'open', { resumed: token !== undefined });
    void post('/api/feeds/watch', { page, feed: name, ...wanted, ...(token === undefined ? {} : { from: token }) }).then((agreed) => {
      if (!agreed && feeds.has(name)) reopenSoon();
    });
  };
  const reopenSoon = () => {
    if (reopening !== undefined) return;
    reopening = setTimeout(() => {
      reopening = undefined;
      source?.close();
      source = undefined;
      if (needed()) stream();
    }, retryMs);
  };
  /** The page's stream, opened if it is not. */
  const stream = () => {
    if (source !== undefined && source.readyState !== closed) return source;
    const opened = connect(`/api/feeds?${new URLSearchParams({ page })}`);
    heardAt = now();
    opened.addEventListener('open', () => {
      heardAt = now();
      if (openedBefore) for (const listener of changeListeners) listener('all');
      openedBefore = true;
      for (const name of feeds.keys()) ask(name);
    });
    opened.addEventListener('changed', (message) => {
      heardAt = now();
      /** @type {unknown} */
      const told = JSON.parse(message.data);
      const topics = told !== null && typeof told === 'object' && 'topics' in told && Array.isArray(told.topics) ? told.topics.filter((topic) => typeof topic === 'string') : [];
      for (const listener of changeListeners) listener(topics);
    });
    opened.addEventListener(pingEvent, () => {
      heardAt = now();
    });
    opened.addEventListener('error', () => {
      for (const name of feeds.keys()) tell(name, 'error', null);
    });
    for (const event of feedEvents) {
      opened.addEventListener(event, (message) => {
        heardAt = now();
        /** @type {unknown} */
        const told = JSON.parse(message.data);
        if (told !== null && typeof told === 'object' && 'feed' in told && typeof told.feed === 'string' && 'data' in told) tell(told.feed, event, told.data);
      });
    }
    source = opened;
    return opened;
  };
  onBackInSight(() => {
    if (source === undefined || now() - heardAt <= silentMs) return;
    source.close();
    source = undefined;
    for (const name of feeds.keys()) tell(name, 'error', null);
    if (needed()) stream();
  });

  return {
    /**
     * What changed of what the page shows — herdr's tabs, the answers seen, the sessions — as the viewer tells it over
     * the page's stream, opened for it with no feed followed: their names; or, the stream opened again, that all may have.
     * @param {(topics: readonly string[] | 'all') => void} listener
     * @returns {() => void} — stops it hearing: its session put away
     */
    onChanged(listener) {
      changeListeners.push(listener);
      stream();
      return () => {
        const at = changeListeners.indexOf(listener);
        if (at >= 0) changeListeners.splice(at, 1);
      };
    },
    /**
     * A session's feed, followed over the page's stream.
     * @param {Wanted} wanted
     * @returns {FeedSource}
     */
    open(wanted) {
      const name = `f${++named}`;
      feeds.set(name, { wanted, listeners: new Map() });
      // asked for once the listeners are on: at once over a stream open already, else once it opens
      if (stream().readyState === open) queueMicrotask(() => ask(name));
      return {
        on(event, listener) {
          const listeners = feeds.get(name)?.listeners;
          listeners?.set(event, [...(listeners.get(event) ?? []), listener]);
        },
        close() {
          if (!feeds.delete(name)) return;
          void post('/api/feeds/unwatch', { page, feed: name });
        },
        closed: () => source === undefined || source.readyState === closed,
      };
    },
  };
}
