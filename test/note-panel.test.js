import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
// DOMPurify and the icons look for the DOM as their modules load: it is set up first
Object.assign(globalThis, { window, document: window.document, NodeFilter: window.NodeFilter, Text: window.Text });
const { createNoteDraft, createNotePanel } = await import('../public/view/note-panel.js');
const { icon } = await import('../public/view/icons.js');

/** @typedef {import('../public/model/notes.js').Note} Note */

/** @type {Note} */
const plan = { id: 'n3', text: '# Plan\n- **check** the build', at: '2026-10-27T09:05:00.000Z', shown: 'panel' };

/** A note open in the side panel, whose changes are recorded; the note as the page has it now can be changed. */
function noteOpen() {
  /** @type {string[][]} */
  const asked = [];
  /** @type {{ now: Note | undefined }} */
  const kept = { now: plan };
  const panel = createNotePanel({ note: () => kept.now, edit: (id, text, name) => void asked.push(['edit', id, text, name]), remove: (id) => void asked.push(['remove', id]) });
  window.document.body.replaceChildren(panel.element);
  /** @param {string} selector */
  const element = (selector) => {
    const found = panel.element.querySelector(selector);
    assert.ok(found instanceof window.HTMLElement, `no ${selector}`);
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
  return { panel, asked, kept, element, press, type };
}

// The note opened from its name shows in full as markdown, named by its first line; ✎ edits its markdown in place —
// Escape leaves it as it was, Ctrl+Enter keeps the change — and the notes coming again meanwhile leave what is typed
test('notePanel_Should_ShowNoteInFull_AndEditItInPlace_KeepingWhatIsTyped', async () => {
  const { panel, asked, element, press, type } = noteOpen();
  const drawn = [panel.name(), element('.note-panel-text h1').textContent, element('.note-panel-text strong').textContent];

  element('.note-panel-edit').click();
  const shown = /** @type {HTMLTextAreaElement} */ (element('textarea')).value;
  type('changed my mind');
  press('Escape');
  element('.note-panel-edit').click();
  type('# Plan\n- check the build\n- and the deploy');
  await panel.reload();
  press('Enter', { ctrlKey: true });

  assert.deepEqual({ drawn, shown, asked }, { drawn: ['Plan', 'Plan', 'check'], shown: plan.text, asked: [['edit', 'n3', '# Plan\n- check the build\n- and the deploy', '']] });
});

// The bin — not the panel's × — asks first: ✕ keeps the note, ✓ removes it; a note removed — here or on another device — says so in its place
test('notePanel_Should_RemoveNoteOnceConfirmed_AndTellWhenItIsGone', async () => {
  const { panel, asked, kept, element } = noteOpen();
  const bin = element('.note-panel-remove').innerHTML === icon('trash').outerHTML;

  element('.note-panel-remove').click();
  element('.note-keep').click();
  element('.note-panel-remove').click();
  element('.note-confirm-remove').click();
  kept.now = undefined;
  await panel.reload();

  assert.deepEqual({ bin, asked, gone: panel.element.textContent }, { bin: true, asked: [['remove', 'n3']], gone: 'This note was removed.' });
});

// The note is named by hand in its editor, above its markdown: the name field shows the name it has — empty, the first
// line standing in, while it has none; going from the name to the markdown goes on editing, Enter in the name keeps both;
// the panel's title is the note's name as it is now
test('notePanel_Should_NameNoteInItsEditor_AndTitlePanelByNameAsItIsNow', async () => {
  const { panel, asked, kept, element } = noteOpen();
  const before = panel.name();

  element('.note-panel-edit').click();
  const field = element('input.note-panel-name');
  assert.ok(field instanceof window.HTMLInputElement);
  const offered = [field.value, field.placeholder];
  field.value = 'Week plan';
  field.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true, relatedTarget: element('textarea') }));
  const editing = panel.element.querySelector('textarea') !== null;
  field.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  kept.now = { ...plan, name: 'Week plan' };
  await panel.reload();

  assert.deepEqual(
    { before, offered, editing, asked, after: panel.name() },
    { before: 'Plan', offered: ['', 'Plan'], editing: true, asked: [['edit', 'n3', plan.text, 'Week plan']], after: 'Week plan' },
  );
});

// A note set apart from the start is written in the side panel, under a name given above it — Enter there goes on to
// the markdown: Ctrl+Enter or ✓ keeps what is written — nothing while
// the box is empty — a click elsewhere, or the notes coming again, leave it being written; Escape or ✕ leave it unwritten
test('noteDraft_Should_KeepWrittenOnCtrlEnterOrCheck_NotOnBlur_AndLeaveOnEscapeOrCross', async () => {
  /** @type {string[][]} */
  const asked = [];
  const draft = createNoteDraft({ keep: (text, name) => void asked.push(['keep', text, name]), leave: () => void asked.push(['leave']) });
  window.document.body.replaceChildren(draft.element);
  const box = draft.element.querySelector('textarea');
  assert.ok(box instanceof window.HTMLTextAreaElement, 'no box to write in');
  /** @param {string} key @param {{ ctrlKey?: boolean }} [modifiers] */
  const press = (key, modifiers = {}) => box.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  /** @param {string} selector */
  const click = (selector) => draft.element.querySelector(selector)?.dispatchEvent(new window.MouseEvent('click'));

  const field = draft.element.querySelector('input.note-panel-name');
  assert.ok(field instanceof window.HTMLInputElement, 'no field to name it in');
  box.value = '  ';
  press('Enter', { ctrlKey: true });
  field.value = 'Deploy runbook';
  field.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const onToMarkdown = window.document.activeElement === box;
  box.value = '# Deploy\n- step one';
  box.dispatchEvent(new window.FocusEvent('blur'));
  await draft.reload();
  const still = box.value;
  press('Enter', { ctrlKey: true });
  click('.note-draft-keep');
  press('Escape');
  click('.note-draft-leave');

  assert.deepEqual(
    { name: draft.name(), onToMarkdown, still, asked },
    {
      name: 'New note',
      onToMarkdown: true,
      still: '# Deploy\n- step one',
      asked: [['keep', '# Deploy\n- step one', 'Deploy runbook'], ['keep', '# Deploy\n- step one', 'Deploy runbook'], ['leave'], ['leave']],
    },
  );
});

// Editing needs no keyboard to end: ✓ keeps the name and markdown, ✕ leaves the note as it was — pressed, neither takes
// the focus from what is being edited, which would keep it first
test('notePanel_Should_KeepEditOnCheck_AndLeaveItOnCross_WithoutKeyboard', () => {
  const { asked, element, type } = noteOpen();
  /** @param {string} selector */
  const press = (selector) => {
    const pressed = element(selector);
    const taken = !pressed.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    pressed.click();
    return taken;
  };

  element('.note-panel-edit').click();
  type('# Plan\n- nothing yet');
  const leaving = press('.note-leave-edit');
  element('.note-panel-edit').click();
  type('# Plan\n- check the deploy');
  const keeping = press('.note-keep-edit');

  assert.deepEqual({ focusKept: [leaving, keeping], asked }, { focusKept: [true, true], asked: [['edit', 'n3', '# Plan\n- check the deploy', '']] });
});
