import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFeedKeeper } from '../public/view/feed-keeper.js';
import { tailCheck } from '../public/model/feed-check.js';

const at = '2026-10-16T08:00:00.000Z';
/** @param {string} uuid */
const entry = (uuid) => ({ type: 'assistant', uuid, timestamp: at, message: { role: 'assistant', content: [{ type: 'text', text: uuid }] } });
/** What the viewer tells after what it sent, for the page to hold these. @param {string} token @param {readonly unknown[]} held */
const cursor = (token, held) => ({ token, shown: held.length, check: tailCheck(held.slice(-16)) });

/**
 * A keeper over a feed the test plays — answered by `answer` once asked for — and a store holding this copy.
 * @param {import('../public/view/offline-store.js').SavedFeed | undefined} kept
 * @param {(feed: { emit: (event: string, data?: unknown) => void, from: string | undefined, wanted: Record<string, unknown> }) => void} answer
 */
function keeperOf(kept, answer) {
  /** @type {{ wanted: Record<string, unknown>, from: string | undefined, closed: boolean }[]} */
  const feeds = [];
  /** @type {import('../public/view/offline-store.js').SavedFeed[]} */
  const saved = [];
  const keeper = createFeedKeeper({
    open: (wanted) => {
      /** @type {Record<string, ((data: unknown) => void)[]>} */
      const listeners = {};
      const { from, ...rest } = wanted;
      const feed = { wanted: rest, from: from(), closed: false };
      feeds.push(feed);
      const emit = (/** @type {string} */ event, /** @type {unknown} */ data) => {
        for (const listener of listeners[event] ?? []) listener(data ?? null);
      };
      setTimeout(() => answer({ emit, from: feed.from, wanted: rest }), 0);
      return {
        on: (event, listener) => void (listeners[event] ??= []).push(listener),
        close: () => {
          feed.closed = true;
        },
        closed: () => false,
      };
    },
    read: async () => kept,
    save: async (_, feed) => void saved.push(feed),
    tail: 800,
    keep: 3000,
    waitMs: 50,
  });
  return { keeper, feeds, saved };
}

// The copy kept of a session not open is brought up to date with what came since its token alone, and kept again with
// the viewer's new token; the feed is let go of once the viewer has sent it
test('feedKeeper_Should_BringCopyUpToDate_WithWhatCameSinceItsToken', async () => {
  const { keeper, feeds, saved } = keeperOf({ entries: [entry('a1')], earlier: 2, token: 't1', lastActivity: 1, savedAt: 1 }, ({ emit }) => {
    emit('entries', [entry('a2')]);
    emit('cursor', { token: 't2', shown: 4, check: tailCheck([entry('a1'), entry('a2')]) });
    emit('ready');
  });

  const outcome = await keeper.catchUp('s1');

  assert.deepEqual(
    { outcome, asked: feeds.map(({ wanted, from, closed }) => ({ wanted, from, closed })), saved: saved.map(({ entries, earlier, token }) => ({ entries, earlier, token })) },
    { outcome: 'kept', asked: [{ wanted: { session: 's1', tail: 800 }, from: 't1', closed: true }], saved: [{ entries: [entry('a1'), entry('a2')], earlier: 2, token: 't2' }] },
  );
});

// A session with no copy kept yet gets its latest entries, kept with the viewer's token to go on from next time
test('feedKeeper_Should_KeepLatestEntries_OfSessionWithNoCopy', async () => {
  const { keeper, feeds, saved } = keeperOf(undefined, ({ emit }) => {
    emit('earlier', { count: 5 });
    emit('entries', [entry('a6')]);
    emit('cursor', { token: 't6', shown: 6, check: tailCheck([entry('a6')]) });
    emit('ready');
  });

  const outcome = await keeper.catchUp('s1');

  assert.deepEqual(
    { outcome, from: feeds[0]?.from, saved: saved.map(({ entries, earlier, token }) => ({ entries, earlier, token })) },
    { outcome: 'kept', from: undefined, saved: [{ entries: [entry('a6')], earlier: 5, token: 't6' }] },
  );
});

// A copy out of step with what the viewer says it should hold is kept with no token: next time the session comes whole
test('feedKeeper_Should_DropTokenOfCopyOutOfStep', async () => {
  const { keeper, feeds, saved } = keeperOf({ entries: [entry('a1')], earlier: 0, token: 't1', lastActivity: 1, savedAt: 1 }, ({ emit }) => {
    emit('entries', [entry('a2')]);
    emit('cursor', cursor('t2', [entry('a2')]));
    emit('ready');
  });

  const outcome = await keeper.catchUp('s1');

  assert.deepEqual({ outcome, closed: feeds[0]?.closed, tokens: saved.map(({ token }) => token) }, { outcome: 'out-of-step', closed: true, tokens: [undefined] });
});

// The viewer does not send the session in time: the copy kept is left as it was, the feed let go of
test('feedKeeper_Should_GiveUp_When_ViewerDoesNotSendSessionInTime', async () => {
  const { keeper, feeds, saved } = keeperOf({ entries: [entry('a1')], earlier: 0, token: 't1', lastActivity: 1, savedAt: 1 }, () => undefined);

  const outcome = await keeper.catchUp('s1');

  assert.deepEqual({ outcome, closed: feeds[0]?.closed, saved: saved.length }, { outcome: 'no-answer', closed: true, saved: 0 });
});
