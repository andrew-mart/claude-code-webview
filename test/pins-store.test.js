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

// A path typed by hand is pinned once the viewer finds a file there — then "pinned" comes back; with no file there the
// pin goes again and why comes back. A pinned file named by hand is named wherever it is pinned
test('pinsStore_Should_TellWhetherPathIsPinned_AndNamePinWhereverItIsPinned', async () => {
  const pinned = { path: spec, at: '2026-10-28T09:00:00.000Z' };
  /** @type {{ scope: unknown, change: Record<string, unknown> }[]} */
  const sent = [];
  globalThis.fetch = async (url, init) => {
    if (typeof init?.body !== 'string') return new Response(JSON.stringify({ folder: [pinned], session: [pinned] }));
    const { scope, change } = JSON.parse(init.body);
    sent.push({ scope, change });
    if (change.action === 'add' && change.pin.path === 'D:/dev/shop/gone.md') return new Response(JSON.stringify({ ok: false, error: 'not-found' }), { status: 404 });
    return new Response(JSON.stringify({ folder: [pinned], session: [pinned, change.pin ?? pinned] }));
  };
  const store = createPinsStore('s1', () => undefined);
  const settled = () => new Promise((done) => setTimeout(done, 0));
  await settled();

  const gone = await store.pin('session', 'D:/dev/shop/gone.md');
  await settled();
  const afterGone = store.now().session.map((pin) => pin.path);
  const outcomes = [gone, await store.pin('session', 'D:/dev/shop/api.md')];
  store.rename(spec, 'Spec v2');

  assert.deepEqual(
    { outcomes, afterGone, named: sent.filter(({ change }) => change.action === 'name').map(({ scope, change }) => [scope, change.path, change.name]) },
    {
      outcomes: ['not-found', 'pinned'],
      afterGone: [spec],
      named: [
        ['folder', spec, 'Spec v2'],
        ['session', spec, 'Spec v2'],
      ],
    },
  );
});
