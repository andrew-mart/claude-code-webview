import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage, HTMLElement: window.HTMLElement, File: window.File });
const { createComposer } = await import('../public/view/composer-view.js');
const { createAsideStore } = await import('../public/view/aside-store.js');

const sessionId = '3f2c9a50-1111-4222-8333-944455556666';

/**
 * The box of a session in a herdr pane, Claude busy in it or not; Esc pressed in the box and then asked of the page.
 * @param {'busy' | 'idle'} status
 * @returns {Promise<{ fromBox: string[], fromPage: boolean, pageGotIt: boolean }>} — fromBox: what the box asked the
 *   viewer to do; fromPage: whether the page's Esc stopped Claude; pageGotIt: whether the box's Esc reached the page
 */
async function escapeWhile(status) {
  /** @type {string[]} */
  const asked = [];
  Object.assign(globalThis, {
    matchMedia: () => ({ matches: false }),
    fetch: async (/** @type {string} */ path) => {
      asked.push(path);
      const body = path === '/api/interrupt' ? { ok: true, pane: 'w1:p1', prompt: undefined } : { state: 'live', status, pane: 'w1:p1' };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const composer = createComposer(sessionId, { agent: 'claude', focusBox: 'no', placeOf: () => undefined, asides: createAsideStore(), onSent: () => undefined, onDialog: () => undefined });
  window.document.body.append(composer.element);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const box = composer.element.querySelector('.composer-input');
  assert.ok(box instanceof window.HTMLTextAreaElement);
  let pageGotIt = false;
  const page = (/** @type {KeyboardEvent} */ event) => {
    if (event.key === 'Escape') pageGotIt = true;
  };
  window.document.addEventListener('keydown', page);
  box.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  window.document.removeEventListener('keydown', page);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const fromBox = asked.filter((path) => path === '/api/interrupt');
  const fromPage = composer.stop();
  composer.dispose();
  composer.element.remove();
  return { fromBox, fromPage, pageGotIt };
}

// Esc stops Claude — cancels what it asks — as in its terminal: pressed in the box, or anywhere on the page with nothing
// else to close; while Claude is not working there is nothing to stop. Pressed in the box it is the box's alone: the
// page around it — a note open beside it — closes nothing on it
test('composer_Should_StopClaudeOnEscape_WhileItWorks_LeavingThePageAsItIs', async () => {
  assert.deepEqual([await escapeWhile('busy'), await escapeWhile('idle')], [
    { fromBox: ['/api/interrupt'], fromPage: true, pageGotIt: false },
    { fromBox: [], fromPage: false, pageGotIt: false },
  ]);
});
