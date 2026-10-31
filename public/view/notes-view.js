// @ts-check
// The notes of the session's project folder, first in the outline, in their order, each shown its own way: in full — its
// editor, always there to be typed in, what is typed saved as it goes (note-editor.js) — or set apart, listed by its
// name, the name opening it elsewhere (the side panel); a button on each sets it the other way. "+" writes a new note,
// set apart from the start — written in the side panel; the clock shows the history of the notes' changes. A note in
// full shows as its source by its button, the bin removes it once ✓ confirms. A note is moved among the others by its
// grip (drag-order.js). The notes coming again from the server leave each note still there its editor: what is typed is
// not taken away; while a note is moved, they wait.
import { h } from './dom.js';
import { icon } from './icons.js';
import { noteName } from '../model/notes.js';
import { allowDragging } from './drag-order.js';

/**
 * @typedef {import('../model/notes.js').Note} Note
 * @typedef {import('../model/notes.js').NoteShown} NoteShown
 * @typedef {import('./note-editor.js').NoteEditor} NoteEditor
 * @typedef {(note: { text: string, save: (text: string) => void }) => NoteEditor} EditorOf — a note's editor, what is
 *   typed in it saved by save
 */

/**
 * @param {{ add: () => void, edit: (id: string, text: string) => void, remove: (id: string) => void, open: (id: string) => void, setShown: (id: string, shown: NoteShown) => void, showHistory: () => void, move: (id: string, before: string | undefined) => void, editorOf: EditorOf }} actions
 *   — add: a new note, set apart, written elsewhere; a note's new text, a note removed; open: a note set apart shown in
 *   full elsewhere; setShown: a note set apart, or back inline; showHistory: the history of the notes' changes shown
 *   elsewhere; move: a note put before another — none, last
 * @returns {{ element: HTMLElement, show: (notes: readonly Note[]) => void }} — show: the notes as they stand now
 */
export function createNotesView({ add, edit, remove, open, setShown, showHistory, move, editorOf }) {
  const count = h('span', { className: 'outline-count' });
  const adding = h('button', { className: 'icon-button notes-add', title: 'Write a note — in the side panel; unfolded, it shows here in full', attrs: { type: 'button', 'aria-label': 'Write a note' } }, [icon('plus')]);
  const history = h('button', { className: 'icon-button notes-history', title: "The notes' changes — any of them undone", attrs: { type: 'button', 'aria-label': "The notes' changes" } }, [icon('history')]);
  const list = h('div', { className: 'notes-list' });
  const element = h('section', { className: 'outline-section notes' }, [h('div', { className: 'outline-title' }, [h('span', { text: 'Notes' }), h('span', { className: 'notes-title-end' }, [count, history, adding])]), list]);
  /** @type {readonly Note[]} */
  let notes = [];
  /** The notes in full drawn, by id: each its element and its editor, kept as the notes come again. */
  /** @type {Map<string, { element: HTMLElement, editor: NoteEditor }>} */
  const inFull = new Map();
  let dragging = false;

  const draw = () => {
    count.textContent = notes.length === 0 ? '' : String(notes.length);
    const shownInFull = new Set(notes.flatMap((note) => (note.shown === 'inline' ? [note.id] : [])));
    for (const [id, drawn] of inFull) {
      if (shownInFull.has(id)) continue;
      drawn.editor.dispose();
      inFull.delete(id);
    }
    const items = notes.map((note) => (note.shown === 'inline' ? noteInFull(note) : noteRow(note)));
    if (items.length === 0) {
      list.replaceChildren(h('div', { className: 'outline-empty', text: "Notes on this project's folder, in markdown: + writes one." }));
      return;
    }
    placeInOrder(list, items);
  };

  /**
   * A note set apart, listed by its name — the one given it, else its first line — a note's icon on its left, as the side
   * panel has it open: a press shows the whole of it there; the button beside brings it back inline.
   * @param {Note} note
   * @returns {HTMLElement}
   */
  const noteRow = (note) => {
    const name = noteName(note);
    const row = h('button', { className: 'note-row', title: 'Open the note', attrs: { type: 'button' } }, [icon('note'), h('span', { className: 'note-row-name', text: name === '' ? 'Untitled' : name })]);
    const inline = h('button', { className: 'icon-button note-inline', title: 'Show the note in full here', attrs: { type: 'button', 'aria-label': 'Show the note in full here' } }, [icon('unfold')]);
    row.addEventListener('click', () => open(note.id));
    inline.addEventListener('click', () => setShown(note.id, 'inline'));
    return h('div', { className: 'note-line', attrs: { 'data-id': note.id } }, [row, grip(), inline]);
  };

  /**
   * A note in full: its editor, made once and shown the note as it comes again; its buttons over its corner.
   * @param {Note} note
   * @returns {HTMLElement}
   */
  const noteInFull = (note) => {
    const drawn = inFull.get(note.id);
    if (drawn !== undefined) {
      drawn.editor.show(note.text);
      return drawn.element;
    }
    const editor = editorOf({ text: note.text, save: (text) => edit(note.id, text) });
    const source = h('button', { className: 'icon-button note-source', title: 'Show its markdown as typed', attrs: { type: 'button', 'aria-label': 'Show its markdown as typed', 'aria-pressed': 'false' } }, [icon('code')]);
    const apart = h('button', { className: 'icon-button note-apart', title: 'List the note by its name — it opens in the side panel', attrs: { type: 'button', 'aria-label': 'List the note by its name' } }, [icon('fold')]);
    const removing = h('button', { className: 'icon-button note-remove', title: 'Remove the note', attrs: { type: 'button', 'aria-label': 'Remove the note' } }, [icon('trash')]);
    const actions = h('span', { className: 'note-actions' });
    const showButtons = () => actions.replaceChildren(grip(), source, apart, removing);
    showButtons();
    source.addEventListener('click', () => {
      editor.setShown(editor.shown() === 'source' ? 'preview' : 'source');
      source.setAttribute('aria-pressed', String(editor.shown() === 'source'));
    });
    apart.addEventListener('click', () => setShown(note.id, 'panel'));
    removing.addEventListener('click', () => {
      const yes = h('button', { className: 'icon-button note-confirm-remove', title: 'Remove the note', attrs: { type: 'button', 'aria-label': 'Remove the note' } }, [icon('check')]);
      const no = h('button', { className: 'icon-button note-keep', title: 'Keep it', attrs: { type: 'button', 'aria-label': 'Keep it' } }, [icon('cross')]);
      yes.addEventListener('click', () => {
        showButtons();
        remove(note.id);
      });
      no.addEventListener('click', showButtons);
      actions.replaceChildren(yes, no);
      yes.focus();
    });
    const item = h('div', { className: 'note', attrs: { 'data-id': note.id } }, [editor.element, actions]);
    inFull.set(note.id, { element: item, editor });
    return item;
  };

  // a note dragged by its grip to another place: there at once, then told — before the note now after it
  allowDragging(list, {
    items: () => [...list.children].flatMap((one) => (one instanceof window.HTMLElement && one.dataset.id !== undefined ? [one] : [])),
    idOf: (one) => one.dataset.id,
    axis: 'y',
    grip: '.note-grip',
    scroller: list,
    canStart: () => true,
    onStart: () => {
      dragging = true;
    },
    onDrop: (id) => {
      const after = [...list.children].find((one) => one instanceof window.HTMLElement && one.dataset.id === id)?.nextElementSibling;
      dragging = false;
      move(id, after instanceof window.HTMLElement ? after.dataset.id : undefined);
    },
    onCancel: () => {
      dragging = false;
      draw();
    },
  });
  adding.addEventListener('click', add);
  history.addEventListener('click', showHistory);
  draw();
  return {
    element,
    show(next) {
      notes = next;
      if (!dragging) draw();
    },
  };
}

/**
 * The list's children put in the order given: those no longer there taken out first — a row drawn anew is a new one —
 * then each moved only when out of its place: a note being typed in is not taken out of the page, which would take its
 * focus.
 * @param {HTMLElement} list
 * @param {readonly HTMLElement[]} items
 */
function placeInOrder(list, items) {
  const kept = new Set(items);
  for (const child of [...list.children]) if (!(child instanceof window.HTMLElement && kept.has(child))) child.remove();
  items.forEach((item, at) => {
    if (list.children[at] !== item) list.insertBefore(item, list.children[at] ?? null);
  });
}

/**
 * What a note is dragged by to another place among the notes.
 * @returns {HTMLElement}
 */
function grip() {
  return h('span', { className: 'note-grip', title: 'Drag to move the note', attrs: { 'aria-hidden': 'true' } }, [icon('grip')]);
}
