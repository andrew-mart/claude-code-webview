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
 * @returns {Promise<{ fromBox: string[], fromPage: boolean }>} — fromBox: what the box asked the viewer to do; fromPage:
 *   whether the page's Esc stopped Claude
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
  const composer = createComposer(sessionId, { agent: 'claude', focusBox: 'no', placeOf: () => undefined, asides: createAsideStore(), onSent: () => undefined });
  window.document.body.append(composer.element);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const box = composer.element.querySelector('.composer-input');
  assert.ok(box instanceof window.HTMLTextAreaElement);
  box.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const fromBox = asked.filter((path) => path === '/api/interrupt');
  const fromPage = composer.stop();
  composer.dispose();
  composer.element.remove();
  return { fromBox, fromPage };
}

// Esc stops Claude, as in its terminal: pressed in the box, or anywhere on the page with nothing else to close; while
// Claude is not working there is nothing to stop
test('composer_Should_StopClaudeOnEscape_WhileItWorks', async () => {
  assert.deepEqual([await escapeWhile('busy'), await escapeWhile('idle')], [
    { fromBox: ['/api/interrupt'], fromPage: true },
    { fromBox: [], fromPage: false },
  ]);
});
