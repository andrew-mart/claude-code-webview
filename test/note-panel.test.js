import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
// DOMPurify and the icons look for the DOM as their modules load: it is set up first
Object.assign(globalThis, { window, document: window.document, NodeFilter: window.NodeFilter, Text: window.Text });
const { createNotePanel } = await import('../public/view/note-panel.js');
const { icon } = await import('../public/view/icons.js');

/** @typedef {import('../public/model/notes.js').Note} Note */
/** @typedef {import('../public/view/note-editor.js').NoteShownAs} NoteShownAs */

/** @type {Note} */
const plan = { id: 'n3', text: '# Plan\n- **check** the build', at: '2026-10-27T09:05:00.000Z', shown: 'panel' };

/**
 * A note open in the side panel over an editor standing in for CodeMirror; its changes recorded, the note as the page has
 * it now changeable.
 */
function noteOpen() {
  /** @type {string[][]} */
  const asked = [];
  /** @type {{ now: Note | undefined }} */
  const kept = { now: plan };
  /** @type {NoteShownAs} */
  let shownAs = 'preview';
  const editor = {
    element: Object.assign(window.document.createElement('div'), { className: 'note-editor' }),
    /** @type {string[]} */
    shownTexts: [],
    /** @type {((text: string) => void) | undefined} */
    save: undefined,
    focused: false,
    disposed: false,
    /** @param {string} text */
    show: (text) => void editor.shownTexts.push(text),
    focus: () => void (editor.focused = true),
    remake: () => undefined,
    shown: () => shownAs,
    /** @param {NoteShownAs} next */
    setShown: (next) => void (shownAs = next),
    dispose: () => void (editor.disposed = true),
  };
  const panel = createNotePanel({
    note: () => kept.now,
    edit: (id, text) => void asked.push(['edit', id, text]),
    rename: (id, name) => void asked.push(['rename', id, name]),
    remove: (id) => void asked.push(['remove', id]),
    editorOf: ({ text, save }) => {
      editor.element.textContent = text;
      editor.save = save;
      return editor;
    },
  });
  // its buttons in the side panel's head, above it
  window.document.body.replaceChildren(panel.actions, panel.element);
  /** @param {string} selector */
  const element = (selector) => {
    const found = window.document.body.querySelector(selector);
    assert.ok(found instanceof window.HTMLElement, `no ${selector}`);
    return found;
  };
  const field = () => {
    const found = element('input.note-panel-name');
    assert.ok(found instanceof window.HTMLInputElement);
    return found;
  };
  return { panel, asked, kept, editor, element, field };
}

// The note opened shows in its editor, always there to be typed in — what is typed saved as its text — titled by its
// name, its first line while it has none
test('notePanel_Should_ShowNoteInItsEditor_SavingWhatIsTyped', () => {
  const { panel, asked, editor } = noteOpen();

  editor.save?.('# Plan\n- check the build and the deploy');

  assert.deepEqual({ title: panel.name(), shown: editor.element.textContent, asked }, { title: 'Plan', shown: plan.text, asked: [['edit', 'n3', '# Plan\n- check the build and the deploy']] });
});

// The note is named in a field above it: empty, its first line standing in, while it has none; the name is saved a
// second after the typing stops — at once on Enter, which goes on to the note, or when the field is left
test('notePanel_Should_NameNoteInFieldAboveIt_SavedAsItIsTyped', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { asked, editor, field } = noteOpen();
  const offered = [field().value, field().placeholder];

  field().value = 'Week';
  field().dispatchEvent(new window.Event('input', { bubbles: true }));
  t.mock.timers.tick(900);
  const typing = [...asked];
  t.mock.timers.tick(100);
  field().value = 'Week plan';
  field().dispatchEvent(new window.Event('input', { bubbles: true }));
  field().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  field().value = 'Week plan, v2';
  field().dispatchEvent(new window.Event('input', { bubbles: true }));
  field().dispatchEvent(new window.FocusEvent('blur'));

  assert.deepEqual(
    { offered, typing, asked, onToNote: editor.focused },
    { offered: ['', 'Plan'], typing: [], asked: [['rename', 'n3', 'Week'], ['rename', 'n3', 'Week plan'], ['rename', 'n3', 'Week plan, v2']], onToNote: true },
  );
});

// The note coming again — changed on another device — is shown to its editor, its name in the field; a note removed —
// here or elsewhere — says so in its place, its editor let go of, its buttons gone
test('notePanel_Should_ShowNoteAsItCameAgain_AndTellWhenItIsGone', async () => {
  const { panel, kept, editor, field } = noteOpen();

  kept.now = { ...plan, text: '# Plan from the phone', name: 'Phone plan' };
  await panel.reload();
  const named = field().value;
  kept.now = undefined;
  await panel.reload();

  assert.deepEqual(
    { shown: editor.shownTexts, named, title: panel.name(), gone: panel.element.textContent, letGo: editor.disposed, buttons: panel.actions.children.length },
    { shown: ['# Plan from the phone'], named: 'Phone plan', title: 'Note', gone: 'This note was removed.', letGo: true, buttons: 0 },
  );
});

// The note's buttons are its own, for the side panel's head beside ↻ and ×: its source — the fallback — pressed while it
// shows, and the bin; the body is its name and the note alone
test('notePanel_Should_GiveItsButtonsForPanelHead_SourceAndBin', () => {
  const { panel, editor, element } = noteOpen();
  const buttons = () => [...panel.actions.querySelectorAll('button')].map((one) => [...one.classList].find((name) => name.startsWith('note-')));

  const shown = buttons();
  element('.note-source').click();
  const asSource = [editor.shown(), element('.note-source').getAttribute('aria-pressed')];

  assert.deepEqual(
    { shown, asSource, code: element('.note-source').innerHTML === icon('code').outerHTML, inBody: panel.element.querySelectorAll('button').length },
    { shown: ['note-source', 'note-panel-remove'], asSource: ['source', 'true'], code: true, inBody: 0 },
  );
});

// The bin — not the panel's × — asks first: ✕ keeps the note, ✓ removes it
test('notePanel_Should_RemoveNoteOnceConfirmed', () => {
  const { asked, element } = noteOpen();
  const bin = element('.note-panel-remove').innerHTML === icon('trash').outerHTML;

  element('.note-panel-remove').click();
  element('.note-keep').click();
  element('.note-panel-remove').click();
  element('.note-confirm-remove').click();

  assert.deepEqual({ bin, asked }, { bin: true, asked: [['remove', 'n3']] });
});
