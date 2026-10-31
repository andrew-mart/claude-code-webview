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
 * The box of a session Claude works in, the viewer keeping its prompts set aside as the server does; what the page sent
 * to the terminal.
 * @param {import('node:test').TestContext} t
 * @param {readonly import('../public/model/later.js').LaterPrompt[]} kept — set aside before
 */
async function boxWhileClaudeWorks(t, kept = []) {
  // the box of the session in the test before kept its draft
  window.localStorage.clear();
  let setAside = [...kept];
  /** @type {string[]} */
  const sent = [];
  Object.assign(globalThis, {
    matchMedia: () => ({ matches: false }),
    fetch: async (/** @type {string} */ path, /** @type {RequestInit | undefined} */ init) => {
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      /** @type {unknown} */
      let reply = { state: 'live', status: 'busy', pane: 'w1:p1' };
      if (path === '/api/send') {
        sent.push(body.text);
        reply = { ok: true, pane: 'w1:p1' };
      } else if (path.startsWith('/api/later')) {
        const change = body?.change;
        if (change?.action === 'add') setAside = [...setAside, change.prompt];
        if (change?.action === 'remove') setAside = setAside.filter((prompt) => prompt.id !== change.id);
        reply = setAside;
      }
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const composer = createComposer(sessionId, { agent: 'claude', focusBox: 'no', placeOf: () => undefined, asides: createAsideStore(), onSent: () => undefined, onDialog: () => undefined });
  window.document.body.append(composer.element);
  t.after(() => {
    composer.dispose();
    composer.element.remove();
  });
  await settle();
  const box = composer.element.querySelector('.composer-input');
  assert.ok(box instanceof window.HTMLTextAreaElement);
  /** @param {string} text */
  const type = (text) => {
    box.value = text;
    box.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  /** @param {string} label — the button's aria-label, of the box or of a prompt set aside */
  const press = async (label) => {
    const button = composer.element.querySelector(`button[aria-label="${label}"]`);
    assert.ok(button instanceof window.HTMLButtonElement, `no button ${label}`);
    button.click();
    await settle();
  };
  const listed = () => [...composer.element.querySelectorAll('.later-text')].map((item) => item.textContent);
  return { box, type, press, listed, sent, kept: () => setAside.map((prompt) => prompt.text) };
}

// What comes to mind while Claude works is set aside, not sent: it would break into the turn. The box is free again,
// and the prompt waits over it — kept by the viewer
test('composer_Should_SetPromptAsideForLater_WithoutSendingIt', async (t) => {
  const page = await boxWhileClaudeWorks(t);

  page.type('Then add tests for the parser');
  await page.press('Set aside for later');

  assert.deepEqual({ box: page.box.value, listed: page.listed(), kept: page.kept(), sent: page.sent }, { box: '', listed: ['Then add tests for the parser'], kept: ['Then add tests for the parser'], sent: [] });
});

/** @type {import('../public/model/later.js').LaterPrompt} */
const kept = { id: 'l1', text: 'Then add tests for the parser', at: '2026-10-22T09:00:00.000Z' };

// A prompt set aside comes back into the box to be edited and sent, leaving the list; what the box already holds stays,
// the prompt after it
test('composer_Should_TakePromptSetAsideBackIntoBox_AfterWhatItHolds', async (t) => {
  const page = await boxWhileClaudeWorks(t, [kept]);

  page.type('Check the logs first');
  await page.press('Into the box');

  assert.deepEqual({ box: page.box.value, listed: page.listed(), kept: page.kept(), sent: page.sent }, { box: 'Check the logs first\n\nThen add tests for the parser', listed: [], kept: [], sent: [] });
});

// Its time come, a prompt set aside is sent as the box sends it and leaves the list — from an empty box only: words
// written in the box meanwhile are not sent with it, nor lost
test('composer_Should_SendPromptSetAside_OnlyFromEmptyBox', async (t) => {
  const page = await boxWhileClaudeWorks(t, [kept]);
  page.type('Half a thought');
  const sendWhileWriting = page.box.form?.parentElement?.querySelector('button[aria-label="Send it"]');
  assert.ok(sendWhileWriting instanceof window.HTMLButtonElement);
  const blocked = sendWhileWriting.disabled;

  page.type('');
  await page.press('Send it');

  assert.deepEqual({ blocked, sent: page.sent, listed: page.listed(), kept: page.kept(), box: page.box.value }, { blocked: true, sent: ['Then add tests for the parser'], listed: [], kept: [], box: '' });
});

// A prompt no longer wanted is let go: neither sent nor put into the box
test('composer_Should_LetPromptSetAsideGo', async (t) => {
  const page = await boxWhileClaudeWorks(t, [kept]);

  await page.press('Remove it');

  assert.deepEqual({ listed: page.listed(), kept: page.kept(), box: page.box.value, sent: page.sent }, { listed: [], kept: [], box: '', sent: [] });
});

// On a keyboard Alt+Enter sets the box's words aside, as Enter sends them
test('composer_Should_SetPromptAside_OnAltEnter', async (t) => {
  const page = await boxWhileClaudeWorks(t);

  page.type('And update the README');
  page.box.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true }));
  await settle();

  assert.deepEqual({ kept: page.kept(), sent: page.sent, box: page.box.value }, { kept: ['And update the README'], sent: [], box: '' });
});
