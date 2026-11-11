import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pollWhileShown } from '../public/view/polling.js';

/**
 * A page whose clock, answers and visibility the test moves by hand.
 * @param {DocumentVisibilityState} visibilityState
 */
function pageAt(visibilityState) {
  let now = 0;
  /** @type {{ at: number, run: () => void, id: number }[]} */
  let timers = [];
  let ids = 0;
  /** @type {(() => void)[]} */
  const listeners = [];
  const document = {
    visibilityState,
    addEventListener: (/** @type {'visibilitychange'} */ type, /** @type {() => void} */ listener) => void listeners.push(listener),
    removeEventListener: (/** @type {'visibilitychange'} */ type, /** @type {() => void} */ listener) => void listeners.splice(listeners.indexOf(listener), 1),
  };
  return {
    page: {
      document,
      setTimeout: (/** @type {() => void} */ run, /** @type {number} */ ms) => {
        ids++;
        timers.push({ at: now + ms, run, id: ids });
        return ids;
      },
      clearTimeout: (/** @type {number} */ id) => {
        timers = timers.filter((timer) => timer.id !== id);
      },
    },
    /** @param {number} ms */
    pass(ms) {
      now += ms;
      const due = timers.filter((timer) => timer.at <= now);
      timers = timers.filter((timer) => timer.at > now);
      for (const timer of due) timer.run();
    },
    /** @param {DocumentVisibilityState} state */
    show(state) {
      document.visibilityState = state;
      for (const listener of [...listeners]) listener();
    },
    now: () => now,
  };
}

/** Lets the answers given settle. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

// A poll asks at once, then again a while after its answer came: an answer slower than that — a slow link — delays the
// next ask rather than another going out beside it, so the asks never pile up
test('pollWhileShown_Should_AskAgainOnlyAWhileAfterTheAnswerCame_NeverTwiceAtOnce', async () => {
  const shown = pageAt('visible');
  /** @type {number[]} */
  const asked = [];
  /** @type {(() => void)[]} */
  const answers = [];
  pollWhileShown(shown.page, {
    ask: () => {
      asked.push(shown.now());
      return new Promise((resolve) => answers.push(resolve));
    },
    everyMs: 3000,
    first: 'now',
  });

  shown.pass(3000);
  shown.pass(3000);
  answers.shift()?.();
  await settled();
  shown.pass(2999);
  const beforeItsTime = asked.length;
  shown.pass(1);
  answers.shift()?.();
  await settled();
  shown.pass(3000);

  assert.deepEqual({ asked, beforeItsTime }, { asked: [0, 9000, 12000], beforeItsTime: 1 });
});

// A page out of sight asks nothing — a phone's app put away, a tab behind others — and once it is in sight again it
// asks at once, then on as before; stopped, it asks no more
test('pollWhileShown_Should_AskNothingWhileHidden_AndAtOnceWhenShownAgain_UntilStopped', async () => {
  const shown = pageAt('hidden');
  /** @type {number[]} */
  const asked = [];
  const poll = pollWhileShown(shown.page, { ask: async () => void asked.push(shown.now()), everyMs: 3000, first: 'now' });

  shown.pass(10_000);
  shown.show('visible');
  await settled();
  shown.pass(3000);
  await settled();
  shown.show('hidden');
  shown.pass(9000);
  await settled();
  shown.pass(1000);
  shown.show('visible');
  await settled();
  poll.stop();
  shown.pass(9000);
  shown.show('hidden');
  shown.show('visible');
  await settled();

  assert.deepEqual(asked, [10_000, 13_000, 23_000]);
});

// A poll whose first answer the page has asked for itself — the session list, before the session in the address opens
// from it — asks first a while after it starts, not again at once
test('pollWhileShown_Should_AskFirstAWhileAfterStarting_WhenAskedSo', async () => {
  const shown = pageAt('visible');
  /** @type {number[]} */
  const asked = [];
  pollWhileShown(shown.page, { ask: async () => void asked.push(shown.now()), everyMs: 4000, first: 'after-a-while' });

  await settled();
  shown.pass(4000);
  await settled();
  shown.pass(4000);

  assert.deepEqual(asked, [4000, 8000]);
});

// Told something changed — the viewer says so over the page's stream — a poll asks at once, not at its time. Told so
// again while it asks, it asks once more as that answer comes, which may have been read before the change; its next
// time comes a while after the last answer
test('pollWhileShown_Should_AskAtOnceWhenPoked_AndOnceMoreAfterAnAnswerPokedMeanwhile', async () => {
  const shown = pageAt('visible');
  /** @type {number[]} */
  const asked = [];
  /** @type {(() => void)[]} */
  const answers = [];
  const poll = pollWhileShown(shown.page, {
    ask: () => {
      asked.push(shown.now());
      return new Promise((resolve) => answers.push(resolve));
    },
    everyMs: 60_000,
    first: 'after-a-while',
  });

  shown.pass(5000);
  poll.poke();
  shown.pass(500);
  poll.poke();
  poll.poke();
  shown.pass(500);
  answers.shift()?.();
  await settled();
  answers.shift()?.();
  await settled();
  shown.pass(59_999);
  const beforeItsTime = asked.length;
  shown.pass(1);

  assert.deepEqual({ asked, beforeItsTime }, { asked: [5000, 6000, 66_000], beforeItsTime: 2 });
});
