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
 * A prompt sent from the box, the viewer's answer held back until told: what the box said meanwhile, and after; what
 * the feed was told was sent.
 * @param {unknown} answer — the viewer's reply to the send
 */
async function sendHeld(answer) {
  /** @type {(() => void) | undefined} */
  let release;
  const held = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  Object.assign(globalThis, {
    matchMedia: () => ({ matches: false }),
    fetch: async (/** @type {string} */ path) => {
      if (path === '/api/send') await held;
      const body = path === '/api/send' ? answer : { state: 'live', status: 'idle', pane: 'w1:p1' };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  /** @type {string[]} */
  const sent = [];
  const composer = createComposer(sessionId, { agent: 'claude', focusBox: 'no', placeOf: () => undefined, asides: createAsideStore(), onSent: (text) => sent.push(text), onDialog: () => undefined });
  window.document.body.append(composer.element);
  await settle();
  const box = composer.element.querySelector('.composer-input');
  assert.ok(box instanceof window.HTMLTextAreaElement);
  box.value = 'Check the limits';
  box.dispatchEvent(new window.Event('input', { bubbles: true }));
  box.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const status = () => composer.element.querySelector('.composer-status')?.textContent;
  const meanwhile = status();
  release?.();
  await settle();
  const after = status();
  composer.dispose();
  composer.element.remove();
  return { meanwhile, after, sent };
}

// A prompt being sent says so at once — under a heavy load the terminal may take long to take it; taken, the feed shows
// it as sent until Claude Code writes it down; not taken, the feed is told nothing and the box says why
test('composer_Should_SayItSendsAtOnce_AndTellTheFeedWhatTheTerminalTook', async () => {
  const taken = await sendHeld({ ok: true, pane: 'w1:p1' });
  const refused = await sendHeld({ ok: false, error: 'send-failed' });

  assert.deepEqual(
    { meanwhile: [taken.meanwhile, refused.meanwhile], sent: [taken.sent, refused.sent], refusedSays: refused.after !== '' && refused.after !== taken.meanwhile },
    { meanwhile: ['Sending to the terminal…', 'Sending to the terminal…'], sent: [['Check the limits'], []], refusedSays: true },
  );
});

/**
 * The box over a terminal that shows — or does not — a dialog: whether it told the feed so.
 * @param {unknown} dialog — as /api/live tells it
 */
async function toldOfDialog(dialog) {
  Object.assign(globalThis, {
    matchMedia: () => ({ matches: false }),
    // the box kept what the test before typed: it is fitted to it on the next frame
    requestAnimationFrame: (/** @type {() => void} */ callback) => setTimeout(callback, 0),
    fetch: async () => new Response(JSON.stringify({ state: 'live', status: 'idle', pane: 'w1:p1', dialog }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  let told = false;
  const composer = createComposer(sessionId, { agent: 'claude', focusBox: 'no', placeOf: () => undefined, asides: createAsideStore(), onSent: () => undefined, onDialog: () => void (told = true) });
  window.document.body.append(composer.element);
  await settle();
  composer.dispose();
  composer.element.remove();
  return told;
}

// The terminal showing a dialog — which a slash command sent may have opened, /mcp — the feed is told: what it shows as
// sent may never be written down
test('composer_Should_TellTheFeed_WhenTerminalShowsDialog', async () => {
  const servers = { lines: ['Manage MCP servers'], options: [{ key: '', label: '✔ weather', detail: undefined, checked: undefined, current: true }], tabs: false, previews: true };

  assert.deepEqual({ shown: await toldOfDialog(servers), none: await toldOfDialog(undefined) }, { shown: true, none: false });
});
