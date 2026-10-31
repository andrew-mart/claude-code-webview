// @ts-check
// A note in the side panel, the whole of it — opened from its name among the notes, or written new: its name in a field
// above it, the note in its editor (note-editor.js), always there to be typed in — what is typed, and the name, saved as
// they go; its buttons in the panel's head, in one row with ↻ and ×: its source, the fallback, and the bin, which removes
// it once ✓ confirms. The notes coming again — another device's change — show the note as it is now; what is being typed
// stays. A note removed says so.
import { h } from './dom.js';
import { icon } from './icons.js';
import { noteName, noteTitle } from '../model/notes.js';

/**
 * @typedef {import('../model/notes.js').Note} Note
 * @typedef {import('./notes-view.js').EditorOf} EditorOf
 */

/** How long after the last key a name typed is saved. */
const saveAfter = 1000;

/**
 * @param {{ note: () => Note | undefined, edit: (id: string, text: string) => void, rename: (id: string, name: string) => void, remove: (id: string) => void, editorOf: EditorOf }} source
 *   — note: the note as the page has it now, none once it is removed; edit: its new text; rename: its new name, a blank
 *   one none; remove: it removed
 * @returns {{ element: HTMLElement, actions: HTMLElement, name: () => string, reload: () => Promise<void>, summary: () => string | undefined, focus: () => void }}
 *   — the side panel's list in place of a file (file-panel.js: ShownList): actions — its buttons, for the panel's head;
 *   name — the panel's title, the note's name as it is now; focus: the cursor in the note, to write it
 */
export function createNotePanel({ note, edit, rename, remove, editorOf }) {
  const first = note();
  const element = h('div', { className: 'note-panel' });
  const actions = h('span', { className: 'note-panel-actions' });
  if (first === undefined) {
    element.replaceChildren(gone());
    return { element, actions, name: () => 'Note', reload: async () => undefined, summary: () => undefined, focus: () => undefined };
  }
  const id = first.id;
  const field = h('input', { className: 'note-panel-name', attrs: { type: 'text', 'aria-label': 'Name — its first line names the note if none', autocomplete: 'off', spellcheck: 'false' } });
  field.value = first.name ?? '';
  field.placeholder = placeholderOf(first);
  const editor = editorOf({ text: first.text, save: (text) => edit(id, text) });
  element.replaceChildren(field, editor.element);

  /** The name as last saved: the field differs from it while a save waits. */
  let savedName = field.value;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let waiting;
  const saveName = () => {
    clearTimeout(waiting);
    waiting = undefined;
    if (field.value === savedName) return;
    savedName = field.value;
    rename(id, field.value);
  };
  field.addEventListener('input', () => {
    clearTimeout(waiting);
    waiting = setTimeout(saveName, saveAfter);
  });
  field.addEventListener('blur', saveName);
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    // the name given, on to what the note says
    event.preventDefault();
    saveName();
    editor.focus();
  });

  const source = h('button', { className: 'icon-button note-source', title: 'Show its markdown as typed', attrs: { type: 'button', 'aria-label': 'Show its markdown as typed', 'aria-pressed': 'false' } }, [icon('code')]);
  const removing = h('button', { className: 'icon-button note-panel-remove', title: 'Remove the note', attrs: { type: 'button', 'aria-label': 'Remove the note' } }, [icon('trash')]);
  const showButtons = () => actions.replaceChildren(source, removing);
  showButtons();
  source.addEventListener('click', () => {
    editor.setShown(editor.shown() === 'source' ? 'preview' : 'source');
    source.setAttribute('aria-pressed', String(editor.shown() === 'source'));
  });
  // the note's buttons give way to the question whether to remove it: ✓ removes it, ✕ keeps it
  removing.addEventListener('click', () => {
    const yes = button('note-confirm-remove', 'check', 'Remove the note');
    const no = button('note-keep', 'cross', 'Keep it');
    yes.addEventListener('click', () => {
      showButtons();
      remove(id);
    });
    no.addEventListener('click', showButtons);
    actions.replaceChildren(yes, no);
    yes.focus();
  });

  let removed = false;
  return {
    element,
    actions,
    name() {
      const now = note();
      const named = now === undefined ? '' : noteName(now);
      return named === '' ? 'Note' : named;
    },
    async reload() {
      const now = note();
      if (removed) return;
      if (now === undefined) {
        removed = true;
        clearTimeout(waiting);
        editor.dispose();
        actions.replaceChildren();
        element.replaceChildren(gone());
        return;
      }
      editor.show(now.text);
      field.placeholder = placeholderOf(now);
      if (window.document.activeElement !== field && field.value === savedName) {
        field.value = now.name ?? '';
        savedName = field.value;
      }
    },
    summary() {
      const now = note();
      return now === undefined ? undefined : `Written ${new Date(now.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
    },
    focus: () => editor.focus(),
  };
}

/**
 * What names the note while its field is empty: its first line.
 * @param {Note} note
 * @returns {string}
 */
function placeholderOf(note) {
  const title = noteTitle(note.text);
  return title === '' ? 'Its first line, if no name' : title;
}

/** @returns {HTMLElement} */
function gone() {
  return h('div', { className: 'note-panel-gone', text: 'This note was removed.' });
}

/**
 * @param {string} className @param {string} iconName @param {string} label
 * @returns {HTMLButtonElement}
 */
function button(className, iconName, label) {
  return h('button', { className: `icon-button ${className}`, title: label, attrs: { type: 'button', 'aria-label': label } }, [icon(iconName)]);
}
