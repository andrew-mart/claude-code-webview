// @ts-check
// The copies kept of sessions not open, brought up to date in the background, each in turn: what came since its token
// alone — or, a session with no copy yet, its latest entries — asked for over the page's stream, the copy kept again
// with the viewer's new token, the feed let go of. A session opened later shows what is current at once, and asks for
// little. A copy the viewer finds out of step is kept with no token: next time it comes whole.
import { createFeedCopy } from '../model/feed-copy.js';
import { lastActivityOf } from '../model/offline.js';

/**
 * @typedef {'kept' | 'out-of-step' | 'missing' | 'no-answer'} CatchUp — kept: brought up to date; out-of-step: kept
 *   with no token to go on from; missing: the session has no transcript; no-answer: the viewer did not send it in time
 */

/**
 * @param {{ open: import('./session-view.js').OpenFeed, read: (sessionId: string) => Promise<import('./offline-store.js').SavedFeed | undefined>, save: (sessionId: string, feed: import('./offline-store.js').SavedFeed) => Promise<void>, tail: number, keep: number, waitMs: number }} parts
 *   — open: a session's feed over the page's stream; read, save: the copies kept; tail: how many of its latest entries a
 *   session with no copy gets; keep: how many are kept at most; waitMs: how long the viewer is given to send it
 */
export function createFeedKeeper({ open, read, save, tail, keep, waitMs }) {
  return {
    /**
     * @param {string} sessionId
     * @returns {Promise<CatchUp>}
     */
    async catchUp(sessionId) {
      const saved = await read(sessionId);
      const copy = createFeedCopy(saved?.token === undefined ? undefined : { entries: saved.entries, earlier: saved.earlier, token: saved.token });
      const feed = open({ session: sessionId, tail, from: () => copy.goOnFrom() });
      /** @type {CatchUp} */
      const outcome = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve('no-answer'), waitMs);
        /** @param {CatchUp} how */
        const done = (how) => {
          clearTimeout(timer);
          resolve(how);
        };
        for (const event of ['reset', 'earlier', 'entries', 'cursor']) {
          feed.on(event, (data) => {
            if (copy.take(event, data) === 'out-of-step') done('out-of-step');
          });
        }
        feed.on('ready', () => done('kept'));
        feed.on('missing', () => done('missing'));
      });
      feed.close();
      if (outcome === 'kept') {
        const kept = copy.kept(keep);
        if (kept.entries.length > 0) await save(sessionId, { entries: [...kept.entries], earlier: kept.earlier, token: kept.token, lastActivity: lastActivityOf(kept.entries), savedAt: Date.now() });
      }
      // out of step: the copy as it was, with no token — next time the session comes whole
      if (outcome === 'out-of-step' && saved !== undefined) await save(sessionId, { ...saved, token: undefined, savedAt: Date.now() });
      return outcome;
    },
  };
}
