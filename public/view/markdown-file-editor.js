// @ts-check
// A markdown file edited in the side panel as a note is — a live preview, as Obsidian has it, or blocks, as Notion has
// them (note-editor-cm.js, note-editor-blocks.js) — for the file panel's editor (file-editor.js): saved as files are,
// by Save or Ctrl+S, not as a note is, a second after the typing stops — the session may be writing the file too. It
// looks as a note open in the side panel does.
import { h } from './dom.js';

/**
 * @param {HTMLElement} host
 * @param {import('./file-editor.js').EditorOptions} options
 * @param {{ mount: import('./note-editor.js').MountEditor, onOpen: (target: import('./note-editor.js').OpenTarget) => void }} engine
 *   — mount: the notes' editor, as the viewer's setting has it; onOpen: a link Ctrl+clicked
 * @returns {Promise<import('./file-editor.js').CodeEditor>}
 */
export async function mountMarkdownFileEditor(host, { text, onChange, onSave }, { mount, onOpen }) {
  // in a note editor's box, as a note's editor is: the notes' look
  const place = h('div', { className: 'note-editor-host preview' });
  host.replaceChildren(h('div', { className: 'note-editor markdown-file' }, [place]));
  const mounted = await mount(place, { text, shown: 'preview', placeholder: 'Markdown: # a heading, - a list, ``` code', onChange: () => onChange(), onBlur: () => undefined, onOpen });
  // Ctrl+S saves, as it does in the code editor
  host.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    onSave();
  });
  /**
   * What was typed undone, or done again — the panel told the text changed: Milkdown does not tell it of a note not
   * being typed in, and ↶ and ↷ take the focus.
   * @param {() => void} step
   */
  const stepped = (step) => () => {
    step();
    onChange();
  };
  return {
    tools: 'prose',
    text: mounted.text,
    replace: mounted.replace,
    wordAtCursor: () => undefined,
    search: () => undefined,
    undo: stepped(mounted.undo),
    redo: stepped(mounted.redo),
    focus: mounted.focus,
    dispose: mounted.destroy,
  };
}
