import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage, HTMLElement: window.HTMLElement, File: window.File });
const { createComposer } = await import('../public/view/composer-view.js');
const { createAsideStore } = await import('../public/view/aside-store.js');

const sessionId = '3f2c9a50-1111-4222-8333-944455556666';

// A long text pasted into the box need not cover the conversation: the box folds to a few lines and unfolds again; a
// short text has nothing to fold, and an emptied box is itself again
test('composer_Should_FoldTallBox_ToReadConversation', async () => {
  Object.assign(globalThis, {
    matchMedia: () => ({ matches: false }),
    fetch: async () => new Response(JSON.stringify({ state: 'live', status: 'idle', pane: 'w1:p1' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  const composer = createComposer(sessionId, { agent: 'claude', focusBox: 'no', placeOf: () => undefined, asides: createAsideStore(), onSent: () => undefined });
  window.document.body.append(composer.element);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const box = composer.element.querySelector('.composer-input');
  const form = composer.element.querySelector('.composer-box');
  const fold = composer.element.querySelector('.composer-fold');
  assert.ok(box instanceof window.HTMLTextAreaElement && form instanceof window.HTMLElement && fold instanceof window.HTMLButtonElement);
  // jsdom lays nothing out: a text's height in the box is told here, a line per 40 characters
  Object.defineProperty(box, 'scrollHeight', { get: () => 8 + 23 * Math.ceil(box.value.length / 40), configurable: true });
  /** @param {string} text */
  const type = (text) => {
    box.value = text;
    box.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const look = () => ({ button: !fold.hidden, folded: form.classList.contains('folded') });

  type('A short question');
  const short = look();
  type('A long log pasted in. '.repeat(40));
  const tall = look();
  fold.click();
  const folded = look();
  fold.click();
  const unfolded = look();
  fold.click();
  type('');
  const emptied = look();
  composer.dispose();

  assert.deepEqual({ short, tall, folded, unfolded, emptied }, {
    short: { button: false, folded: false },
    tall: { button: true, folded: false },
    folded: { button: true, folded: true },
    unfolded: { button: true, folded: false },
    emptied: { button: false, folded: false },
  });
});
