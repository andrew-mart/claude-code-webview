import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><head></head><body></body></html>', { pretendToBeVisual: true, url: 'https://notes.test/' });
// Milkdown looks for the DOM as its module loads and as it draws, as a page's own globals — its clock's events, the DOM's
// classes: they are set up first
for (const key of Object.getOwnPropertyNames(window)) {
  if (key in globalThis) continue;
  const value = window[key];
  Reflect.set(globalThis, key, typeof value === 'function' && !/^[A-Z]/.test(key) ? value.bind(window) : value);
}
Object.assign(globalThis, { window, document: window.document, addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window), dispatchEvent: window.dispatchEvent.bind(window), Event: window.Event, CustomEvent: window.CustomEvent });
const { mountBlocksEditor } = await import('../public/view/note-editor-blocks.js');

/**
 * A note in Milkdown's blocks, and words typed at the end of its first block — as the page changes when a key is typed,
 * ProseMirror reading it from there.
 * @param {string} text
 */
async function noteIn(text) {
  const host = window.document.createElement('div');
  window.document.body.replaceChildren(host);
  const editor = await mountBlocksEditor(host, { text, shown: 'preview', placeholder: 'Write here', onChange: () => undefined, onBlur: () => undefined, onOpen: () => undefined });
  /** @param {string} words */
  const type = async (words) => {
    const first = host.querySelector('.ProseMirror > :not(.ProseMirror-widget)')?.firstChild;
    if (!(first instanceof window.Text)) throw new Error('no text in the note');
    first.appendData(words);
    await new Promise((done) => setTimeout(done, 50));
  };
  return { editor, type };
}

// What is typed is undone and done again — what ↶ and ↷ press, and Ctrl+Z, Ctrl+Shift+Z — each there to do only while
// there is something to undo, or to do again
test('noteEditorBlocks_Should_UndoAndRedoWhatWasTyped', async () => {
  const { editor, type } = await noteIn('# Plan');
  const pressable = () => [editor.canUndo() ? 'undo' : '', editor.canRedo() ? 'redo' : ''].join('|');

  const opened = pressable();
  await type(' for May');
  const typed = { text: editor.text().trim(), pressable: pressable() };
  editor.undo();
  const undone = { text: editor.text().trim(), pressable: pressable() };
  editor.redo();
  const redone = { text: editor.text().trim(), pressable: pressable() };
  editor.destroy();

  assert.deepEqual(
    { opened, typed, undone, redone },
    {
      opened: '|',
      typed: { text: '# Plan for May', pressable: 'undo|' },
      undone: { text: '# Plan', pressable: '|redo' },
      redone: { text: '# Plan for May', pressable: 'undo|' },
    },
  );
});

// The note given as it came again — changed on another device — has nothing to undo: Ctrl+Z, or ↶, would put back what
// this device had, over the other's change
test('noteEditorBlocks_Should_HaveNothingToUndo_OnceGivenNoteAsItCameAgain', async () => {
  const { editor, type } = await noteIn('# Plan');

  await type(' for May');
  editor.replace('# Plan from the phone');
  const given = { text: editor.text().trim(), undo: editor.canUndo() };
  editor.destroy();

  assert.deepEqual(given, { text: '# Plan from the phone', undo: false });
});
