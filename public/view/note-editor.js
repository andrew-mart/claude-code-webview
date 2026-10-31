// @ts-check
// A note's editor, whichever does the editing (note-editor-cm.js): its markdown shown as it reads — or as its source,
// the fallback — always there to be typed in. What is typed is saved a second after the typing stops, and at once when
// the note is left or let go of. The note coming again — changed on another device — shows its text unless it is being
// typed in: what is typed is not taken away. Shown the other way — or another editor chosen — the editor is made anew
// with the text as it stands.
import { h } from './dom.js';
import { renderMarkdown } from './markdown.js';

/**
 * @typedef {'preview' | 'source'} NoteShownAs — preview: as it reads, its marks giving way where the cursor is; source:
 *   its markdown as typed
 * @typedef {{ path: string, line: number | undefined } | { href: string }} OpenTarget — a file's path in the note, or a
 *   link's address
 * @typedef {{ text: string, shown: NoteShownAs, placeholder: string, onChange: (text: string) => void, onBlur: () => void, onOpen: (target: OpenTarget) => void }} MountOptions
 * @typedef {{ text: () => string, replace: (text: string) => void, focus: () => void, hasFocus: () => boolean, destroy: () => void }} MountedEditor
 * @typedef {(host: HTMLElement, options: MountOptions) => Promise<MountedEditor>} MountEditor — the editor itself, made
 *   in host
 * @typedef {{ element: HTMLElement, show: (text: string) => void, focus: () => void, shown: () => NoteShownAs, setShown: (shown: NoteShownAs) => void, remake: () => void, dispose: () => void }} NoteEditor
 *   — show: the note's text as it came again; remake: the editor made anew — another one chosen in the settings;
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
  };
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
    show(next) {
      if (mounted?.hasFocus() === true || latest !== saved || next === latest) return;
      latest = next;
      saved = next;
      mounted?.replace(next);
    },
    focus() {
      if (mounted === undefined) wantsFocus = true;
      else mounted.focus();
    },
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
