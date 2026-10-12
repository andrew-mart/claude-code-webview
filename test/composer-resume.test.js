import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage, HTMLElement: window.HTMLElement, File: window.File });
const { createComposer } = await import('../public/view/composer-view.js');
const { createAsideStore } = await import('../public/view/aside-store.js');

const sessionId = '3f2c9a50-1111-4222-8333-944455556666';

// A session that is not running has nothing to write to: in the box's place, where it ran and a button that opens it
// there again
test('composer_Should_OfferToOpenSessionAgain_InPlaceOfBox_WhenItIsNotRunning', async () => {
  /** @type {string[]} */
  const asked = [];
  Object.assign(globalThis, {
    matchMedia: () => ({ matches: false }),
    fetch: async (/** @type {string} */ path) => {
      asked.push(path);
      const body = path === '/api/history/reopen' ? { ok: true, target: `#/${sessionId}` } : { state: 'offline' };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const composer = createComposer(sessionId, { focusBox: 'no', placeOf: () => ({ workspace: 'trip_plans', tab: 'route planner' }), asides: createAsideStore() });
  window.document.body.append(composer.element);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const box = composer.element.querySelector('.composer-box');
  const card = composer.element.querySelector('.composer-resume');
  assert.ok(box instanceof window.HTMLElement && card instanceof window.HTMLElement);
  const shown = { box: !box.hidden, card: !card.hidden, where: card.querySelector('.composer-resume-where')?.textContent };

  card.querySelector('button')?.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  composer.dispose();

  assert.deepEqual({ shown, reopened: asked.filter((path) => path === '/api/history/reopen') }, {
    shown: { box: false, card: true, where: 'trip_plans · route planner' },
    reopened: ['/api/history/reopen'],
  });
});
