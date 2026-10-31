// @ts-check
// Notes of a project folder, written in markdown beside its sessions: every session in the folder — Claude Code's or
// Codex's — shows the same ones, the latest written first.
import { isRecord, text } from './narrow.js';

/**
 * @typedef {{ id: string, text: string, at: string }} Note — text: markdown; at: when it was written
 * @typedef {{ action: 'add', note: Note } | { action: 'edit', id: string, text: string } | { action: 'remove', id: string }} NoteChange
 */

/**
 * Notes from stored JSON — the server's file, its reply: entries of any other shape, or with no words, are dropped.
 * @param {unknown} stored — result of JSON.parse
 * @returns {readonly Note[]}
 */
export function parseNotes(stored) {
  if (!Array.isArray(stored)) return [];
  return stored.filter(isRecord).flatMap((item) => {
    const id = text(item.id);
    const words = text(item.text);
    const at = text(item.at);
    return id === undefined || words === undefined || words.trim() === '' || at === undefined ? [] : [{ id, text: words, at }];
  });
}

/**
 * The change is stated explicitly: when two devices send the same one, the second keeps the result. The latest note
 * written comes first; an edit keeps when it was written; a note an edit leaves without words is gone; an edit or a
 * removal of a note removed meanwhile changes nothing.
 * @param {readonly Note[]} list
 * @param {NoteChange} change
 * @returns {readonly Note[]}
 */
export function changeNotes(list, change) {
  switch (change.action) {
    case 'add':
      if (list.some((note) => note.id === change.note.id)) return list;
      return [...list, change.note].sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
    case 'edit':
      if (change.text.trim() === '') return list.filter((note) => note.id !== change.id);
      return list.map((note) => (note.id === change.id ? { ...note, text: change.text } : note));
    case 'remove':
      return list.filter((note) => note.id !== change.id);
    default:
      return exhaustive(change);
  }
}

/**
 * A change sent by the page; anything of another shape — undefined.
 * @param {unknown} value — from the request's JSON
 * @returns {NoteChange | undefined}
 */
export function parseNoteChange(value) {
  if (!isRecord(value)) return undefined;
  if (value.action === 'remove' && typeof value.id === 'string') return { action: 'remove', id: value.id };
  if (value.action === 'edit' && typeof value.id === 'string' && typeof value.text === 'string') return { action: 'edit', id: value.id, text: value.text };
  const [note] = value.action === 'add' ? parseNotes([value.note]) : [];
  return note === undefined ? undefined : { action: 'add', note };
}

/**
 * The folder a session's notes are kept under: Claude Code's project — the folder it started in, as Claude Code names
 * it, the same after a cd — or, for Codex, the folder it runs in, named as Claude Code would: Claude Code and Codex in one
 * folder share their notes. None for a session with no folder known.
 * @param {{ agent: 'claude' | 'codex', project: string, cwd: string | undefined }} session
 * @returns {string | undefined}
 */
export function notesFolderOf(session) {
  if (session.agent === 'claude') return session.project;
  return session.cwd === undefined ? undefined : session.cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * @param {never} value
 * @returns {never}
 */
function exhaustive(value) {
  throw new Error(`Unexpected change of the notes ${JSON.stringify(value)}`);
}
