import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createPageAddress } from '../public/view/page-address.js';

/**
 * A page at session a.
 * @param {import('node:test').TestContext} t
 */
function pageAtSession(t) {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/#/a' });
  t.after(() => window.close());
  return window;
}

/**
 * Resolves once the page has heard the address change.
 * @param {import('jsdom').DOMWindow} window
 */
function arrival(window) {
  return new Promise((resolve) => window.addEventListener('hashchange', resolve, { once: true }));
}

// In the iPhone's home-screen app the swipe from the left edge is Back: WebKit slides in a picture of the page left and
// at times never takes it away, the page frozen under it. There the page goes to another session in place — nothing to
// go back to, no picture; elsewhere Back goes to the session before
test('pageAddress_Should_GoInPlace_OnlyWhereHistoryIsReplaced', async (t) => {
  /** @type {Record<string, { hash: string, entries: number }>} */
  const after = {};
  for (const history of /** @type {const} */ (['replaced', 'kept'])) {
    const window = pageAtSession(t);
    const address = createPageAddress({ location: window.location, history });
    address.go('#/b');
    await arrival(window);
    after[history] = { hash: window.location.hash, entries: window.history.length };
  }

  assert.deepEqual(after, { replaced: { hash: '#/b', entries: 1 }, kept: { hash: '#/b', entries: 2 } });
});

// The session list's links go as the page does: in place in the home-screen app, a page further elsewhere
test('pageAddress_Should_FollowLinksInPage_AsItGoes', async (t) => {
  /** @type {Record<string, { hash: string, entries: number }>} */
  const after = {};
  for (const history of /** @type {const} */ (['replaced', 'kept'])) {
    const window = pageAtSession(t);
    createPageAddress({ location: window.location, history }).followLinksIn(window.document);
    const link = window.document.createElement('a');
    link.href = '#/b';
    window.document.body.append(link);
    link.click();
    await arrival(window);
    after[history] = { hash: window.location.hash, entries: window.history.length };
  }

  assert.deepEqual(after, { replaced: { hash: '#/b', entries: 1 }, kept: { hash: '#/b', entries: 2 } });
});

// A click the page took for itself — the open tab touched again shows its buttons — goes nowhere
test('pageAddress_Should_LeaveLinkAlone_When_ItsClickIsTaken', async (t) => {
  const window = pageAtSession(t);
  createPageAddress({ location: window.location, history: 'replaced' }).followLinksIn(window.document);
  const link = window.document.createElement('a');
  link.href = '#/b';
  link.addEventListener('click', (event) => event.preventDefault());
  window.document.body.append(link);

  link.click();
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(window.location.hash, '#/a');
});
