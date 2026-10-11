import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createDrawers } from '../public/view/drawers.js';

/**
 * A phone-sized page at session a, wired as app.js wires it: the drawers hear every change of the address.
 * @param {import('node:test').TestContext} t
 */
function pageAtSession(t) {
  const { window } = new JSDOM('<!doctype html><html><body><div id="backdrop"></div></body></html>', { url: 'http://localhost/#/a' });
  t.after(() => window.close());
  const root = window.document.documentElement;
  const backdrop = window.document.getElementById('backdrop');
  assert.ok(backdrop);
  const drawers = createDrawers({ root, backdrop, history: window.history });
  window.addEventListener('hashchange', () => drawers.arrive());
  return { window, root, drawers };
}

/**
 * Resolves once the page has heard the address change (after the drawers did).
 * @param {import('jsdom').DOMWindow} window
 */
function arrival(window) {
  return new Promise((resolve) => window.addEventListener('hashchange', resolve, { once: true }));
}

// The swipe from the left edge of a phone is the browser's Back, and it shows the page as it was left — with the list open
test('drawers_Should_ShowSessionListAgain_When_GoingBackToPageLeftWithItOpen', async (t) => {
  const { window, root, drawers } = pageAtSession(t);
  drawers.toggle('sessions');
  window.location.hash = '#/b';
  await arrival(window);

  window.history.back();
  await arrival(window);

  assert.equal(root.dataset.drawer, 'sessions');
});

// Choosing a session in the list goes to its address: the list makes way for it
test('drawers_Should_OpenNewPageWithoutDrawer', async (t) => {
  const { window, root, drawers } = pageAtSession(t);
  drawers.toggle('sessions');

  window.location.hash = '#/b';
  await arrival(window);

  assert.equal(root.dataset.drawer, undefined);
});

test('drawers_Should_KeepPageClosed_When_GoingBackToPageLeftAfterClosingDrawer', async (t) => {
  const { window, root, drawers } = pageAtSession(t);
  drawers.toggle('sessions');
  drawers.close();
  window.location.hash = '#/b';
  await arrival(window);

  window.history.back();
  await arrival(window);

  assert.equal(root.dataset.drawer, undefined);
});
