// @ts-check
// Notes of a project folder, written in markdown beside its sessions: every session in the folder — Claude Code's or
// Codex's — shows the same ones, the latest written first.
import { isRecord, text } from './narrow.js';

/**
 * @typedef {'inline' | 'panel'} NoteShown — in full in the outline, or listed there by its name, opening in the side panel
 * @typedef {{ id: string, text: string, at: string, shown: NoteShown }} Note — text: markdown; at: when it was written
 * @typedef {{ action: 'add', note: Note } | { action: 'edit', id: string, text: string } | { action: 'remove', id: string } | { action: 'show', id: string, shown: NoteShown } | { action: 'put', note: Note }} NoteChange
 *   — put: a note as it was, back in its place or over what it became
 */

/**
 * Notes from stored JSON — the server's file, its reply: entries of any other shape, or with no words, are dropped; a
 * note kept before notes could be set apart, or with a way not known, is shown inline.
 * @param {unknown} stored — result of JSON.parse
 * @returns {readonly Note[]}
 */
export function parseNotes(stored) {
  if (!Array.isArray(stored)) return [];
  return stored.filter(isRecord).flatMap((item) => {
    const id = text(item.id);
    const words = text(item.text);
    const at = text(item.at);
    /** @type {NoteShown} */
    const shown = item.shown === 'panel' ? 'panel' : 'inline';
    return id === undefined || words === undefined || words.trim() === '' || at === undefined ? [] : [{ id, text: words, at, shown }];
  });
}

/**
 * The change is stated explicitly: when two devices send the same one, the second keeps the result. The latest note
 * written comes first; an edit keeps when it was written; a note an edit leaves without words is gone; a note set apart
 * or back inline keeps its place; a change of a note removed meanwhile changes nothing; a note put back as it was takes
 * its place by when it was written.
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
    case 'show':
      return list.map((note) => (note.id === change.id ? { ...note, shown: change.shown } : note));
    case 'put':
      return changeNotes(
        list.filter((note) => note.id !== change.note.id),
        { action: 'add', note: change.note },
      );
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
  if (value.action === 'show' && typeof value.id === 'string' && (value.shown === 'inline' || value.shown === 'panel')) return { action: 'show', id: value.id, shown: value.shown };
  const [note] = value.action === 'add' || value.action === 'put' ? parseNotes([value.note]) : [];
  if (note === undefined) return undefined;
  return value.action === 'put' ? { action: 'put', note } : { action: 'add', note };
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

/**
 * A note's name, to list it by: its first line with words, as read — without markdown's marks: a heading's #, a list's
 * bullet or number, a quote's >, emphasis in pairs, code's ticks, a link's address. A word's own _ or * stays.
 * @param {string} text — the note's markdown
 * @returns {string}
 */
export function noteTitle(text) {
  for (const line of text.split(/\r?\n/)) {
    const read = line
      .replace(/^\s*(?:(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>)\s*)*/, '')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
      .replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, '$1')
      .replace(/(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    if (read !== '') return read;
  }
  return '';
}
