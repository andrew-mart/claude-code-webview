import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, { window, document: window.document });
const { mountMarkdownFileEditor } = await import('../public/view/markdown-file-editor.js');

// A markdown file is edited in the side panel as a note is — in the note's editor, told nothing of it is a note's — and
// saved as a file is: Ctrl+S saves it; ↶ and ↷ tell the panel the text changed, as Milkdown, not being typed in, does
// not; it is prose, with no code's tools
test('markdownFileEditor_Should_EditFileInNotesEditor_SavedOnCtrlS', async () => {
  /** @type {string[]} */
  const told = [];
  const host = window.document.createElement('div');
  window.document.body.replaceChildren(host);
  let text = '';
  const editor = await mountMarkdownFileEditor(
    host,
    { text: '# Plan\n', path: 'D:/dev/shop/plan.md', line: undefined, onChange: () => void told.push('changed'), onSave: () => void told.push('save') },
    {
      onOpen: () => undefined,
      mount: async (_host, options) => {
        text = options.text;
        told.push(`mounted ${options.shown}`);
        return { text: () => text, replace: (next) => void (text = next), focus: () => undefined, hasFocus: () => false, undo: () => void (text = '# Plan\n'), redo: () => undefined, canUndo: () => true, canRedo: () => false, destroy: () => void told.push('destroyed') };
      },
    },
  );

  host.dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
  editor.undo();
  editor.dispose();

  assert.deepEqual({ tools: editor.tools, text: editor.text(), told }, { tools: 'prose', text: '# Plan\n', told: ['mounted preview', 'save', 'changed', 'destroyed'] });
});
