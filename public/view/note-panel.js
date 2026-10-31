// @ts-check
// A note in the side panel, the whole of it — opened from its name among the notes, or written new: its name in a field
// above it, the note in its editor (note-editor.js), always there to be typed in — what is typed, and the name, saved as
// they go; its buttons in the panel's head, in one row with ↻ and ×: ↶ and ↷, the notes' editor switched — a live
// preview, as Obsidian has it, or blocks, as Notion has them — its source, the fallback, and the bin, which removes it
// once ✓ confirms; and the button that saves it to a file, in the session's folder under its name unless another path
// is typed — a file there already written over only once "Replace it" says so. The notes coming again — another device's change — show the note as it is now;
// what is being typed stays. A note removed — here or elsewhere — is left at once.
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
 * @param {{ toFile: { path: () => string, create: (path: string, content: string, replace: boolean) => Promise<import('../model/notes.js').FileCreated> }, engine: { title: () => string, switch: () => void }, note: () => Note | undefined, edit: (id: string, text: string) => void, rename: (id: string, name: string) => void, remove: (id: string) => void, leave: () => void, editorOf: EditorOf }} source
 *   — toFile: the note saved to a file — path: the one offered, in the session's folder under the note's name; create:
 *   the file written, one there written over only when told to replace it; engine: the notes' editor, as the viewer's setting has it — title: what a press does; switch: the other one, every
 *   note's editor made anew; note: the note as the page has it now, none once it is removed; edit: its new text;
 *   rename: its new name, a blank one none; remove: it removed; leave: the note gone — removed here or elsewhere — the
 *   panel leaves it
 * @returns {{ element: HTMLElement, actions: HTMLElement, name: () => string, reload: () => Promise<void>, summary: () => string | undefined, focus: () => void }}
 *   — the side panel's list in place of a file (file-panel.js: ShownList): actions — its buttons, for the panel's head;
 *   name — the panel's title, the note's name as it is now; focus: the cursor in the note, to write it
 */
export function createNotePanel({ toFile, engine, note, edit, rename, remove, leave, editorOf }) {
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
  /** The note saved to a file: the path, Save, and what came of it, between the name and the note while it is asked. */
  const filing = h('div', { className: 'note-file', attrs: { hidden: '' } });
  element.replaceChildren(field, filing, editor.element);

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
  const switching = h('button', { className: 'icon-button note-engine', attrs: { type: 'button' } }, [icon('type')]);
  const titleSwitching = () => {
    switching.title = engine.title();
    switching.setAttribute('aria-label', switching.title);
  };
  titleSwitching();
  switching.addEventListener('click', () => {
    engine.switch();
    titleSwitching();
  });
  const toFileButton = h('button', { className: 'icon-button note-to-file', title: "Save the note to a file — in the session's folder", attrs: { type: 'button', 'aria-label': 'Save the note to a file' } }, [icon('to-file')]);
  toFileButton.addEventListener('click', () => {
    if (filing.hidden) askForFile();
    else filing.hidden = true;
  });
  /** The path the note goes to, offered as the session's folder and the note's name, Enter or Save writing it. */
  const askForFile = () => {
    const path = h('input', { className: 'note-file-path', attrs: { type: 'text', 'aria-label': 'The file to save the note to', spellcheck: 'false', autocomplete: 'off' } });
    path.value = toFile.path();
    const saving = h('button', { className: 'note-file-save', text: 'Save', attrs: { type: 'button' } });
    const leaving = button('note-file-cancel', 'cross', 'Cancel (Esc)');
    const told = h('div', { className: 'note-file-told', attrs: { role: 'status' } });
    /** @param {boolean} replace */
    const write = (replace) => {
      saving.disabled = true;
      told.replaceChildren();
      void toFile.create(path.value.trim(), editor.text(), replace).then((outcome) => {
        saving.disabled = false;
        if (outcome.ok) return void told.replaceChildren(`Saved to ${outcome.path}`);
        if (outcome.error !== 'exists') return void told.replaceChildren(fileRefusals[outcome.error]);
        const replacing = h('button', { className: 'note-file-replace', text: 'Replace it', attrs: { type: 'button' } });
        replacing.addEventListener('click', () => write(true));
        told.replaceChildren(h('span', { className: 'note-file-there', text: 'A file is there already.' }), replacing);
      });
    };
    saving.addEventListener('click', () => write(false));
    leaving.addEventListener('click', () => {
      filing.hidden = true;
    });
    path.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        write(false);
      } else if (event.key === 'Escape') {
        // the panel stays: Esc here puts the question away
        event.preventDefault();
        event.stopPropagation();
        filing.hidden = true;
      }
    });
    filing.replaceChildren(h('div', { className: 'note-file-row' }, [path, saving, leaving]), told);
    filing.hidden = false;
    path.focus();
    path.select();
  };
  const showButtons = () => actions.replaceChildren(editor.buttons.undo, editor.buttons.redo, switching, source, toFileButton, removing);
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
        element.replaceChildren();
        leave();
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

/** Why the note was not saved to a file — a file there already is asked about instead. */
/** @type {Readonly<Record<Exclude<import('../model/notes.js').FileRefusal, 'exists'>, string>>} */
const fileRefusals = {
  'not-absolute': 'The whole path, please: from a drive, from /, or from ~/.',
  'no-folder': 'No folder there to save the file in.',
  'not-a-file': 'A folder is there, not a file.',
  'too-large': 'The note is too large to save here.',
  'read-only': 'The viewer may not write there.',
  failed: 'The viewer did not answer.',
};

/**
 * What names the note while its field is empty: its first line.
 * @param {Note} note
 * @returns {string}
 */
function placeholderOf(note) {
  const title = noteTitle(note.text);
  return title === '' ? 'Its first line, if no name' : title;
}

/** A note opened that is gone already. @returns {HTMLElement} */
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
