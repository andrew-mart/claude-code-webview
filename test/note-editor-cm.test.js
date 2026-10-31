import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
// CodeMirror looks for the DOM as it draws: it is set up first
Object.assign(globalThis, { window, document: window.document, MutationObserver: window.MutationObserver, Window: window.Window });
const { EditorView } = await import('@codemirror/view');
const { mountNoteEditor } = await import('../public/view/note-editor-cm.js');

/**
 * A note in CodeMirror, as its source, and what is typed at its end — as a key typed puts it there.
 * @param {string} text
 */
async function noteIn(text) {
  const host = window.document.createElement('div');
  window.document.body.replaceChildren(host);
  const editor = await mountNoteEditor(host, { text, shown: 'source', placeholder: 'Write here', onChange: () => undefined, onBlur: () => undefined, onOpen: () => undefined });
  const view = EditorView.findFromDOM(host);
  if (view === null) throw new Error('no editor in its host');
  /** @param {string} words */
  const type = (words) => view.dispatch({ changes: { from: view.state.doc.length, insert: words }, userEvent: 'input.type' });
  return { editor, type };
}

// What is typed is undone and done again — what ↶ and ↷ press, and Ctrl+Z, Ctrl+Shift+Z — each there to do only while
// there is something to undo, or to do again
test('noteEditorCm_Should_UndoAndRedoWhatWasTyped', async () => {
  const { editor, type } = await noteIn('# Plan');
  const pressable = () => [editor.canUndo() ? 'undo' : '', editor.canRedo() ? 'redo' : ''].join('|');

  const opened = pressable();
  type('\n- one');
  const typed = pressable();
  editor.undo();
  const undone = { text: editor.text(), pressable: pressable() };
  editor.redo();
  const redone = { text: editor.text(), pressable: pressable() };
  editor.destroy();

  assert.deepEqual(
    { opened, typed, undone, redone },
    { opened: '|', typed: 'undo|', undone: { text: '# Plan', pressable: '|redo' }, redone: { text: '# Plan\n- one', pressable: 'undo|' } },
  );
});

// The note given as it came again — changed on another device — has nothing to undo: Ctrl+Z, or ↶, would put back what
// this device had, over the other's change
test('noteEditorCm_Should_HaveNothingToUndo_OnceGivenNoteAsItCameAgain', async () => {
  const { editor, type } = await noteIn('# Plan');

  type('- one');
  editor.replace('# Plan from the phone');
  const given = { text: editor.text(), undo: editor.canUndo() };
  editor.destroy();

  assert.deepEqual(given, { text: '# Plan from the phone', undo: false });
});
