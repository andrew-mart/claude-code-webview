import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
// DOMPurify and the icons look for the DOM as their modules load: it is set up first
Object.assign(globalThis, { window, document: window.document, NodeFilter: window.NodeFilter, Text: window.Text });
const { createNotesView } = await import('../public/view/notes-view.js');
const { icon } = await import('../public/view/icons.js');

/** @typedef {import('../public/model/notes.js').Note} Note */

/** @type {Note} */
const todo = { id: 'n2', text: '**TODO** check the build\n- the table test', at: '2026-10-27T09:05:00.000Z', shown: 'inline' };
/** @type {Note} */
const idea = { id: 'n1', text: 'idea: `herdr tab focus`', at: '2026-10-27T09:00:00.000Z', shown: 'inline' };

/** A notes section in the page, showing todo and idea in full, whose changes — and notes opened — are recorded. */
function notesShown() {
  /** @type {string[][]} */
  const asked = [];
  const view = createNotesView({
    add: (text) => void asked.push(['add', text]),
    edit: (id, text) => void asked.push(['edit', id, text]),
    remove: (id) => void asked.push(['remove', id]),
    open: (id) => void asked.push(['open', id]),
    setShown: (id, shown) => void asked.push(['shown', id, shown]),
    writeApart: () => void asked.push(['write apart']),
    showHistory: () => void asked.push(['history']),
    move: (id, before) => void asked.push(['move', id, String(before)]),
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

// Beside "+", one button writes a note set apart from the start — elsewhere, the side panel — and another shows the
// history of the notes' changes
test('notesView_Should_OfferNoteSetApartFromStart_AndHistoryOfChanges', () => {
  const { asked, element } = notesShown();

  element('.notes-add-apart').click();
  element('.notes-history').click();

  assert.deepEqual(asked, [['write apart'], ['history']]);
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

// The bin asks first: ✓ removes the note, ✕ keeps it
test('notesView_Should_RemoveNote_OnlyOnceConfirmed', () => {
  const { asked, element } = notesShown();
  const bin = element('.note-remove').innerHTML === icon('trash').outerHTML;

  element('.note-remove', 0).click();
  element('.note-keep').click();
  element('.note-remove', 1).click();
  element('.note-confirm-remove').click();

  assert.deepEqual({ bin, asked }, { bin: true, asked: [['remove', 'n1']] });
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

// Each note is shown its own way, in the order of the notes: one set apart is listed by its name — the one given it, else
// its first line — a press opening it —
// the whole of it shown elsewhere; a note in full is set apart by its button, a name brought back inline by its own
test('notesView_Should_ShowEachNoteItsOwnWay_AndSetItApartOrBackInline', () => {
  const { view, asked, element } = notesShown();
  view.show([todo, { ...idea, shown: 'panel', name: 'Header ideas' }]);

  const drawn = [...element('.notes-list').children].map((one) => (one.matches('.note') ? `in full: ${one.querySelector('strong')?.textContent}` : `by name: ${one.querySelector('.note-row')?.textContent}`));
  element('.note-row').click();
  element('.note-apart').click();
  element('.note-inline').click();

  assert.deepEqual(
    { drawn, asked },
    {
      drawn: ['in full: TODO', 'by name: Header ideas'],
      asked: [
        ['open', 'n1'],
        ['shown', 'n2', 'panel'],
        ['shown', 'n1', 'inline'],
      ],
    },
  );
});

// Writing or editing a note needs no keyboard to end: ✓ under it keeps it, ✕ leaves it — pressed, neither takes the focus
// from the note, which would keep it first
test('notesView_Should_KeepNoteOnCheck_AndLeaveItOnCross_WithoutKeyboard', () => {
  const { asked, element, type } = notesShown();
  /** @param {string} selector */
  const press = (selector) => {
    const pressed = element(selector);
    const taken = !pressed.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    pressed.click();
    return taken;
  };

  element('.notes-add').click();
  type('## Plan');
  const adding = press('.note-keep-edit');
  element('.note-text', 0).click();
  type('changed my mind');
  const leaving = press('.note-leave-edit');
  element('.note-text', 1).click();
  type('idea: `herdr tab focus` — done');
  const editing = press('.note-keep-edit');

  assert.deepEqual(
    { focusKept: [adding, leaving, editing], asked },
    { focusKept: [true, true, true], asked: [['add', '## Plan'], ['edit', 'n1', 'idea: `herdr tab focus` — done']] },
  );
});

// A note is dragged by its grip to another place among the notes — in full or set apart alike: it goes there at once and
// the move is told, before the note it is let go before; the click the drag ends with edits nothing. Dragged across its
// text, a note in full is not moved: that picks its words — the grip picks up none
test('notesView_Should_MoveNoteDraggedByItsGrip_ToWhereItIsLetGo', () => {
  const { view, asked, element } = notesShown();
  /** @type {Note} */
  const plan = { id: 'n3', text: '# Plan', at: '2026-10-27T08:00:00.000Z', shown: 'panel' };
  view.show([todo, idea, plan]);
  const list = element('.notes-list');
  /** The notes laid out as a browser would — jsdom lays nothing out: one under another, 40px apart, each 30px high. */
  const layOut = () =>
    [...list.children].forEach((one, at) => Object.defineProperty(one, 'getBoundingClientRect', { value: () => ({ top: 40 * at, bottom: 40 * at + 30, height: 30, left: 0, right: 200, width: 200, x: 0, y: 40 * at, toJSON: () => undefined }), configurable: true }));
  /** @param {string} type @param {EventTarget} at @param {number} y */
  const pointer = (type, at, y) => at.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, clientX: 20, clientY: y, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  /**
   * A press, moves and a let-go: whether the press was left to the browser — to pick up the words under it.
   * @param {Element} from @param {number} y @param {readonly number[]} path
   */
  const drag = (from, y, path) => {
    const leftToBrowser = pointer('pointerdown', from, y);
    for (const step of path) pointer('pointermove', window, step);
    pointer('pointerup', window, path.at(-1) ?? y);
    return leftToBrowser;
  };
  const ids = () => [...list.children].map((one) => one.getAttribute('data-id')).join(' ');
  layOut();

  const textPicked = drag(element('.note-text', 0), 15, [30, 70]);
  const byText = ids();
  const gripPicked = drag(element('.note-grip', 0), 15, [30, 70]);
  element('.note-text', 0).click();
  const editing = list.querySelector('textarea') !== null;
  layOut();
  drag(element('.note-grip', 2), 95, [80, 5]);

  assert.deepEqual(
    { byText, wordsPicked: [textPicked, gripPicked], editing, order: ids(), asked },
    { byText: 'n2 n1 n3', wordsPicked: [true, false], editing: false, order: 'n3 n1 n2', asked: [['move', 'n2', 'n3'], ['move', 'n3', 'n1']] },
  );
});
