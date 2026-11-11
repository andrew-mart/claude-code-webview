import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createDrawers } from '../public/view/drawers.js';

/**
 * A phone-sized page at session a, wired as app.js wires it: the drawers hear every change of the address.
 * @param {import('node:test').TestContext} t
 * @param {'kept' | 'replaced'} pages — whether going on keeps the page left to go back to, as a browser does, or
 *   replaces it, as the iPhone's home-screen app does (page-address.js)
 */
function pageAtSession(t, pages = /** @type {const} */ ('kept')) {
  const { window } = new JSDOM('<!doctype html><html><body><div id="backdrop"></div></body></html>', { url: 'http://localhost/#/a' });
  t.after(() => window.close());
  const root = window.document.documentElement;
  const backdrop = window.document.getElementById('backdrop');
  assert.ok(backdrop);
  const drawers = createDrawers({ root, backdrop, history: window.history, pages });
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
  const list = window.document.createElement('nav');
  list.innerHTML = '<a href="#/b">Refunds</a>';
  window.document.body.append(list);
  drawers.closeOnLinksIn(list);
  drawers.toggle('sessions');
  list.querySelector('a')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
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

// In the iPhone's home-screen app the session chosen takes the place of the page in its history entry, and WebKit keeps
// that entry's state — the list open — with the new address: the list makes way for the session all the same
test('drawers_Should_OpenNewPageWithoutDrawer_InHomeScreenApp_ThoughItsEntryStillHoldsTheDrawer', (t) => {
  const { window, root, drawers } = pageAtSession(t, 'replaced');
  drawers.toggle('sessions');

  // as WebKit replaces the address in place: the entry's state stays, the page hears the change
  window.history.replaceState(window.history.state, '', '#/b');
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));

  assert.equal(root.dataset.drawer, undefined);
});

// The session chosen in the list may be the one shown: the address stays, nothing arrives — the list makes way for it all
// the same; a click taken for something else there — the open herdr row's buttons — leaves it open
test('drawers_Should_MakeWayForPageShown_When_LinkToItIsChosen_UnlessClickIsTakenForSomethingElse', (t) => {
  const { window, root, drawers } = pageAtSession(t);
  const list = window.document.createElement('nav');
  list.innerHTML = '<a class="row-open" href="#/a"><span>Payments</span></a><a class="row-dressed" href="#/a">Payments</a>';
  window.document.body.append(list);
  list.querySelector('.row-dressed')?.addEventListener('click', (event) => event.preventDefault());
  drawers.closeOnLinksIn(list);
  /** @param {string} selector */
  const tap = (selector) => list.querySelector(selector)?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  drawers.toggle('sessions');

  tap('.row-dressed');
  const takenElse = root.dataset.drawer;
  tap('.row-open span');

  assert.deepEqual({ takenElse, chosen: root.dataset.drawer }, { takenElse: 'sessions', chosen: undefined });
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

// The drawer open is told by its name — the session list, the outline — and none once it is closed: a swipe closes it
// toward the side it came from
test('drawers_Should_TellDrawerOpen', (t) => {
  const { drawers } = pageAtSession(t);

  const told = [drawers.shown()];
  drawers.toggle('outline');
  told.push(drawers.shown());
  drawers.toggle('sessions');
  told.push(drawers.shown());
  drawers.close();
  told.push(drawers.shown());

  assert.deepEqual(told, [undefined, 'outline', 'sessions', undefined]);
});
