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
    // its ↶ and ↷
    buttons: { undo: Object.assign(window.document.createElement('button'), { className: 'note-undo' }), redo: Object.assign(window.document.createElement('button'), { className: 'note-redo' }) },
    /** @type {string[]} */
    shownTexts: [],
    /** @type {((text: string) => void) | undefined} */
    save: undefined,
    focused: false,
    disposed: false,
    // the note's text as typed now
    text: () => '# Plan\n- **check** the build\n- ship it',
    /** @param {string} text */
    show: (text) => void editor.shownTexts.push(text),
    focus: () => void (editor.focused = true),
    remake: () => undefined,
    shown: () => shownAs,
    /** @param {NoteShownAs} next */
    setShown: (next) => void (shownAs = next),
    dispose: () => void (editor.disposed = true),
  };
  /** The notes' editor, as the viewer's setting has it. */
  const engine = { now: 'live' };
  /** How the viewer answers the note saved to a file, each time in turn. @type {import('../public/model/notes.js').FileCreated[]} */
  const fileReplies = [];
  const panel = createNotePanel({
    toFile: {
      path: () => 'D:\\dev\\shop\\Plan.md',
      create: async (path, content, replace) => {
        asked.push(['create', path, content, String(replace)]);
        return fileReplies.shift() ?? { ok: false, error: 'failed' };
      },
    },
    engine: {
      title: () => (engine.now === 'live' ? 'Edit notes as blocks' : 'Edit notes with a live preview'),
      switch: () => {
        asked.push(['engine']);
        engine.now = engine.now === 'live' ? 'blocks' : 'live';
      },
    },
    note: () => kept.now,
    edit: (id, text) => void asked.push(['edit', id, text]),
    rename: (id, name) => void asked.push(['rename', id, name]),
    remove: (id) => void asked.push(['remove', id]),
    leave: () => void asked.push(['leave']),
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
  return { panel, asked, kept, editor, element, field, fileReplies };
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
// here or elsewhere — is left at once, once: its editor let go of, its buttons gone
test('notePanel_Should_ShowNoteAsItCameAgain_AndLeaveItOnceItIsGone', async () => {
  const { panel, kept, editor, field, asked } = noteOpen();

  kept.now = { ...plan, text: '# Plan from the phone', name: 'Phone plan' };
  await panel.reload();
  const named = field().value;
  kept.now = undefined;
  await panel.reload();
  await panel.reload();

  assert.deepEqual(
    { shown: editor.shownTexts, named, title: panel.name(), left: asked.filter(([what]) => what === 'leave').length, letGo: editor.disposed, buttons: panel.actions.children.length },
    { shown: ['# Plan from the phone'], named: 'Phone plan', title: 'Note', left: 1, letGo: true, buttons: 0 },
  );
});

// The note's buttons are its own, for the side panel's head beside ↻ and ×: its editor's ↶ and ↷, the notes' editor
// switched, its source — the fallback — pressed while it shows, and the bin; the body is its name and the note alone
test('notePanel_Should_GiveItsButtonsForPanelHead_UndoRedoEditorSourceAndBin', () => {
  const { panel, editor, element } = noteOpen();
  const buttons = () => [...panel.actions.querySelectorAll('button')].map((one) => [...one.classList].find((name) => name.startsWith('note-')));

  const shown = buttons();
  element('.note-source').click();
  const asSource = [editor.shown(), element('.note-source').getAttribute('aria-pressed')];

  assert.deepEqual(
    { shown, asSource, code: element('.note-source').innerHTML === icon('code').outerHTML, inBody: panel.element.querySelectorAll('button').length },
    { shown: ['note-undo', 'note-redo', 'note-engine', 'note-source', 'note-to-file', 'note-panel-remove'], asSource: ['source', 'true'], code: true, inBody: 0 },
  );
});

// The notes' editor — a live preview, as Obsidian has it, or blocks, as Notion has them — is switched where a note is
// edited: its button says what a press does, and says it anew once pressed
test('notePanel_Should_SwitchNotesEditor_FromItsButton', () => {
  const { asked, element } = noteOpen();

  const before = element('.note-engine').title;
  element('.note-engine').click();

  assert.deepEqual({ before, after: element('.note-engine').title, asked }, { before: 'Edit notes as blocks', after: 'Edit notes with a live preview', asked: [['engine']] });
});

// A note is saved to a file: its button offers the file in the session's folder, under the note's name; Save writes the
// note as it is typed now; a file there already is not written over until "Replace it" says so; the panel says where
// the note went
test('notePanel_Should_SaveNoteToFile_ReplacingOneThereOnlyWhenTold', async () => {
  const { asked, element, fileReplies } = noteOpen();
  fileReplies.push({ ok: false, error: 'exists' }, { ok: true, path: 'D:\\dev\\shop\\Plan.md' });
  const settled = () => new Promise((done) => setTimeout(done, 0));
  const path = () => {
    const found = element('input.note-file-path');
    assert.ok(found instanceof window.HTMLInputElement);
    return found.value;
  };

  element('.note-to-file').click();
  const offered = path();
  element('.note-file-save').click();
  await settled();
  const there = element('.note-file-there').textContent;
  element('.note-file-replace').click();
  await settled();

  assert.deepEqual(
    { offered, there, saved: element('.note-file-told').textContent, asked: asked.filter(([what]) => what === 'create') },
    {
      offered: 'D:\\dev\\shop\\Plan.md',
      there: 'A file is there already.',
      saved: 'Saved to D:\\dev\\shop\\Plan.md',
      asked: [
        ['create', 'D:\\dev\\shop\\Plan.md', '# Plan\n- **check** the build\n- ship it', 'false'],
        ['create', 'D:\\dev\\shop\\Plan.md', '# Plan\n- **check** the build\n- ship it', 'true'],
      ],
    },
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
