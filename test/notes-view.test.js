import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
// DOMPurify and the icons look for the DOM as their modules load: it is set up first
Object.assign(globalThis, { window, document: window.document, NodeFilter: window.NodeFilter, Text: window.Text });
const { createNotesView } = await import('../public/view/notes-view.js');
const { icon } = await import('../public/view/icons.js');

/** @typedef {import('../public/model/notes.js').Note} Note */
/** @typedef {import('../public/view/note-editor.js').NoteShownAs} NoteShownAs */

/** @type {Note} */
const todo = { id: 'n2', text: '**TODO** check the build\n- the table test', at: '2026-10-27T09:05:00.000Z', shown: 'inline' };
/** @type {Note} */
const idea = { id: 'n1', text: 'idea: `herdr tab focus`', at: '2026-10-27T09:00:00.000Z', shown: 'inline' };

/**
 * A note's editor in place of CodeMirror: its text in its element; what it is shown, how, and whether it was let go of,
 * recorded; type saves as typing does.
 * @param {{ text: string, save: (text: string) => void }} given
 */
function fakeEditor({ text, save }) {
  const element = Object.assign(window.document.createElement('div'), { className: 'note-editor', textContent: text });
  /** @type {NoteShownAs} */
  let shownAs = 'preview';
  const editor = {
    element,
    // its ↶ and ↷
    buttons: { undo: Object.assign(window.document.createElement('button'), { className: 'note-undo' }), redo: Object.assign(window.document.createElement('button'), { className: 'note-redo' }) },
    /** @type {string[]} */
    shownTexts: [],
    disposed: false,
    /** @param {string} next */
    show(next) {
      editor.shownTexts.push(next);
    },
    text: () => element.textContent ?? '',
    focus: () => undefined,
    remake: () => undefined,
    shown: () => shownAs,
    /** @param {NoteShownAs} next */
    setShown(next) {
      shownAs = next;
    },
    dispose() {
      editor.disposed = true;
    },
    /** @param {string} typed */
    type(typed) {
      save(typed);
    },
  };
  return editor;
}

/** A notes section in the page, showing todo and idea in full, whose changes — and notes opened — are recorded. */
function notesShown() {
  /** @type {string[][]} */
  const asked = [];
  /** @type {ReturnType<typeof fakeEditor>[]} */
  const editors = [];
  const view = createNotesView({
    add: () => void asked.push(['add']),
    edit: (id, text) => void asked.push(['edit', id, text]),
    remove: (id) => void asked.push(['remove', id]),
    open: (id) => void asked.push(['open', id]),
    setShown: (id, shown) => void asked.push(['shown', id, shown]),
    showHistory: () => void asked.push(['history']),
    move: (id, before) => void asked.push(['move', id, String(before)]),
    editorOf: (given) => {
      const editor = fakeEditor(given);
      editors.push(editor);
      return editor;
    },
  });
  window.document.body.replaceChildren(view.element);
  view.show([todo, idea]);
  /** @param {string} selector @param {number} [at] */
  const element = (selector, at = 0) => {
    const found = view.element.querySelectorAll(selector)[at];
    assert.ok(found instanceof window.HTMLElement, `no ${selector} #${at}`);
    return found;
  };
  return { view, asked, editors, element };
}

// A note in full is its editor, always there to be typed in, in the order of the notes, their count in the title; what is
// typed in it is saved as the note's text
test('notesView_Should_ShowNotesInFullAsTheirEditors_AndSaveWhatIsTypedAsTheirText', () => {
  const { view, asked, editors } = notesShown();

  editors[0]?.type('**TODO** check the build and the deploy');

  assert.deepEqual(
    { count: view.element.querySelector('.outline-count')?.textContent, notes: [...view.element.querySelectorAll('.note > .note-editor')].map((one) => one.textContent), asked },
    { count: '2', notes: [todo.text, idea.text], asked: [['edit', 'n2', '**TODO** check the build and the deploy']] },
  );
});

// The notes coming again — a save's reply, another device's change — leave each note still there its editor, which is
// shown the note as it came, so what is typed is not taken away; a note gone lets its editor go, a new one gets its own
test('notesView_Should_KeepEditorsOfNotesStillThere_WhenNotesComeAgain', () => {
  const { view, editors } = notesShown();
  const [first, second] = editors;
  /** @type {Note} */
  const plan = { id: 'n3', text: '# Plan', at: '2026-10-27T09:10:00.000Z', shown: 'inline' };

  view.show([plan, { ...todo, text: 'changed on the phone' }]);

  assert.deepEqual(
    { made: editors.map((one) => one.element.textContent), shownToFirst: first?.shownTexts, secondLetGo: second?.disposed, kept: first?.element.isConnected },
    { made: [todo.text, idea.text, '# Plan'], shownToFirst: ['changed on the phone'], secondLetGo: true, kept: true },
  );
});

// "+" writes a new note — set apart from the start, written in the side panel; how it shows is the fold and unfold
// buttons' then; the clock shows the history of the notes' changes
test('notesView_Should_WriteNewNoteSetApart_AndShowHistoryOfChanges', () => {
  const { view, asked, element } = notesShown();

  element('.notes-add').click();
  element('.notes-history').click();

  assert.deepEqual({ asked, buttons: [...view.element.querySelectorAll('.notes-title-end button')].length }, { asked: [['add'], ['history']], buttons: 2 });
});

// A note in full is shown as its source — its markdown as typed, the fallback — by its button, pressed while it is, and
// back as it reads by the button again
test('notesView_Should_ShowNoteAsItsSource_AndBack_ByItsButton', () => {
  const { editors, element } = notesShown();
  const source = element('.note-source');

  source.click();
  const asSource = [editors[0]?.shown(), source.getAttribute('aria-pressed')];
  source.click();

  assert.deepEqual({ asSource, back: [editors[0]?.shown(), source.getAttribute('aria-pressed')], icon: source.innerHTML === icon('code').outerHTML }, { asSource: ['source', 'true'], back: ['preview', 'false'], icon: true });
});

// The bin asks first: ✓ removes the note, ✕ keeps it
test('notesView_Should_RemoveNote_OnlyOnceConfirmed', () => {
  const { view, asked, element } = notesShown();
  const bin = element('.note-remove').innerHTML === icon('trash').outerHTML;

  element('.note-remove').click();
  element('.note-keep').click();
  element('.note-remove').click();
  element('.note-confirm-remove').click();

  assert.deepEqual({ bin, asked, notes: view.element.querySelectorAll('.note').length }, { bin: true, asked: [['remove', 'n2']], notes: 2 });
});

// A note set apart is marked by a note's icon on the left of its name — as the side panel has it open — telling it from
// a note in full at a glance
test('notesView_Should_MarkNoteSetApart_ByNoteIconLeftOfItsName', () => {
  const { view, element } = notesShown();
  view.show([todo, { ...idea, shown: 'panel', name: 'Header ideas' }]);

  const row = element('.note-row');

  assert.deepEqual({ first: row.firstElementChild?.outerHTML === icon('note').outerHTML, name: row.textContent }, { first: true, name: 'Header ideas' });
});

// Each note is shown its own way, in the order of the notes: one set apart is listed by its name — the one given it, else
// its first line, Untitled while it has none — a press opening it in the side panel; a note in full is set apart by its
// button — its editor let go of — a name brought back inline by its own
test('notesView_Should_ShowEachNoteItsOwnWay_AndSetItApartOrBackInline', () => {
  const { view, asked, editors, element } = notesShown();
  view.show([todo, { ...idea, shown: 'panel', name: 'Header ideas' }, { id: 'n4', text: '', at: '2026-10-27T08:00:00.000Z', shown: 'panel' }]);

  const drawn = [...element('.notes-list').children].map((one) => (one.matches('.note') ? `in full: ${one.querySelector('.note-editor')?.textContent}` : `by name: ${one.querySelector('.note-row')?.textContent}`));
  element('.note-row').click();
  element('.note-apart').click();
  element('.note-inline').click();

  assert.deepEqual(
    { drawn, asked, ideaLetGo: editors[1]?.disposed },
    {
      drawn: [`in full: ${todo.text}`, 'by name: Header ideas', 'by name: Untitled'],
      asked: [
        ['open', 'n1'],
        ['shown', 'n2', 'panel'],
        ['shown', 'n1', 'inline'],
      ],
      ideaLetGo: true,
    },
  );
});

// A note in full has its buttons over its corner: its editor's ↶ and ↷ first, then its source, set apart, the bin — and
// they come back as they were once the bin is not confirmed
test('notesView_Should_GiveNoteInFull_ItsUndoAndRedo_FirstAmongItsButtons', () => {
  const { element } = notesShown();
  const buttons = () => [...element('.note-actions').querySelectorAll('button')].map((one) => one.className.replace('icon-button ', ''));

  const shown = buttons();
  element('.note-remove').click();
  element('.note-keep').click();

  assert.deepEqual({ shown, kept: buttons() }, { shown: ['note-undo', 'note-redo', 'note-source', 'note-apart', 'note-remove'], kept: ['note-undo', 'note-redo', 'note-source', 'note-apart', 'note-remove'] });
});

// A note is dragged to another place among the notes — one in full by its grip, one set apart by its whole row: it goes
// there at once and the move is told, before the note it is let go before. Dragged across its text, a note in full is
// not moved: that picks its words — the grip picks up none
test('notesView_Should_MoveNoteDraggedByItsGripOrItsRow_ToWhereItIsLetGo', () => {
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

  const textPicked = drag(element('.note-editor', 0), 15, [30, 70]);
  const byText = ids();
  const gripPicked = drag(element('.note-grip', 0), 15, [30, 70]);
  layOut();
  drag(element('.note-row', 0), 95, [80, 5]);

  assert.deepEqual(
    { byText, wordsPicked: [textPicked, gripPicked], order: ids(), asked },
    { byText: 'n2 n1 n3', wordsPicked: [true, false], order: 'n3 n1 n2', asked: [['move', 'n2', 'n3'], ['move', 'n3', 'n1']] },
  );
});

// The notes coming again — the window come back to, a save's reply — while a note in full is typed in leave it where it
// is: taken out of the page and put back, it would lose the cursor, though the notes set apart around it are drawn anew
test('notesView_Should_LeaveNoteInFullInPlace_WhenNotesComeAgain', async () => {
  const { view, element } = notesShown();
  /** @type {Note} */
  const plan = { id: 'n3', text: '# Plan', at: '2026-10-27T08:00:00.000Z', shown: 'inline' };
  const notes = [todo, { ...idea, shown: /** @type {const} */ ('panel') }, plan];
  view.show(notes);
  /** @type {Node[]} */
  const takenOut = [];
  const watching = new window.MutationObserver((records) => records.forEach((record) => takenOut.push(...record.removedNodes)));
  watching.observe(element('.notes-list'), { childList: true });

  view.show([...notes]);
  await Promise.resolve();
  watching.disconnect();

  assert.deepEqual(
    takenOut.map((node) => (node instanceof window.HTMLElement ? `${node.className} ${node.dataset.id}` : 'text')),
    ['note-line n1'],
  );
});
