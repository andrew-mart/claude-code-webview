// @ts-check
// The notes of a session's project folder, kept by the viewer's server (~/.claude-code-webview/notes.json): every device,
// and every session in the folder, sees the same ones. A change shows at once; the server's reply then replaces the
// list. Coming back to the window reloads it, so a note written elsewhere appears.
import { changeNotes, parseNotes } from '../model/notes.js';

/**
 * @typedef {import('../model/notes.js').Note} Note
 * @typedef {import('../model/notes.js').NoteChange} NoteChange
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
  const load = async () => {
    const response = await fetch(`/api/notes?session=${sessionId}`).catch(() => undefined);
    if (response?.ok) show(parseNotes(await response.json()));
  };
  /** @param {NoteChange} change */
  const change = (change) => {
    show(changeNotes(notes, change));
    void sendChange(sessionId, change).then((saved) => (saved === undefined ? load() : show(saved)));
  };
  const reload = () => void load();
  window.addEventListener('focus', reload);
  reload();
  return {
    /** @param {string} text */
    add(text) {
      const at = new Date();
      // the time and a random tail: crypto.randomUUID is only there on https and on the viewer's own computer
      change({ action: 'add', note: { id: `${at.getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, text, at: at.toISOString() } });
    },
    /** @param {string} id @param {string} text */
    edit(id, text) {
      change({ action: 'edit', id, text });
    },
    /** @param {string} id */
    remove(id) {
      change({ action: 'remove', id });
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
