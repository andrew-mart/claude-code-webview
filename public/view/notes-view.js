// @ts-check
// The notes of the session's project folder, first in the outline, the latest first, each shown its own way: inline —
// in full, as markdown — or set apart, listed by its name, the name opening it elsewhere (the side panel); a button on
// each sets it the other way. "+" writes a new one, shown inline; the button beside it one set apart from the start,
// written elsewhere (the side panel); the clock shows the history of the notes' changes. A click on a note in full edits
// its markdown in place — ✓, Ctrl+Enter or a click elsewhere keeps it, ✕ or Escape leaves it as it was; the bin removes a
// note once ✓ confirms it. A note is moved among the others by its grip (drag-order.js). While a note is written, edited,
// about to be removed or moved, the notes coming again from the server wait: they would take away what is being typed.
import { h } from './dom.js';
import { icon } from './icons.js';
import { renderMarkdown } from './markdown.js';
import { noteName } from '../model/notes.js';
import { allowDragging } from './drag-order.js';
import { keepOrLeave } from './keep-or-leave.js';

/**
 * @typedef {import('../model/notes.js').Note} Note
 * @typedef {import('../model/notes.js').NoteShown} NoteShown
 */

/**
 * @param {{ add: (text: string) => void, edit: (id: string, text: string) => void, remove: (id: string) => void, open: (id: string) => void, setShown: (id: string, shown: NoteShown) => void, writeApart: () => void, showHistory: () => void, move: (id: string, before: string | undefined) => void }} actions
 *   — a note written, a note's new text, a note removed; open: a note set apart shown in full elsewhere; setShown: a
 *   note set apart, or back inline; writeApart: a note set apart from the start written elsewhere; showHistory: the
 *   history of the notes' changes shown elsewhere; move: a note put before another — none, last
 * @returns {{ element: HTMLElement, show: (notes: readonly Note[]) => void }} — show: the notes as they stand now
 */
export function createNotesView({ add, edit, remove, open, setShown, writeApart, showHistory, move }) {
  const count = h('span', { className: 'outline-count' });
  const adding = h('button', { className: 'icon-button notes-add', title: 'Write a note', attrs: { type: 'button', 'aria-label': 'Write a note' } }, [icon('plus')]);
  const addingApart = h('button', { className: 'icon-button notes-add-apart', title: 'Write a note set apart — listed by its name, written and read in the side panel', attrs: { type: 'button', 'aria-label': 'Write a note set apart' } }, [icon('external')]);
  const history = h('button', { className: 'icon-button notes-history', title: "The notes' changes — any of them undone", attrs: { type: 'button', 'aria-label': "The notes' changes" } }, [icon('history')]);
  const list = h('div', { className: 'notes-list' });
  const element = h('section', { className: 'outline-section notes' }, [h('div', { className: 'outline-title' }, [h('span', { text: 'Notes' }), h('span', { className: 'notes-title-end' }, [count, history, addingApart, adding])]), list]);
  /** @type {readonly Note[]} */
  let notes = [];
  let busy = false;

  const draw = () => {
    busy = false;
    count.textContent = notes.length === 0 ? '' : String(notes.length);
    list.replaceChildren(...(notes.length === 0 ? [h('div', { className: 'outline-empty', text: "Notes on this project's folder, in markdown: + writes one." })] : notes.map((note) => (note.shown === 'inline' ? noteItem(note) : noteRow(note)))));
  };

  /**
   * A note set apart, listed by its name — the one given it, else its first line: a press shows the whole of it elsewhere; the button
   * beside brings it back inline.
   * @param {Note} note
   * @returns {HTMLElement}
   */
  const noteRow = (note) => {
    const name = noteName(note);
    const row = h('button', { className: 'note-row', title: 'Open the note', attrs: { type: 'button' } }, [name === '' ? 'Untitled' : name]);
    const inline = h('button', { className: 'icon-button note-inline', title: 'Show the note in full here', attrs: { type: 'button', 'aria-label': 'Show the note in full here' } }, [icon('unfold')]);
    row.addEventListener('click', () => {
      if (!busy) open(note.id);
    });
    inline.addEventListener('click', () => {
      if (!busy) setShown(note.id, 'inline');
    });
    return h('div', { className: 'note-line', attrs: { 'data-id': note.id } }, [row, grip(), inline]);
  };

  /**
   * A box with a note's markdown in place of what was there — none, a new note: over the notes — ✓ and ✕ under it.
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
    const leave = () => {
      over = true;
      draw();
    };
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        leave();
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        keep();
      }
    });
    box.addEventListener('blur', keep);
    const actions = h('div', { className: 'notes-editor-actions' }, keepOrLeave({ keep, leave, keepTitle: 'Keep it (Ctrl+Enter)', leaveTitle: 'Leave it as it was (Esc)' }));
    const editor = h('div', { className: 'notes-editing' }, [box, actions]);
    if (shown === undefined) list.prepend(editor);
    else shown.replaceWith(editor);
    box.focus();
  };

  /**
   * @param {Note} note
   * @returns {HTMLElement}
   */
  const noteItem = (note) => {
    const text = h('div', { className: 'md note-text', attrs: { title: 'Click to edit' } }, [renderMarkdown(note.text)]);
    const apart = h('button', { className: 'icon-button note-apart', title: 'List the note by its name — it opens in the side panel', attrs: { type: 'button', 'aria-label': 'List the note by its name' } }, [icon('fold')]);
    const removing = h('button', { className: 'icon-button note-remove', title: 'Remove the note', attrs: { type: 'button', 'aria-label': 'Remove the note' } }, [icon('trash')]);
    const actions = h('span', { className: 'note-actions' }, [grip(), apart, removing]);
    // a link in a note opens; text being selected is not a click to edit
    text.addEventListener('click', (event) => {
      if (busy) return;
      if (event.target instanceof window.Element && event.target.closest('a') !== null) return;
      if ((window.getSelection()?.toString() ?? '') !== '') return;
      startWriting(note, text);
    });
    apart.addEventListener('click', () => {
      if (!busy) setShown(note.id, 'panel');
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

  // a note dragged by its grip to another place: there at once, then told — before the note now after it
  allowDragging(list, {
    items: () => [...list.children].flatMap((one) => (one instanceof window.HTMLElement && one.dataset.id !== undefined ? [one] : [])),
    idOf: (one) => one.dataset.id,
    axis: 'y',
    grip: '.note-grip',
    scroller: list,
    canStart: () => !busy,
    onStart: () => {
      busy = true;
    },
    onDrop: (id) => {
      const after = [...list.children].find((one) => one instanceof window.HTMLElement && one.dataset.id === id)?.nextElementSibling;
      busy = false;
      move(id, after instanceof window.HTMLElement ? after.dataset.id : undefined);
    },
    onCancel: () => {
      busy = false;
    },
  });
  adding.addEventListener('click', () => {
    if (!busy) startWriting(undefined, undefined);
  });
  addingApart.addEventListener('click', () => {
    if (!busy) writeApart();
  });
  history.addEventListener('click', showHistory);
  draw();
  return {
    element,
    show(next) {
      notes = next;
      if (!busy) draw();
    },
  };
}

/**
 * What a note is dragged by to another place among the notes.
 * @returns {HTMLElement}
 */
function grip() {
  return h('span', { className: 'note-grip', title: 'Drag to move the note', attrs: { 'aria-hidden': 'true' } }, [icon('grip')]);
}
