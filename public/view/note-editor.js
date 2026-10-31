// @ts-check
// A note's editor, whichever does the editing (note-editor-cm.js): its markdown shown as it reads — or as its source,
// the fallback — always there to be typed in. What is typed is saved a second after the typing stops, and at once when
// the note is left or let go of. The note coming again — changed on another device — shows its text unless it is being
// typed in: what is typed is not taken away. Shown the other way — or another editor chosen — the editor is made anew
// with the text as it stands. Its ↶ and ↷ — wherever the note's buttons are — undo what was typed and do it again, as
// Ctrl+Z and Ctrl+Shift+Z do.
import { h } from './dom.js';
import { icon } from './icons.js';
import { renderMarkdown } from './markdown.js';

/**
 * @typedef {'preview' | 'source'} NoteShownAs — preview: as it reads, its marks giving way where the cursor is; source:
 *   its markdown as typed
 * @typedef {{ path: string, line: number | undefined } | { href: string }} OpenTarget — a file's path in the note, or a
 *   link's address
 * @typedef {{ text: string, shown: NoteShownAs, placeholder: string, onChange: (text: string) => void, onBlur: () => void, onOpen: (target: OpenTarget) => void }} MountOptions
 * @typedef {{ text: () => string, replace: (text: string) => void, focus: () => void, hasFocus: () => boolean, undo: () => void, redo: () => void, canUndo: () => boolean, canRedo: () => boolean, destroy: () => void }} MountedEditor
 *   — undo, redo: what was typed undone, done again; canUndo, canRedo: whether there is something to
 * @typedef {(host: HTMLElement, options: MountOptions) => Promise<MountedEditor>} MountEditor — the editor itself, made
 *   in host
 * @typedef {{ element: HTMLElement, buttons: { undo: HTMLButtonElement, redo: HTMLButtonElement }, text: () => string, show: (text: string) => void, focus: () => void, shown: () => NoteShownAs, setShown: (shown: NoteShownAs) => void, remake: () => void, dispose: () => void }} NoteEditor
 *   — buttons: ↶ and ↷, for where the note's buttons are; show: the note's text as it came again; remake: the editor made anew — another one chosen in the settings;
 *   dispose: let go of, what was typed saved
 */

/** How long after the last key what is typed is saved. */
const saveAfter = 1000;

/**
 * @param {{ text: string, shown: NoteShownAs, placeholder: string, save: (text: string) => void, onOpen: (target: OpenTarget) => void, mount: MountEditor }} source
 *   — save: what is typed, as it stands; onOpen: a link Ctrl+clicked
 * @returns {NoteEditor}
 */
export function createNoteEditor({ text, shown, placeholder, save, onOpen, mount }) {
  // what the note says while the editor is being made: as it reads, not to jump when the editor comes
  const element = h('div', { className: 'note-editor' }, [h('div', { className: 'md note-editor-waiting' }, [renderMarkdown(text)])]);
  /** The text as typed, and as last saved: they differ while a save waits. */
  let latest = text;
  let saved = text;
  let shownAs = shown;
  /** @type {MountedEditor | undefined} */
  let mounted;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let waiting;
  let wantsFocus = false;
  let disposed = false;
  /** Each making of the editor after the one before it: shown the other way while it is made, it is made after. */
  /** @type {Promise<void>} */
  let made = Promise.resolve();
  const undo = h('button', { className: 'icon-button note-undo', title: 'Undo — Ctrl+Z', attrs: { type: 'button', 'aria-label': 'Undo' } }, [icon('undo')]);
  const redo = h('button', { className: 'icon-button note-redo', title: 'Redo — Ctrl+Shift+Z', attrs: { type: 'button', 'aria-label': 'Redo' } }, [icon('redo')]);
  /** ↶ and ↷ there to press only while there is something to undo, or to do again. */
  const showPressable = () => {
    undo.disabled = mounted === undefined || !mounted.canUndo();
    redo.disabled = mounted === undefined || !mounted.canRedo();
  };
  showPressable();

  const flush = () => {
    clearTimeout(waiting);
    waiting = undefined;
    if (latest === saved) return;
    saved = latest;
    save(latest);
  };
  /** @param {string} next */
  const changed = (next) => {
    latest = next;
    clearTimeout(waiting);
    waiting = setTimeout(flush, saveAfter);
    showPressable();
  };
  /**
   * What was typed undone, or done again, and what the note then says saved as what is typed is: the editor may not tell
   * of it — Milkdown does not, of a note not being typed in.
   * @param {(editor: MountedEditor) => void} step
   */
  const press = (step) => () => {
    if (mounted === undefined) return;
    step(mounted);
    changed(mounted.text());
  };
  undo.addEventListener('click', press((editor) => editor.undo()));
  redo.addEventListener('click', press((editor) => editor.redo()));
  // pressed, they take no focus: the cursor stays where it was in the note, on a phone the keyboard stays up
  for (const button of [undo, redo]) button.addEventListener('mousedown', (event) => event.preventDefault());
  const makeEditor = () => {
    made = made.then(async () => {
      if (disposed) return;
      const host = h('div', { className: `note-editor-host ${shownAs}` });
      const editor = await mount(host, { text: latest, shown: shownAs, placeholder, onChange: changed, onBlur: flush, onOpen });
      if (disposed) {
        editor.destroy();
        return;
      }
      mounted = editor;
      showPressable();
      element.replaceChildren(host);
      if (wantsFocus) editor.focus();
      wantsFocus = false;
    });
  };
  makeEditor();
  /** The editor made anew, what was typed saved first, the cursor kept in it if it was. */
  const remake = () => {
    flush();
    wantsFocus = mounted?.hasFocus() ?? wantsFocus;
    mounted?.destroy();
    mounted = undefined;
    makeEditor();
  };

  return {
    element,
    buttons: { undo, redo },
    show(next) {
      if (mounted?.hasFocus() === true || latest !== saved || next === latest) return;
      latest = next;
      saved = next;
      mounted?.replace(next);
      showPressable();
    },
    focus() {
      if (mounted === undefined) wantsFocus = true;
      else mounted.focus();
    },
    // the note as typed now, saved or not yet
    text: () => latest,
    shown: () => shownAs,
    setShown(next) {
      if (next === shownAs) return;
      shownAs = next;
      remake();
    },
    remake,
    dispose() {
      flush();
      disposed = true;
      mounted?.destroy();
      mounted = undefined;
      element.replaceChildren();
    },
  };
}
