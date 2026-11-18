import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage, HTMLElement: window.HTMLElement, File: window.File, Blob: window.Blob, FileReader: window.FileReader });
const { createComposer } = await import('../public/view/composer-view.js');
const { createAsideStore } = await import('../public/view/aside-store.js');

const sessionId = '5b7d1e30-3333-4444-8555-966677778888';
const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

// The phrases' row over the box is turned on and off behind the page's ⋯ menu, on every screen: the box has no button
// of its own for it. On, a phrase pressed goes into the box where its cursor is
test('composer_Should_ShowPhrasesTurnedOnBehindTheMenu_WithNoButtonOfItsOwn', async (t) => {
  Object.assign(globalThis, {
    matchMedia: () => ({ matches: false }),
    fetch: async () => new Response(JSON.stringify({ state: 'live', status: 'idle', pane: 'w1:p1' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  const composer = createComposer(sessionId, {
    agent: 'claude',
    focusBox: 'no',
    placeOf: () => undefined,
    asides: createAsideStore(),
    onSent: () => undefined,
    onDialog: () => undefined,
    phrases: {
      load: async () => [
        { text: 'Check the totals', count: 9 },
        { text: '/clear', count: 4 },
      ],
      shown: () => true,
      watch: () => () => undefined,
    },
  });
  t.after(() => composer.dispose());
  window.document.body.append(composer.element);
  await settled();
  const box = composer.element.querySelector('.composer-input');
  assert.ok(box instanceof window.HTMLTextAreaElement);
  box.value = 'Fix the totals';
  box.setSelectionRange(3, 3);

  const chips = [...composer.element.querySelectorAll('.phrase-chip')];
  const pressed = chips[1];
  assert.ok(pressed instanceof window.HTMLButtonElement);
  pressed.click();

  assert.deepEqual(
    {
      toggles: [...composer.element.querySelectorAll('button')].flatMap((button) => (/phrase/i.test(button.getAttribute('aria-label') ?? '') ? [button.getAttribute('aria-label')] : [])),
      chips: chips.map((chip) => chip.textContent),
      box: box.value,
    },
    { toggles: [], chips: ['Check the totals', '/clear'], box: 'Fix /clear the totals' },
  );
});
