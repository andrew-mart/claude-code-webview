import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage, sessionStorage: window.sessionStorage, HTMLElement: window.HTMLElement, File: window.File });
const { createComposer } = await import('../public/view/composer-view.js');
const { createAsideStore } = await import('../public/view/aside-store.js');

const sessionId = '3f2c9a50-1111-4222-8333-944455556666';
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * The box of a session in a herdr pane, Claude busy in it or not; what the page asked the viewer to send.
 * @param {'busy' | 'idle'} status
 * @param {(box: HTMLTextAreaElement, element: HTMLElement) => void} act
 * @returns {Promise<{ sent: unknown[], button: boolean }>} — button: the send-now button is there
 */
async function sendWhile(status, act) {
  /** @type {unknown[]} */
  const sent = [];
  Object.assign(globalThis, {
    matchMedia: () => ({ matches: false }),
    fetch: async (/** @type {string} */ path, /** @type {RequestInit | undefined} */ init) => {
      if (path === '/api/send') sent.push(JSON.parse(String(init?.body)));
      const body = path === '/api/send' ? { ok: true, pane: 'w1:p1' } : { state: 'live', status, pane: 'w1:p1' };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const composer = createComposer(sessionId, { focusBox: 'no', placeOf: () => undefined, asides: createAsideStore() });
  window.document.body.append(composer.element);
  await settle();
  const box = composer.element.querySelector('.composer-input');
  assert.ok(box instanceof window.HTMLTextAreaElement);
  const button = composer.element.querySelector('.composer-send-now');
  act(box, composer.element);
  await settle();
  composer.dispose();
  composer.element.remove();
  // of what was sent, the text and whether it went now
  const told = sent.map((body) => (typeof body === 'object' && body !== null ? Object.fromEntries(Object.entries(body).filter(([key]) => key === 'text' || key === 'now')) : body));
  return { sent: told, button: button instanceof window.HTMLElement && !button.hidden };
}

/** @param {string} text @returns {(box: HTMLTextAreaElement) => void} */
const ctrlEnter = (text) => (box) => {
  box.value = text;
  box.dispatchEvent(new window.Event('input', { bubbles: true }));
  box.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
};

// While Claude works a message waits in Claude Code's queue; Ctrl+Enter — or ⏩ — sends it at once, an empty box sending
// what waits there. While Claude is idle there is no queue: Ctrl+Enter sends as Enter does
test('composer_Should_SendNowPastQueue_WhileClaudeWorks', async () => {
  const busyKeys = await sendWhile('busy', ctrlEnter('Stop and check the logs'));
  const busyButton = await sendWhile('busy', (box, element) => element.querySelector('.composer-send-now')?.dispatchEvent(new window.Event('click')));
  const idleKeys = await sendWhile('idle', ctrlEnter('Go on'));

  assert.deepEqual([busyKeys, busyButton, idleKeys], [
    { sent: [{ text: 'Stop and check the logs', now: true }], button: true },
    { sent: [{ text: '', now: true }], button: true },
    { sent: [{ text: 'Go on' }], button: false },
  ]);
});
