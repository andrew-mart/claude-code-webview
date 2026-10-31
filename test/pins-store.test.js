import { test } from 'node:test';
import assert from 'node:assert/strict';

// the store listens for the window's focus; nothing else of a page is needed
Object.assign(globalThis, { window: { addEventListener: () => undefined, removeEventListener: () => undefined } });
const { createPinsStore } = await import('../public/view/pins-store.js');

const spec = 'D:\\dev\\shop\\docs\\spec.md';

// A file pinned shows at once where it was pinned to — the server told so — and unpinned it goes from everywhere it is
// pinned, the server told each; the pins as the server keeps them then replace what shows
test('pinsStore_Should_PinFileWhereAsked_AndUnpinItFromEverywhere', async () => {
  /** @type {{ scope: unknown, change: Record<string, unknown> }[]} */
  const sent = [];
  /** @type {((json: unknown) => void)[]} */
  const replies = [];
  globalThis.fetch = async (url, init) =>
    new Promise((resolve) => {
      if (typeof init?.body === 'string') {
        const { scope, change } = JSON.parse(init.body);
        sent.push({ scope, change });
      }
      replies.push((json) => resolve(new Response(JSON.stringify(json))));
    });
  /** @type {string[]} */
  const shown = [];
  const store = createPinsStore('s1', (pins) => shown.push(`folder ${pins.folder.length}, session ${pins.session.length}`));
  replies.shift()?.({ folder: [], session: [{ path: spec, at: '2026-10-28T09:00:00.000Z' }] });
  await new Promise((settled) => setTimeout(settled, 0));

  store.pin('folder', spec);
  store.unpin(spec);

  assert.deepEqual(
    { shown, sent: sent.map(({ scope, change }) => [scope, change.action]), now: store.now() },
    {
      shown: ['folder 0, session 1', 'folder 1, session 1', 'folder 0, session 1', 'folder 0, session 0'],
      sent: [
        ['folder', 'add'],
        ['folder', 'remove'],
        ['session', 'remove'],
      ],
      now: { folder: [], session: [] },
    },
  );
});
