import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body><input id="search"></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage, HTMLElement: window.HTMLElement, File: window.File });
const { createComposer } = await import('../public/view/composer-view.js');
const { createAsideStore } = await import('../public/view/aside-store.js');

const sessionId = '3f2c9a50-1111-4222-8333-944455556666';

/**
 * The page with one session opened: the viewer says it runs in a herdr pane, so the box is usable.
 * @param {{ pointer: 'fine' | 'coarse', focusBox: 'when-ready' | 'no', typingInSearch: boolean }} setting — pointer: a
 *   mouse and a physical keyboard, or a phone's touch; focusBox: the user chose the session, or following switched to it
 */
async function openedSession({ pointer, focusBox, typingInSearch }) {
  Object.assign(globalThis, {
    matchMedia: (/** @type {string} */ query) => ({ matches: query === '(pointer: coarse)' && pointer === 'coarse' }),
    fetch: async () => new Response(JSON.stringify({ state: 'live', status: 'idle', pane: 'w1:p1' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  const search = window.document.getElementById('search');
  assert.ok(search instanceof window.HTMLInputElement);
  if (typingInSearch) search.focus();
  else search.blur();
  const composer = createComposer(sessionId, { agent: 'claude', focusBox, placeOf: () => undefined, asides: createAsideStore() });
  window.document.body.append(composer.element);
  // the viewer's answer about the session arrives
  await new Promise((resolve) => setTimeout(resolve, 20));
  const active = window.document.activeElement;
  composer.dispose();
  composer.element.remove();
  return active?.className === 'composer-input' ? 'box' : active?.id === 'search' ? 'search' : 'nothing';
}

// A session the user opens on a computer is ready to be written to at once; a phone's keyboard would cover the feed,
// a session that following switched to is not the one the user was typing to, and the search box keeps its typing
test('composer_Should_FocusBox_OnlyForSessionUserOpenedOnComputer', async () => {
  /** @type {Parameters<typeof openedSession>[0][]} */
  const settings = [
    { pointer: 'fine', focusBox: 'when-ready', typingInSearch: false },
    { pointer: 'coarse', focusBox: 'when-ready', typingInSearch: false },
    { pointer: 'fine', focusBox: 'no', typingInSearch: false },
    { pointer: 'fine', focusBox: 'when-ready', typingInSearch: true },
  ];

  const focused = [];
  for (const setting of settings) focused.push(await openedSession(setting));

  assert.deepEqual(focused, ['box', 'nothing', 'nothing', 'search']);
});
