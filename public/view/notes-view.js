// @ts-check
// The notes of the session's project folder, first in the outline: each drawn as markdown, the latest first. "+" writes
// a new one and a click on a note edits its markdown in place — Ctrl+Enter or a click elsewhere keeps it, Escape leaves
// it as it was; × removes a note once ✓ confirms it. While a note is written, edited or about to be removed, the notes
// coming again from the server wait: they would take away what is being typed.
import { h } from './dom.js';
import { icon } from './icons.js';
import { renderMarkdown } from './markdown.js';

/**
 * @typedef {import('../model/notes.js').Note} Note
 */

/**
 * @param {{ add: (text: string) => void, edit: (id: string, text: string) => void, remove: (id: string) => void }} actions
 *   — a note written, a note's new text, a note removed
 * @returns {{ element: HTMLElement, show: (notes: readonly Note[]) => void }} — show: the notes as they stand now
 */
export function createNotesView({ add, edit, remove }) {
  const count = h('span', { className: 'outline-count' });
  const adding = h('button', { className: 'icon-button notes-add', title: 'Write a note', attrs: { type: 'button', 'aria-label': 'Write a note' } }, [icon('plus')]);
  const list = h('div', { className: 'notes-list' });
  const element = h('section', { className: 'outline-section notes' }, [h('div', { className: 'outline-title' }, [h('span', { text: 'Notes' }), h('span', { className: 'notes-title-end' }, [count, adding])]), list]);
  /** @type {readonly Note[]} */
  let notes = [];
  let busy = false;

  const draw = () => {
    busy = false;
    count.textContent = notes.length === 0 ? '' : String(notes.length);
    list.replaceChildren(...(notes.length === 0 ? [h('div', { className: 'outline-empty', text: "Notes on this project's folder, in markdown: + writes one." })] : notes.map(noteItem)));
  };

  /**
   * A box with a note's markdown in place of what was there: none — a new note — over the notes.
   * @param {Note | undefined} note
   * @param {Element | undefined} shown — the note's text, which the box takes the place of
   */
  const startWriting = (note, shown) => {
    busy = true;
    const box = h('textarea', { className: 'notes-editor', attrs: { rows: '4', placeholder: 'Markdown — Ctrl+Enter keeps it, Esc leaves it', 'aria-label': note === undefined ? 'New note' : 'Note' } });
    box.value = note?.text ?? '';
    let over = false;
    const keep = () => {
      if (over) return;
      over = true;
      const written = box.value;
      if (note === undefined && written.trim() !== '') add(written);
      if (note !== undefined && written !== note.text) edit(note.id, written);
      draw();
    };
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
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
    if (shown === undefined) list.prepend(box);
    else shown.replaceWith(box);
    box.focus();
  };

  /**
   * @param {Note} note
   * @returns {HTMLElement}
   */
  const noteItem = (note) => {
    const text = h('div', { className: 'md note-text', attrs: { title: 'Click to edit' } }, [renderMarkdown(note.text)]);
    const removing = h('button', { className: 'icon-button note-remove', title: 'Remove the note', attrs: { type: 'button', 'aria-label': 'Remove the note' } }, [icon('cross')]);
    const actions = h('span', { className: 'note-actions' }, [removing]);
    // a link in a note opens; text being selected is not a click to edit
    text.addEventListener('click', (event) => {
      if (busy) return;
      if (event.target instanceof window.Element && event.target.closest('a') !== null) return;
      if ((window.getSelection()?.toString() ?? '') !== '') return;
      startWriting(note, text);
    });
    removing.addEventListener('click', () => {
      if (busy) return;
      busy = true;
      const yes = h('button', { className: 'icon-button note-confirm-remove', title: 'Remove the note', attrs: { type: 'button', 'aria-label': 'Remove the note' } }, [icon('check')]);
      const no = h('button', { className: 'icon-button note-keep', title: 'Keep it', attrs: { type: 'button', 'aria-label': 'Keep it' } }, [icon('cross')]);
      yes.addEventListener('click', () => {
        remove(note.id);
        draw();
      });
      no.addEventListener('click', draw);
      actions.replaceChildren(yes, no);
      yes.focus();
    });
    return h('div', { className: 'note', attrs: { 'data-id': note.id } }, [text, actions]);
  };

  adding.addEventListener('click', () => {
    if (!busy) startWriting(undefined, undefined);
  });
  draw();
  return {
    element,
    show(next) {
      notes = next;
      if (!busy) draw();
    },
  };
}
