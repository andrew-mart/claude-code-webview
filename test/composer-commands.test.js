import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage, sessionStorage: window.sessionStorage, HTMLElement: window.HTMLElement, File: window.File });
const { createComposer } = await import('../public/view/composer-view.js');
const { createAsideStore } = await import('../public/view/aside-store.js');

const sessionId = '3f2c9a50-1111-4222-8333-944455556666';
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const offered = [
  { name: '/compact', hint: '[instructions]', about: 'Free up context by summarizing the conversation so far.', source: 'built-in' },
  { name: '/config', hint: '', about: 'Open the Settings interface.', source: 'built-in' },
  { name: '/tdd', hint: '[feature]', about: 'Test-driven development.', source: 'personal' },
];

// While a command's name is typed, the commands it finds show over the box, the best first; ↓ and Enter put the one
// picked in the box — sending nothing — a space after it; a click puts one in too; Esc puts the list away and stops
// nothing, though Claude works; a slash further on in the text offers nothing
test('composer_Should_OfferCommandsWhileOneIsTyped_AndPutThePickedOneInTheBox', async (t) => {
  /** @type {string[]} */
  const posted = [];
  Object.assign(globalThis, {
    matchMedia: () => ({ matches: false }),
    fetch: async (/** @type {string} */ path, /** @type {RequestInit | undefined} */ init) => {
      if (init?.method === 'POST') posted.push(path);
      const body = path.startsWith('/api/commands') ? offered : path.startsWith('/api/live') ? { state: 'live', status: 'busy', pane: 'w1:p1' } : { ok: true };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
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
  const type = async (text) => {
    box.value = text;
    box.setSelectionRange(text.length, text.length);
    box.dispatchEvent(new window.Event('input', { bubbles: true }));
    await settle();
  };
  /** @param {string} key */
  const press = (key) => box.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  const menu = () => {
    const list = composer.element.querySelector('.command-menu');
    return list instanceof window.HTMLElement && !list.hidden ? [...list.querySelectorAll('.command-name')].map((name) => name.textContent) : [];
  };

  await type('/co');
  const shown = menu();
  press('ArrowDown');
  press('Enter');
  const picked = { text: box.value, menu: menu() };
  await type('/co');
  press('Escape');
  const escaped = menu();
  await type('/td');
  const option = composer.element.querySelector('.command-menu .command-option');
  assert.ok(option instanceof window.HTMLElement);
  option.click();
  const clicked = box.value;
  await type('see /co');
  const further = menu();

  assert.deepEqual(
    { shown, picked, escaped, clicked, further, posted },
    { shown: ['/config', '/compact'], picked: { text: '/compact ', menu: [] }, escaped: [], clicked: '/tdd ', further: [], posted: [] },
  );
});

// A skill written while the session is open is offered the next time a slash is typed, as the terminal's menu does —
// not only once the session is opened again
test('composer_Should_OfferASkillWrittenMeanwhile_TheNextTimeASlashIsTyped', async (t) => {
  let skills = offered;
  Object.assign(globalThis, {
    matchMedia: () => ({ matches: false }),
    fetch: async (/** @type {string} */ path) => {
      const body = path.startsWith('/api/commands') ? skills : path.startsWith('/api/live') ? { state: 'live', status: 'idle', pane: 'w1:p1' } : { ok: true };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const composer = createComposer('7d1e4b20-2222-4333-8444-a55566667777', { agent: 'claude', focusBox: 'no', placeOf: () => undefined, asides: createAsideStore(), onSent: () => undefined, onDialog: () => undefined });
  window.document.body.append(composer.element);
  t.after(() => {
    composer.dispose();
    composer.element.remove();
  });
  await settle();
  const box = composer.element.querySelector('.composer-input');
  assert.ok(box instanceof window.HTMLTextAreaElement);
  /** @param {string} text */
  const type = async (text) => {
    box.value = text;
    box.setSelectionRange(text.length, text.length);
    box.dispatchEvent(new window.Event('input', { bubbles: true }));
    await settle();
  };
  const menu = () => {
    const list = composer.element.querySelector('.command-menu');
    return list instanceof window.HTMLElement && !list.hidden ? [...list.querySelectorAll('.command-name')].map((name) => name.textContent) : [];
  };

  await type('/td');
  const before = menu();
  await type('');
  skills = [...offered, { name: '/tidy', hint: '', about: 'Tidies the folder.', source: 'personal' }];
  await type('/tid');
  const after = menu();

  assert.deepEqual({ before, after }, { before: ['/tdd'], after: ['/tidy'] });
});
