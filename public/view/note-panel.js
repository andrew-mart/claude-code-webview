// @ts-check
// A note in the side panel, the whole of it — opened from its name among the notes: drawn as markdown; ✎ edits it in
// place — Ctrl+Enter or a click elsewhere keeps it, Escape leaves it as it was — and × removes it once ✓ confirms. The
// notes coming again — another device's change — draw it anew, unless it is being edited; a note removed says so.
// A note set apart from the start is written here too: kept by Ctrl+Enter or ✓ alone — a click elsewhere, to fetch what
// goes in it, leaves it being written — and left unwritten by Escape or ✕.
import { h } from './dom.js';
import { icon } from './icons.js';
import { renderMarkdown } from './markdown.js';
import { noteTitle } from '../model/notes.js';

/**
 * @typedef {import('../model/notes.js').Note} Note
 */

/**
 * @param {{ note: () => Note | undefined, edit: (id: string, text: string) => void, remove: (id: string) => void }} source
 *   — note: the note as the page has it now, none once it is removed; edit: its new text; remove: it removed
 * @returns {{ element: HTMLElement, name: string, reload: () => Promise<void>, summary: () => string | undefined }} — the
 *   side panel's list in place of a file (file-panel.js: ShownList): name — the panel's title, the note's first line
 */
export function createNotePanel({ note, edit, remove }) {
  const element = h('div', { className: 'note-panel' });
  let busy = false;

  /** @param {string} className @param {string} iconName @param {string} label */
  const button = (className, iconName, label) => h('button', { className: `icon-button ${className}`, title: label, attrs: { type: 'button', 'aria-label': label } }, [icon(iconName)]);

  const draw = () => {
    busy = false;
    const now = note();
    if (now === undefined) {
      element.replaceChildren(h('div', { className: 'note-panel-gone', text: 'This note was removed.' }));
      return;
    }
    const editing = button('note-panel-edit', 'edit', 'Edit the note');
    const removing = button('note-panel-remove', 'cross', 'Remove the note');
    const actions = h('div', { className: 'note-panel-actions' }, [editing, removing]);
    const text = h('div', { className: 'md note-panel-text' }, [renderMarkdown(now.text)]);
    editing.addEventListener('click', () => startEditing(now, text, actions));
    removing.addEventListener('click', () => askRemoving(now, actions));
    element.replaceChildren(actions, text);
  };

  /**
   * The note's markdown in a box in place of it.
   * @param {Note} now @param {HTMLElement} text @param {HTMLElement} actions
   */
  const startEditing = (now, text, actions) => {
    busy = true;
    const box = h('textarea', { className: 'notes-editor note-panel-editor', attrs: { rows: '14', placeholder: 'Markdown — Ctrl+Enter keeps it, Esc leaves it', 'aria-label': 'Note' } });
    box.value = now.text;
    let over = false;
    const keep = () => {
      if (over) return;
      over = true;
      if (box.value !== now.text) edit(now.id, box.value);
      draw();
    };
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        // the panel's Escape, which closes it, is not this one's
        event.preventDefault();
        event.stopPropagation();
        over = true;
        draw();
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        keep();
      }
    });
    box.addEventListener('blur', keep);
    text.replaceWith(box);
    actions.hidden = true;
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

  const first = note();
  const title = first === undefined ? '' : noteTitle(first.text);
  draw();
  return {
    element,
    name: title === '' ? 'Note' : title,
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
 * @param {{ keep: (text: string) => void, leave: () => void }} actions — keep: the note written; leave: none written
 * @returns {{ element: HTMLElement, name: string, reload: () => Promise<void>, summary: () => string | undefined }} — the
 *   side panel's list in place of a file (file-panel.js: ShownList)
 */
export function createNoteDraft({ keep, leave }) {
  const box = h('textarea', { className: 'notes-editor note-panel-editor', attrs: { rows: '18', placeholder: 'Markdown — Ctrl+Enter keeps it, Esc leaves it', 'aria-label': 'New note' } });
  const keeping = h('button', { className: 'icon-button note-draft-keep', title: 'Keep the note', attrs: { type: 'button', 'aria-label': 'Keep the note' } }, [icon('check')]);
  const leaving = h('button', { className: 'icon-button note-draft-leave', title: 'Leave it unwritten', attrs: { type: 'button', 'aria-label': 'Leave it unwritten' } }, [icon('cross')]);
  const element = h('div', { className: 'note-panel note-draft' }, [h('div', { className: 'note-panel-actions' }, [keeping, leaving]), box]);
  const written = () => {
    if (box.value.trim() !== '') keep(box.value);
  };
  box.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      // the panel's Escape, which closes it, is not this one's
      event.preventDefault();
      event.stopPropagation();
      leave();
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      written();
    }
  });
  keeping.addEventListener('click', written);
  leaving.addEventListener('click', leave);
  // shown first, then focused: a box not yet in the page takes no focus
  setTimeout(() => box.focus(), 0);
  return {
    element,
    name: 'New note',
    // the notes coming again leave what is being written
    reload: async () => undefined,
    summary: () => 'Set apart: listed by its name among the notes',
  };
}
