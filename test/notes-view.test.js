import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
// DOMPurify and the icons look for the DOM as their modules load: it is set up first
Object.assign(globalThis, { window, document: window.document, NodeFilter: window.NodeFilter, Text: window.Text });
const { createNotesView } = await import('../public/view/notes-view.js');

/** @typedef {import('../public/model/notes.js').Note} Note */

/** @type {Note} */
const todo = { id: 'n2', text: '**TODO** check the build\n- the table test', at: '2026-10-27T09:05:00.000Z' };
/** @type {Note} */
const idea = { id: 'n1', text: 'idea: `herdr tab focus`', at: '2026-10-27T09:00:00.000Z' };

/** A notes section in the page, showing todo and idea, whose changes are recorded. */
function notesShown() {
  /** @type {string[][]} */
  const asked = [];
  const view = createNotesView({
    add: (text) => void asked.push(['add', text]),
    edit: (id, text) => void asked.push(['edit', id, text]),
    remove: (id) => void asked.push(['remove', id]),
  });
  window.document.body.replaceChildren(view.element);
  view.show([todo, idea]);
  /** @param {string} selector @param {number} [at] */
  const element = (selector, at = 0) => {
    const found = view.element.querySelectorAll(selector)[at];
    assert.ok(found instanceof window.HTMLElement, `no ${selector} #${at}`);
    return found;
  };
  /** @param {string} key @param {{ ctrlKey?: boolean }} [modifiers] */
  const press = (key, modifiers = {}) => element('textarea').dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  /** @param {string} value */
  const type = (value) => {
    const box = element('textarea');
    assert.ok(box instanceof window.HTMLTextAreaElement);
    box.value = value;
  };
  return { view, asked, element, press, type };
}

// The notes are drawn as markdown, the latest first as the server sends them, their count in the title
test('notesView_Should_DrawEachNoteAsMarkdown_WithCount', () => {
  const { view } = notesShown();

  assert.deepEqual(
    {
      count: view.element.querySelector('.outline-count')?.textContent,
      notes: [...view.element.querySelectorAll('.note-text')].map((text) => [text.querySelector('strong, code')?.outerHTML, text.querySelectorAll('li').length]),
    },
    { count: '2', notes: [['<strong>TODO</strong>', 1], ['<code>herdr tab focus</code>', 0]] },
  );
});

// "+" opens an empty box over the notes: Ctrl+Enter keeps what is written there as a new note; a box left empty adds
// nothing
test('notesView_Should_AddNoteWritten_WithCtrlEnter_AndNothingForEmptyBox', () => {
  const { asked, element, press, type } = notesShown();

  element('.notes-add').click();
  type('  ');
  press('Enter', { ctrlKey: true });
  element('.notes-add').click();
  type('## Plan\n1. notes');
  press('Enter', { ctrlKey: true });

  assert.deepEqual(asked, [['add', '## Plan\n1. notes']]);
});

// A click on a note edits its markdown in place: a click elsewhere keeps the change, Escape leaves the note as it was;
// a note left as it was sends nothing
test('notesView_Should_EditNoteInPlace_KeepingOnBlur_AndLeavingOnEscape', () => {
  const { asked, element, press, type } = notesShown();

  element('.note-text', 1).click();
  const shown = /** @type {HTMLTextAreaElement} */ (element('textarea')).value;
  type('idea: `herdr tab focus` — in the header now');
  element('textarea').dispatchEvent(new window.FocusEvent('blur'));
  element('.note-text', 0).click();
  type('changed my mind');
  press('Escape');
  element('.note-text', 0).click();
  element('textarea').dispatchEvent(new window.FocusEvent('blur'));

  assert.deepEqual({ shown, asked, editing: element('.note-text', 0).textContent?.includes('TODO') }, { shown: idea.text, asked: [['edit', 'n1', 'idea: `herdr tab focus` — in the header now']], editing: true });
});

// × asks first: ✓ removes the note, ✕ keeps it
test('notesView_Should_RemoveNote_OnlyOnceConfirmed', () => {
  const { asked, element } = notesShown();

  element('.note-remove', 0).click();
  element('.note-keep').click();
  element('.note-remove', 1).click();
  element('.note-confirm-remove').click();

  assert.deepEqual(asked, [['remove', 'n1']]);
});

// The notes coming again from the server — another device's change — do not take away what is being typed
test('notesView_Should_KeepTextBeingTyped_When_NotesComeAgain', () => {
  const { view, asked, element, press, type } = notesShown();

  element('.note-text', 0).click();
  type('**TODO** check the deploy too');
  view.show([idea]);
  press('Enter', { ctrlKey: true });

  assert.deepEqual({ asked, notes: [...view.element.querySelectorAll('.note-text')].length }, { asked: [['edit', 'n2', '**TODO** check the deploy too']], notes: 1 });
});
