// @ts-check
// The notes of a session's project folder, kept by the viewer's server (~/.claude-code-webview/notes.json): every device,
// and every session in the folder, sees the same ones. A change shows at once; the server's reply then replaces the
// list. Coming back to the window reloads it, so a note written elsewhere appears. A reply asked for before the latest
// change — the list reloaded, an earlier change's — comes without it and is dropped: the latest change's reply is the one.
// The folder's history of changes is read from the server too; a step of it undone is a change as any other.
import { changeNotes, parseNotes } from '../model/notes.js';
import { parseSteps, undoStep } from '../model/notes-history.js';

/**
 * @typedef {import('../model/notes.js').Note} Note
 * @typedef {import('../model/notes.js').NoteChange} NoteChange
 * @typedef {import('../model/notes-history.js').NoteStep} NoteStep
 */

/**
 * @param {string} sessionId — one of the folder's sessions: the server knows its folder
 * @param {(notes: readonly Note[]) => void} onChange — the notes as they stand, each time they change
 */
export function createNotesStore(sessionId, onChange) {
  /** @type {readonly Note[]} */
  let notes = [];
  /** @param {readonly Note[]} next */
  const show = (next) => {
    notes = next;
    onChange(next);
  };
  /** The changes made: a reply asked for before the latest one — the list, an earlier change's — would take it away. */
  let changes = 0;
  const load = async () => {
    const asked = changes;
    const response = await fetch(`/api/notes?session=${sessionId}`).catch(() => undefined);
    if (response?.ok && asked === changes) show(parseNotes(await response.json()));
  };
  /** @param {NoteChange} change */
  const change = (change) => {
    const made = ++changes;
    show(changeNotes(notes, change));
    void sendChange(sessionId, change).then((saved) => {
      if (made !== changes) return;
      if (saved === undefined) void load();
      else show(saved);
    });
  };
  const reload = () => void load();
  window.addEventListener('focus', reload);
  reload();
  return {
    /**
     * A note written, shown the way asked from the start: its id, to open it by.
     * @param {string} text @param {import('../model/notes.js').NoteShown} shown
     * @returns {string}
     */
    add(text, shown) {
      const at = new Date();
      // the time and a random tail: crypto.randomUUID is only there on https and on the viewer's own computer
      const id = `${at.getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      change({ action: 'add', note: { id, text, at: at.toISOString(), shown } });
      return id;
    },
    /** @param {string} id @param {string} text */
    edit(id, text) {
      change({ action: 'edit', id, text });
    },
    /** @param {string} id */
    remove(id) {
      change({ action: 'remove', id });
    },
    /** A note set apart — listed by its name — or back inline. @param {string} id @param {import('../model/notes.js').NoteShown} shown */
    setShown(id, shown) {
      change({ action: 'show', id, shown });
    },
    /** A step of the history undone: its note as it was before it. @param {NoteStep} step */
    undo(step) {
      change(undoStep(step));
    },
    /** @returns {Promise<readonly NoteStep[] | undefined>} — the folder's changes, the latest first; none if the server did not answer */
    async history() {
      const response = await fetch(`/api/notes/history?session=${sessionId}`).catch(() => undefined);
      return response?.ok ? parseSteps(await response.json()) : undefined;
    },
    dispose() {
      window.removeEventListener('focus', reload);
    },
  };
}

/**
 * @param {string} sessionId
 * @param {NoteChange} change
 * @returns {Promise<readonly Note[] | undefined>} — the folder's notes as the server keeps them now; none if it did not
 *   answer, or knows no folder for the session
 */
async function sendChange(sessionId, change) {
  const response = await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Viewer': '1' },
    body: JSON.stringify({ session: sessionId, change }),
  }).catch(() => undefined);
  return response?.ok ? parseNotes(await response.json()) : undefined;
}
