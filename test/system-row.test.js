import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, { window, document: window.document });
const { createSystemRow } = await import('../public/view/system-row.js');

const gib = 1024 ** 3;

/**
 * A page whose clock the test moves by hand, and that tells the row when it comes into view and goes out of it.
 */
function pageInView() {
  let now = 0;
  /** @type {{ at: number, run: () => void, id: number }[]} */
  let timers = [];
  let ids = 0;
  /** @type {{ seen: (entries: readonly { isIntersecting: boolean }[]) => void, watching: boolean }[]} */
  const observers = [];
  class IntersectionObserver {
    /** @param {(entries: readonly { isIntersecting: boolean }[]) => void} seen */
    constructor(seen) {
      this.watched = { seen, watching: false };
      observers.push(this.watched);
    }
    observe() {
      this.watched.watching = true;
    }
    disconnect() {
      this.watched.watching = false;
    }
  }
  /** @type {DocumentVisibilityState} */
  const visibilityState = 'visible';
  return {
    page: {
      IntersectionObserver,
      document: { visibilityState, addEventListener: () => undefined, removeEventListener: () => undefined },
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
    /** @param {boolean} inView */
    view(inView) {
      for (const observer of observers) if (observer.watching) observer.seen([{ isIntersecting: inView }]);
    },
    now: () => now,
  };
}

/** Lets the answers given settle. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

// The row asks how busy the viewer's computer is only while it is in view — the details open on a phone — at once as it
// comes into view, then every so often, and shows what it was told
test('systemRow_Should_AskHowBusyTheComputerIs_OnlyWhileInView_AndShowIt', async () => {
  const shown = pageInView();
  /** @type {number[]} */
  const asked = [];
  const { row } = createSystemRow({
    page: shown.page,
    read: async () => {
      asked.push(shown.now());
      return { cpu: 31, memory: { used: 12 * gib, total: 32 * gib }, gpu: undefined };
    },
    readProcesses: async () => undefined,
    everyMs: 3000,
  });

  shown.pass(6000);
  shown.view(true);
  await settled();
  shown.pass(3000);
  await settled();
  shown.view(false);
  shown.pass(9000);

  const shownValues = [...row.querySelectorAll('.system-meters:not([hidden]) .system-meter:not([hidden]) .system-meter-value')].map((value) => value.textContent);
  assert.deepEqual({ asked, name: row.querySelector('dt')?.textContent, shownValues }, { asked: [6000, 9000], name: 'Computer', shownValues: ['31%', '12.0/32.0 GB'] });
});

// Let go — the session it stood in put away — the row asks no more, though it was in view then
test('systemRow_Should_AskNoMore_OnceLetGo', async () => {
  const shown = pageInView();
  /** @type {number[]} */
  const asked = [];
  const { dispose } = createSystemRow({
    page: shown.page,
    read: async () => {
      asked.push(shown.now());
      return undefined;
    },
    readProcesses: async () => undefined,
    everyMs: 3000,
  });

  shown.view(true);
  await settled();
  dispose();
  shown.pass(9000);
  shown.view(true);
  shown.pass(9000);

  assert.deepEqual(asked, [0]);
});
