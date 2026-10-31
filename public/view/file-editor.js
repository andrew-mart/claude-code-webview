// @ts-check
// The file panel's editor: a file's text to change and save over the file, from the viewer's page. The text comes with
// the file's version, a save carries it, and the viewer saves only over the file as it was read: a file written
// meanwhile — by the session, by another editor — comes back as it is now, to take it or to save over it. Changes left
// unsaved when the panel shows something else are kept, and come back when the file is edited again. The name at the
// cursor is looked for in the project: its definition, or its uses.
import { isRecord, text } from '../model/narrow.js';
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @typedef {import('./file-links.js').FileTarget} FileTarget
 * @typedef {{ tools: 'code' | 'prose', text: () => string, replace: (text: string) => void, wordAtCursor: () => string | undefined, search: () => void, undo: () => void, redo: () => void, focus: () => void, dispose: () => void }} CodeEditor
 *   — tools: code's — finding and replacing, a name's definition and uses — or prose's, a markdown file in the notes'
 *   editor, which has none of them; wordAtCursor: the selection, or the word the cursor is in
 * @typedef {(intent: 'definition' | 'uses', name: string, path: string) => void} OnName — a name looked for in the project
 * @typedef {{ text: string, path: string, line: number | undefined, onChange: () => void, onSave: () => void }} EditorOptions
 *   — onSave: the editor's own key for it, Ctrl+S
 * @typedef {(host: HTMLElement, options: EditorOptions) => Promise<CodeEditor>} MakeEditor
 * @typedef {(url: string, init?: RequestInit) => Promise<Response>} FetchFile
 * @typedef {{ path: string, editor: CodeEditor, version: string, saved: string }} Editing — version: the file's as the
 *   text was read or last saved; saved: the text the file holds at that version
 * @typedef {{ text: string, version: string, saved: string }} Draft — changes left unsaved, over the version they were made on
 */

/** Why a file did not open for editing. */
/** @type {Readonly<Record<string, string>>} */
const openRefusals = {
  'not-found': 'File not found: it was deleted, renamed, or the path is not exact.',
  'too-large': 'The file is larger than 2 MB and is not edited here.',
  binary: 'This is not a text file.',
  'not-a-file': 'This is a folder, not a file.',
  'not-absolute': 'The path is not absolute — it is unclear which folder it is relative to.',
};

/** Why a save did not happen. */
/** @type {Readonly<Record<string, string>>} */
const saveRefusals = {
  'not-utf8': 'Not saved: the file is not in UTF-8, and saving would change its letters.',
  'read-only': 'Not saved: the viewer may not write this file.',
  'too-large': 'Not saved: the text is larger than 2 MB.',
  'not-found': 'Not saved: the file is gone — deleted or renamed.',
};

/**
 * @param {{ fetchFile: FetchFile, makeEditor: MakeEditor, onName: OnName }} deps — makeEditor: CodeMirror in the page, a
 *   stand-in in tests; onName: the name at the cursor looked for in the project
 * @returns {{ element: HTMLElement, open: (target: FileTarget) => Promise<void>, leave: () => void, changed: () => boolean }}
 */
export function createFileEditor({ fetchFile, makeEditor, onName }) {
  const save = h('button', { className: 'code-edit-save', text: 'Save', title: 'Save (Ctrl+S)', attrs: { type: 'button' } });
  const undo = barButton('undo', 'Undo');
  const redo = barButton('redo', 'Redo');
  const find = barButton('search', 'Find and replace (Ctrl+F)');
  const definition = barButton('definition', 'Go to definition');
  const uses = barButton('uses', 'Find uses');
  const status = h('span', { className: 'code-edit-status', attrs: { role: 'status' } });
  const note = h('div', { className: 'code-edit-note' });
  note.hidden = true;
  const host = h('div', { className: 'code-edit-host' });
  const element = h('div', { className: 'code-edit' }, [h('div', { className: 'code-edit-bar' }, [save, undo, redo, find, definition, uses, status]), note, host]);
  /** @type {Editing | undefined} */
  let editing;
  /** The opens begun, and left: one overtaken by a later — or by leaving — shows nothing once its file is read. */
  let opens = 0;
  /** @type {Map<string, Draft>} */
  const drafts = new Map();

  const changed = () => editing !== undefined && editing.editor.text() !== editing.saved;
  const showChanged = () => {
    save.disabled = !changed();
    if (changed()) status.textContent = 'Unsaved changes';
  };
  /**
   * @param {string} message
   * @param {readonly HTMLButtonElement[]} [actions]
   */
  const say = (message, actions = []) => {
    note.replaceChildren(h('span', { text: message }), ...actions);
    note.hidden = false;
  };
  const hush = () => {
    note.replaceChildren();
    note.hidden = true;
  };

  const leave = () => {
    opens++;
    if (editing === undefined) return;
    if (changed()) drafts.set(editing.path, { text: editing.editor.text(), version: editing.version, saved: editing.saved });
    editing.editor.dispose();
    editing = undefined;
    host.replaceChildren();
    hush();
  };

  /** @param {FileTarget} target */
  const open = async (target) => {
    leave();
    const turn = opens;
    status.textContent = 'Opening…';
    save.disabled = true;
    const read = await readFile(fetchFile, target.path);
    if (turn !== opens) return;
    if (!read.ok) {
      status.textContent = '';
      say(read.message);
      return;
    }
    const draft = drafts.get(target.path);
    drafts.delete(target.path);
    const editor = await makeEditor(host, { text: draft?.text ?? read.content, path: target.path, line: target.line, onChange: showChanged, onSave: () => void saveNow() });
    if (turn !== opens) {
      // overtaken while the editor was made: its text goes back to the drafts, as leaving would keep it
      if (draft !== undefined) drafts.set(target.path, draft);
      editor.dispose();
      return;
    }
    // the file unchanged is its text as the editor writes it: Milkdown writes markdown its own way, and a file only
    // opened in it is not to be saved
    editing = { path: target.path, editor, version: draft?.version ?? read.version, saved: draft?.saved ?? editor.text() };
    for (const button of [find, definition, uses]) button.hidden = editor.tools === 'prose';
    status.textContent = '';
    showChanged();
  };

  const saveNow = async () => {
    const at = editing;
    if (at === undefined || !changed()) return;
    const content = at.editor.text();
    status.textContent = 'Saving…';
    save.disabled = true;
    const reply = await writeFile(fetchFile, { path: at.path, content, version: at.version });
    if (editing !== at) return;
    if (reply.ok) {
      at.version = reply.version;
      at.saved = content;
      hush();
      status.textContent = 'Saved';
      showChanged();
      return;
    }
    status.textContent = 'Not saved';
    showChanged();
    if (reply.changed === undefined) {
      say(reply.message);
      return;
    }
    const theirs = reply.changed;
    const take = h('button', { className: 'code-edit-choice', text: 'Take the file’s', attrs: { type: 'button' } });
    const keep = h('button', { className: 'code-edit-choice', text: 'Keep mine', title: 'The next save writes this text over the file', attrs: { type: 'button' } });
    take.addEventListener('click', () => {
      at.version = theirs.version;
      at.saved = theirs.content;
      at.editor.replace(theirs.content);
      hush();
      status.textContent = '';
      showChanged();
    });
    keep.addEventListener('click', () => {
      at.version = theirs.version;
      hush();
      showChanged();
    });
    say('The file changed since it was opened.', [take, keep]);
  };

  save.addEventListener('click', () => void saveNow());
  undo.addEventListener('click', () => editing?.editor.undo());
  redo.addEventListener('click', () => editing?.editor.redo());
  find.addEventListener('click', () => editing?.editor.search());
  /** @param {'definition' | 'uses'} intent */
  const lookFor = (intent) => {
    if (editing === undefined) return;
    const name = editing.editor.wordAtCursor();
    if (name === undefined) {
      say('Put the cursor on a name first.');
      return;
    }
    hush();
    onName(intent, name, editing.path);
  };
  definition.addEventListener('click', () => lookFor('definition'));
  uses.addEventListener('click', () => lookFor('uses'));
  return { element, open, leave, changed };
}

/**
 * The file's text and version, or why it is not there.
 * @param {FetchFile} fetchFile
 * @param {string} path
 * @returns {Promise<{ ok: true, content: string, version: string } | { ok: false, message: string }>}
 */
async function readFile(fetchFile, path) {
  const json = await fetchFile(`/api/file?path=${encodeURIComponent(path)}`).then(
    (response) => response.json(),
    () => undefined,
  );
  const content = isRecord(json) && json.ok === true ? text(json.content) : undefined;
  const version = isRecord(json) ? text(json.version) : undefined;
  if (content !== undefined && version !== undefined) return { ok: true, content, version };
  const reason = isRecord(json) ? text(json.error) : undefined;
  return { ok: false, message: (reason === undefined ? undefined : openRefusals[reason]) ?? 'Could not get the file from the viewer.' };
}

/**
 * @param {FetchFile} fetchFile
 * @param {{ path: string, content: string, version: string }} save
 * @returns {Promise<{ ok: true, version: string } | { ok: false, message: string, changed: { content: string, version: string } | undefined }>}
 *   — changed: what the file holds now, when it was written since it was read
 */
async function writeFile(fetchFile, save) {
  const json = await fetchFile('/api/file/save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Viewer': '1' }, body: JSON.stringify(save) }).then(
    (response) => response.json(),
    () => undefined,
  );
  const version = isRecord(json) && json.ok === true ? text(json.version) : undefined;
  if (version !== undefined) return { ok: true, version };
  const reason = isRecord(json) ? text(json.error) : undefined;
  const content = isRecord(json) && reason === 'changed' ? text(json.content) : undefined;
  const now = isRecord(json) ? text(json.version) : undefined;
  return {
    ok: false,
    message: (reason === undefined ? undefined : saveRefusals[reason]) ?? 'Not saved: the viewer did not answer.',
    changed: content === undefined || now === undefined ? undefined : { content, version: now },
  };
}

/**
 * @param {string} iconName
 * @param {string} title
 * @returns {HTMLButtonElement}
 */
function barButton(iconName, title) {
  return h('button', { className: 'icon-button', title, attrs: { type: 'button', 'aria-label': title } }, [icon(iconName)]);
}
