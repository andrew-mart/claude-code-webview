import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
// DOMPurify and the icons look for the DOM as their modules load: it is set up first
Object.assign(globalThis, { window, document: window.document, NodeFilter: window.NodeFilter, Text: window.Text });
const { createNoteEditor } = await import('../public/view/note-editor.js');

/** @typedef {import('../public/view/note-editor.js').MountOptions} MountOptions */

/**
 * A note's editor over a box to type in, in place of CodeMirror: what is saved, what it was mounted as, recorded. What is
 * typed is undone and done again as an editor does it — not told by onChange, as Milkdown does not tell it of a note not
 * being typed in — back to the text it was made with, or last given.
 * @param {string} text
 */
function editorOver(text) {
  /** @type {string[]} */
  const saved = [];
  /** @type {string[]} */
  const mounted = [];
  /** @type {HTMLTextAreaElement | undefined} */
  let box;
  /** @type {MountOptions | undefined} */
  let options;
  /** The box's text before each typing, the latest last; and before each undoing. */
  /** @type {string[]} */
  const done = [];
  /** @type {string[]} */
  const undone = [];
  /** @param {string[]} from @param {string[]} to */
  const step = (from, to) => {
    const back = from.pop();
    if (box === undefined || back === undefined) return;
    to.push(box.value);
    box.value = back;
  };
  const editor = createNoteEditor({
    text,
    shown: 'preview',
    placeholder: 'Write here',
    save: (written) => void saved.push(written),
    onOpen: () => undefined,
    mount: async (host, given) => {
      options = given;
      mounted.push(`${given.shown}: ${given.text}`);
      const area = window.document.createElement('textarea');
      area.value = given.text;
      host.replaceChildren(area);
      box = area;
      done.length = 0;
      undone.length = 0;
      return {
        text: () => area.value,
        replace: (next) => {
          area.value = next;
          done.length = 0;
          undone.length = 0;
        },
        focus: () => area.focus(),
        hasFocus: () => window.document.activeElement === area,
        undo: () => step(done, undone),
        redo: () => step(undone, done),
        canUndo: () => done.length > 0,
        canRedo: () => undone.length > 0,
        destroy: () => area.remove(),
      };
    },
  });
  window.document.body.replaceChildren(editor.element);
  /** @param {string} next */
  const type = (next) => {
    if (box === undefined || options === undefined) throw new Error('not mounted yet');
    box.focus();
    done.push(box.value);
    undone.length = 0;
    box.value = next;
    options.onChange(next);
  };
  const leave = () => {
    box?.blur();
    options?.onBlur();
  };
  const shown = () => box?.value;
  return { editor, saved, mounted, type, leave, shown };
}

/** The editor made: its making's promises settled — setImmediate, not the timers a test may have taken over. */
const mounting = () => new Promise((done) => setImmediate(done));

// What is typed is saved a second after the typing stops — not on each key — and at once when the note is left;
// nothing is saved when nothing changed
test('noteEditor_Should_SaveSecondAfterTypingStops_AndAtOnceWhenLeft', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { saved, type, leave } = editorOver('# Plan');
  await mounting();

  type('# Plan\n- o');
  t.mock.timers.tick(600);
  type('# Plan\n- one');
  t.mock.timers.tick(900);
  const typing = [...saved];
  t.mock.timers.tick(100);
  const paused = [...saved];
  type('# Plan\n- one\n- two');
  leave();
  leave();

  assert.deepEqual({ typing, paused, saved }, { typing: [], paused: ['# Plan\n- one'], saved: ['# Plan\n- one', '# Plan\n- one\n- two'] });
});

// ↶ undoes what was typed, ↷ does it again — what the note then says saved as what is typed is, whether or not the
// editor told of it; each is there to press only while there is something to undo, or to do again
test('noteEditor_Should_UndoAndRedoWhatWasTyped_ByItsButtons_SavingWhatNoteThenSays', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { editor, saved, type, shown } = editorOver('# Plan');
  await mounting();
  const { undo, redo } = editor.buttons;
  const pressable = () => [undo.disabled ? '' : 'undo', redo.disabled ? '' : 'redo'].join('|');

  const opened = pressable();
  type('# Plan\n- one');
  t.mock.timers.tick(1000);
  const typed = pressable();
  undo.click();
  t.mock.timers.tick(1000);
  const undone = { text: shown(), pressable: pressable() };
  redo.click();
  t.mock.timers.tick(1000);
  const redone = { text: shown(), pressable: pressable() };

  assert.deepEqual(
    { opened, typed, undone, redone, saved },
    { opened: '|', typed: 'undo|', undone: { text: '# Plan', pressable: '|redo' }, redone: { text: '# Plan\n- one', pressable: 'undo|' }, saved: ['# Plan\n- one', '# Plan', '# Plan\n- one'] },
  );
});

// ↶ and ↷ pressed take no focus: the cursor stays where it was in the note, on a phone the keyboard stays up
test('noteEditor_Should_LeaveCursorInNote_WhenItsButtonsArePressed', async () => {
  const { editor } = editorOver('# Plan');
  await mounting();

  const kept = [editor.buttons.undo, editor.buttons.redo].map((button) => !button.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true })));

  assert.deepEqual(kept, [true, true]);
});

// The editor made anew — shown the other way — or given the note as it came again has nothing to undo: ↶ is not there to
// press, as if the note were just opened
test('noteEditor_Should_HaveNothingToUndo_OnceMadeAnew_OrGivenNoteAsItCameAgain', async () => {
  const { editor, type, leave } = editorOver('# Plan');
  await mounting();
  const { undo } = editor.buttons;

  type('# Plan\n- one');
  editor.setShown('source');
  await mounting();
  const madeAnew = undo.disabled;
  type('# Plan\n- one\n- two');
  leave();
  editor.show('# Plan from the phone');
  const cameAgain = undo.disabled;

  assert.deepEqual({ madeAnew, cameAgain }, { madeAnew: true, cameAgain: true });
});

// The note coming again — changed on another device — shows its text while it is not being edited; while it is, what is
// typed stays, not to be taken away
test('noteEditor_Should_ShowNoteAsItCameAgain_UnlessBeingEdited', async () => {
  const { editor, type, leave, shown } = editorOver('# Plan');
  await mounting();

  editor.show('# Plan from the phone');
  const idle = shown();
  type('# Plan, typed here');
  editor.show('# Plan from the phone, again');
  const typing = shown();
  leave();

  assert.deepEqual({ idle, typing }, { idle: '# Plan from the phone', typing: '# Plan, typed here' });
});

// Shown as its source — the fallback — and back as it reads: the editor made anew each time with the text as it stands,
// what was typed meanwhile saved first
test('noteEditor_Should_ShowSourceAndBack_CarryingTextAsItStands', async () => {
  const { editor, saved, mounted, type } = editorOver('# Plan');
  await mounting();

  type('# Plan\n- one');
  editor.setShown('source');
  await mounting();
  editor.setShown('source');
  await mounting();
  editor.setShown('preview');
  await mounting();

  assert.deepEqual({ mounted, saved, now: editor.shown() }, { mounted: ['preview: # Plan', 'source: # Plan\n- one', 'preview: # Plan\n- one'], saved: ['# Plan\n- one'], now: 'preview' });
});

// The editor let go of — its note closed, the notes drawn anew — saves what was typed; one let go of before it was made
// leaves nothing behind
test('noteEditor_Should_SaveWhatWasTypedWhenLetGo_AndLeaveNothingWhenLetGoBeforeMade', async () => {
  const typed = editorOver('# Plan');
  await mounting();
  typed.type('# Plan\n- one');
  typed.editor.dispose();
  const early = editorOver('# Ideas');
  early.editor.dispose();
  await mounting();

  assert.deepEqual({ saved: typed.saved, left: early.editor.element.children.length }, { saved: ['# Plan\n- one'], left: 0 });
});

// The editor chosen in the settings changed, the note's editor is made anew — the one chosen now — with the text as it
// stands, what was typed saved first, shown as it was: as it reads, or as its source
test('noteEditor_Should_RemakeEditor_WithTextAsItStands', async () => {
  const { editor, saved, mounted, type } = editorOver('# Plan');
  await mounting();

  type('# Plan\n- one');
  editor.remake();
  await mounting();

  assert.deepEqual({ mounted, saved, now: editor.shown() }, { mounted: ['preview: # Plan', 'preview: # Plan\n- one'], saved: ['# Plan\n- one'], now: 'preview' });
});
