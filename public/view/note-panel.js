// @ts-check
// A note in the side panel, the whole of it — opened from its name among the notes: drawn as markdown, titled by its
// name; ✎ edits it in place, its name above its markdown — ✓, Ctrl+Enter, Enter in the name or a click elsewhere keeps
// it, ✕ or Escape leaves it as it was — and the bin removes it once ✓ confirms. The notes coming again — another
// device's change — draw it anew, unless it is being edited; a note removed says so.
// A note set apart from the start is written here too, under a name given above it — Enter there goes on to the
// markdown: kept by Ctrl+Enter or ✓ alone — a click elsewhere, to fetch what goes in it, leaves it being written — and
// left unwritten by Escape or ✕.
import { h } from './dom.js';
import { icon } from './icons.js';
import { renderMarkdown } from './markdown.js';
import { noteName, noteTitle } from '../model/notes.js';
import { keepOrLeave } from './keep-or-leave.js';

/**
 * @typedef {import('../model/notes.js').Note} Note
 */

/**
 * @param {{ note: () => Note | undefined, edit: (id: string, text: string, name: string) => void, remove: (id: string) => void }} source
 *   — note: the note as the page has it now, none once it is removed; edit: its new text and name, a blank name none;
 *   remove: it removed
 * @returns {{ element: HTMLElement, name: () => string, reload: () => Promise<void>, summary: () => string | undefined }}
 *   — the side panel's list in place of a file (file-panel.js: ShownList): name — the panel's title, the note's name as
 *   it is now
 */
export function createNotePanel({ note, edit, remove }) {
  const element = h('div', { className: 'note-panel' });
  let busy = false;

  const draw = () => {
    busy = false;
    const now = note();
    if (now === undefined) {
      element.replaceChildren(h('div', { className: 'note-panel-gone', text: 'This note was removed.' }));
      return;
    }
    const editing = button('note-panel-edit', 'edit', 'Edit the note — its name and its text');
    const removing = button('note-panel-remove', 'trash', 'Remove the note');
    const actions = h('div', { className: 'note-panel-actions' }, [editing, removing]);
    const text = h('div', { className: 'md note-panel-text' }, [renderMarkdown(now.text)]);
    editing.addEventListener('click', () => startEditing(now, text, actions));
    removing.addEventListener('click', () => askRemoving(now, actions));
    element.replaceChildren(actions, text);
  };

  /**
   * The note's name and markdown in place of it, ✓ and ✕ in place of its buttons.
   * @param {Note} now @param {HTMLElement} text @param {HTMLElement} actions
   */
  const startEditing = (now, text, actions) => {
    busy = true;
    const field = nameField(noteTitle(now.text));
    field.value = now.name ?? '';
    const box = h('textarea', { className: 'notes-editor note-panel-editor', attrs: { rows: '14', placeholder: 'Markdown — Ctrl+Enter keeps it, Esc leaves it', 'aria-label': 'Note' } });
    box.value = now.text;
    const editor = h('div', { className: 'note-panel-editing' }, [field, box]);
    let over = false;
    const keep = () => {
      if (over) return;
      over = true;
      if (box.value !== now.text || field.value.trim() !== (now.name ?? '')) edit(now.id, box.value, field.value);
      draw();
    };
    const leave = () => {
      over = true;
      draw();
    };
    editor.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        // the panel's Escape, which closes it, is not this one's
        event.preventDefault();
        event.stopPropagation();
        leave();
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey || event.target === field)) {
        event.preventDefault();
        keep();
      }
    });
    // a click elsewhere keeps it; from the name to the markdown, or back, it goes on being edited
    editor.addEventListener('focusout', (event) => {
      if (!(event.relatedTarget instanceof window.Node && editor.contains(event.relatedTarget))) keep();
    });
    actions.replaceChildren(...keepOrLeave({ keep, leave, keepTitle: 'Keep it (Ctrl+Enter)', leaveTitle: 'Leave it as it was (Esc)' }));
    text.replaceWith(editor);
    box.focus();
  };

  /**
   * The note's buttons give way to the question whether to remove it: ✓ removes it, ✕ keeps it.
   * @param {Note} now @param {HTMLElement} actions
   */
  const askRemoving = (now, actions) => {
    busy = true;
    const yes = button('note-confirm-remove', 'check', 'Remove the note');
    const no = button('note-keep', 'cross', 'Keep it');
    yes.addEventListener('click', () => {
      remove(now.id);
      draw();
    });
    no.addEventListener('click', draw);
    actions.replaceChildren(yes, no);
    yes.focus();
  };

  draw();
  return {
    element,
    name() {
      const now = note();
      const named = now === undefined ? '' : noteName(now);
      return named === '' ? 'Note' : named;
    },
    async reload() {
      if (!busy) draw();
    },
    summary() {
      const now = note();
      return now === undefined ? undefined : `Written ${new Date(now.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
    },
  };
}

/**
 * A new note set apart, written in the side panel.
 * @param {{ keep: (text: string, name: string) => void, leave: () => void }} actions — keep: the note written, under its
 *   name, a blank one none; leave: none written
 * @returns {{ element: HTMLElement, name: () => string, reload: () => Promise<void>, summary: () => string | undefined }}
 *   — the side panel's list in place of a file (file-panel.js: ShownList)
 */
export function createNoteDraft({ keep, leave }) {
  const field = nameField('Its first line, if no name');
  const box = h('textarea', { className: 'notes-editor note-panel-editor', attrs: { rows: '18', placeholder: 'Markdown — Ctrl+Enter keeps it, Esc leaves it', 'aria-label': 'New note' } });
  const written = () => {
    if (box.value.trim() !== '') keep(box.value, field.value);
  };
  const [keeping, leaving] = keepOrLeave({ keep: written, leave, keepTitle: 'Keep the note (Ctrl+Enter)', leaveTitle: 'Leave it unwritten (Esc)' });
  keeping.classList.add('note-draft-keep');
  leaving.classList.add('note-draft-leave');
  const element = h('div', { className: 'note-panel note-draft' }, [h('div', { className: 'note-panel-actions' }, [keeping, leaving]), field, box]);
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      // the panel's Escape, which closes it, is not this one's
      event.preventDefault();
      event.stopPropagation();
      leave();
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      written();
    } else if (event.key === 'Enter' && event.target === field) {
      // the name given, on to what the note says
      event.preventDefault();
      box.focus();
    }
  });
  // shown first, then focused: a box not yet in the page takes no focus
  setTimeout(() => box.focus(), 0);
  return {
    element,
    name: () => 'New note',
    // the notes coming again leave what is being written
    reload: async () => undefined,
    summary: () => 'Set apart: listed by its name among the notes',
  };
}

/**
 * @param {string} className @param {string} iconName @param {string} label
 * @returns {HTMLButtonElement}
 */
function button(className, iconName, label) {
  return h('button', { className: `icon-button ${className}`, title: label, attrs: { type: 'button', 'aria-label': label } }, [icon(iconName)]);
}

/**
 * The field a note is named in, above its markdown.
 * @param {string} instead — what names the note while the field is empty
 * @returns {HTMLInputElement}
 */
function nameField(instead) {
  return h('input', { className: 'note-panel-name', attrs: { type: 'text', placeholder: instead, 'aria-label': 'Name — its first line names the note if none', autocomplete: 'off', spellcheck: 'false' } });
}
