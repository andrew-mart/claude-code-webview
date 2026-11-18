import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage, HTMLElement: window.HTMLElement, File: window.File, Blob: window.Blob, FileReader: window.FileReader });
const { createComposer } = await import('../public/view/composer-view.js');
const { createAsideStore } = await import('../public/view/aside-store.js');

const sessionId = '3f2c9a50-1111-4222-8333-944455556666';
const settled = () => new Promise((resolve) => setTimeout(resolve, 20));
/** Waits until it holds, two seconds at most: a picture is read before it is attached. @param {() => boolean} holds */
const until = async (holds) => {
  for (let waited = 0; waited < 2000 && !holds(); waited += 20) await settled();
};

/**
 * The clipboard as the browser hands it to the page: what it holds, one thing after another — or none, the browser
 * keeping it from the page.
 * @param {(() => { type: string, content: string })[]} holds
 */
function clipboardOf(holds) {
  let at = 0;
  return {
    read: async () => {
      const next = holds[at++];
      if (next === undefined) throw new window.DOMException('Read permission denied.', 'NotAllowedError');
      const { type, content } = next();
      return [{ types: [type], getType: async () => new window.Blob([content], { type }) }];
    },
  };
}

// The paste button puts what the clipboard holds into the box: its words where the box's cursor is — what is selected
// there replaced by them; a picture attached, as one pasted with Ctrl+V; a clipboard the browser keeps from the page
// is told of
test('composer_Should_PasteClipboard_WordsAtCursor_PicturesAttached', async (t) => {
  Object.assign(globalThis, {
    matchMedia: () => ({ matches: false }),
    createImageBitmap: async () => ({ width: 8, height: 8, close: () => undefined }),
    fetch: async () => new Response(JSON.stringify({ state: 'live', status: 'idle', pane: 'w1:p1' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: clipboardOf([() => ({ type: 'text/plain', content: "last month's" }), () => ({ type: 'image/png', content: 'png bytes' })]),
  });
  const composer = createComposer(sessionId, { agent: 'claude', focusBox: 'no', placeOf: () => undefined, asides: createAsideStore(), onSent: () => undefined, onDialog: () => undefined });
  t.after(() => composer.dispose());
  window.document.body.append(composer.element);
  await settled();
  const box = composer.element.querySelector('.composer-input');
  const paste = composer.element.querySelector('.composer-paste');
  const status = composer.element.querySelector('.composer-status');
  assert.ok(box instanceof window.HTMLTextAreaElement && paste instanceof window.HTMLButtonElement && status instanceof window.HTMLElement);
  box.value = 'Fix the totals';
  box.setSelectionRange(4, 7);

  paste.click();
  await settled();
  const words = box.value;
  paste.click();
  await until(() => composer.element.querySelectorAll('.composer-attachments .attachment').length > 0);
  const pictures = composer.element.querySelectorAll('.composer-attachments .attachment').length;
  paste.click();
  await settled();

  assert.deepEqual({ words, pictures, kept: box.value, told: status.dataset.tone }, { words: "Fix last month's totals", pictures: 1, kept: "Fix last month's totals", told: 'error' });
});
