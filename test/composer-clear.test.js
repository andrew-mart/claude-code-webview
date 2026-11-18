import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage, HTMLElement: window.HTMLElement, File: window.File, Blob: window.Blob, FileReader: window.FileReader });
const { createComposer } = await import('../public/view/composer-view.js');
const { createAsideStore } = await import('../public/view/aside-store.js');

const sessionId = '7a1c3e50-5555-4666-8777-988899990000';
const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

/** The box of the session, as a page opens it. */
const opened = () => createComposer(sessionId, { agent: 'claude', focusBox: 'no', placeOf: () => undefined, asides: createAsideStore(), onSent: () => undefined, onDialog: () => undefined });

// The clear button empties the box — a long text gone at a press, where a phone has no Ctrl+A — and its draft with it:
// the box opened again stays empty
test('composer_Should_EmptyTheBoxAndItsDraft_When_ClearIsPressed', async (t) => {
  Object.assign(globalThis, {
    matchMedia: () => ({ matches: false }),
    // a box opened with a draft waits a frame: without it a box left with a draft would throw, its poll left running
    requestAnimationFrame: (/** @type {() => void} */ callback) => setTimeout(callback, 0),
    fetch: async () => new Response(JSON.stringify({ state: 'live', status: 'idle', pane: 'w1:p1' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  const composer = opened();
  t.after(() => composer.dispose());
  window.document.body.append(composer.element);
  await settled();
  const box = composer.element.querySelector('.composer-input');
  const clear = composer.element.querySelector('.composer-clear');
  assert.ok(box instanceof window.HTMLTextAreaElement && clear instanceof window.HTMLButtonElement);
  box.value = 'Check the totals of last month\nRound the taxes to cents\nSend the report to the team';
  box.dispatchEvent(new window.Event('input', { bubbles: true }));

  clear.click();
  const emptied = box.value;
  composer.dispose();
  composer.element.remove();
  const again = opened();
  t.after(() => again.dispose());
  const reopened = again.element.querySelector('.composer-input');

  assert.deepEqual({ emptied, reopened: reopened instanceof window.HTMLTextAreaElement ? reopened.value : 'no box' }, { emptied: '', reopened: '' });
});
