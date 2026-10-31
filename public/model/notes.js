// @ts-check
// Notes of a project folder, written in markdown beside its sessions: every session in the folder — Claude Code's or
// Codex's — shows the same ones, the latest written first.
import { isRecord, text } from './narrow.js';

/**
 * @typedef {'inline' | 'panel'} NoteShown — in full in the outline, or listed there by its name, opening in the side panel
 * @typedef {{ id: string, text: string, at: string, shown: NoteShown, name?: string }} Note — text: markdown; at: when it
 *   was written; name: given by hand, to list it by instead of its first line
 * @typedef {{ action: 'add', note: Note } | { action: 'edit', id: string, text: string, name?: string } | { action: 'remove', id: string } | { action: 'show', id: string, shown: NoteShown } | { action: 'put', note: Note } | { action: 'move', id: string, before?: string }} NoteChange
 *   — edit: name — the note's name now, a blank one none; no name, the name as it was; put: a note as it was, back in
 *   its place or over what it became; move: a note put before another — with none, last
 */

/**
 * Notes from stored JSON — the server's file, its reply: entries of any other shape are dropped — a note with no words
 * is one, written to be filled in; a note kept before notes could be set apart, or with a way not known, is shown inline.
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
    return id === undefined || words === undefined || at === undefined ? [] : [withName({ id, text: words, at, shown }, text(item.name))];
  });
}

/**
 * The change is stated explicitly: when two devices send the same one, the second keeps the result. The notes stand in
 * the order they are put in: a note written comes first, a note moved goes before the one it is let go before — with
 * none, or one gone meanwhile, last — and the others stay where they stand; an edit keeps when it was written; a note an
 * edit leaves without words stays, empty — only its removal takes it away; a note set apart or back inline keeps its place; a change of a note removed
 * meanwhile changes nothing; a note put back as it was takes its place — if gone, before the first note written before it.
 * @param {readonly Note[]} list
 * @param {NoteChange} change
 * @returns {readonly Note[]}
 */
export function changeNotes(list, change) {
  switch (change.action) {
    case 'add':
      if (list.some((note) => note.id === change.note.id)) return list;
      return [change.note, ...list];
    case 'edit':
      return list.map((note) => (note.id === change.id ? withName({ ...note, text: change.text }, change.name ?? note.name) : note));
    case 'remove':
      return list.filter((note) => note.id !== change.id);
    case 'show':
      return list.map((note) => (note.id === change.id ? { ...note, shown: change.shown } : note));
    case 'put':
      if (list.some((note) => note.id === change.note.id)) return list.map((note) => (note.id === change.note.id ? change.note : note));
      return placedBefore(list, change.note, list.find((note) => note.at.localeCompare(change.note.at) < 0)?.id);
    case 'move': {
      const note = list.find((one) => one.id === change.id);
      if (note === undefined || change.before === change.id) return list;
      return placedBefore(list.filter((one) => one !== note), note, change.before);
    }
    default:
      return exhaustive(change);
  }
}

/**
 * The note put among the others before the one named — with none, or one not there, last — the others staying as they
 * stand.
 * @param {readonly Note[]} list — without the note
 * @param {Note} note
 * @param {string | undefined} before — the id of the note it goes before
 * @returns {readonly Note[]}
 */
function placedBefore(list, note, before) {
  const at = list.findIndex((one) => one.id === before);
  return at === -1 ? [...list, note] : [...list.slice(0, at), note, ...list.slice(at)];
}

/**
 * A change sent by the page; anything of another shape — undefined.
 * @param {unknown} value — from the request's JSON
 * @returns {NoteChange | undefined}
 */
export function parseNoteChange(value) {
  if (!isRecord(value)) return undefined;
  if (value.action === 'remove' && typeof value.id === 'string') return { action: 'remove', id: value.id };
  if (value.action === 'edit' && typeof value.id === 'string' && typeof value.text === 'string') {
    return { action: 'edit', id: value.id, text: value.text, ...(typeof value.name === 'string' ? { name: value.name } : {}) };
  }
  if (value.action === 'show' && typeof value.id === 'string' && (value.shown === 'inline' || value.shown === 'panel')) return { action: 'show', id: value.id, shown: value.shown };
  if (value.action === 'move' && typeof value.id === 'string') return { action: 'move', id: value.id, ...(typeof value.before === 'string' ? { before: value.before } : {}) };
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
 * What a note is listed by: the name given it by hand, else its first line with words (noteTitle).
 * @param {Note} note
 * @returns {string}
 */
export function noteName(note) {
  return note.name ?? noteTitle(note.text);
}

/**
 * The note under a name — its words, without the spaces around them — or under none, a blank name being none.
 * @param {Note} note
 * @param {string | undefined} name
 * @returns {Note}
 */
export function withName({ name: _was, ...note }, name) {
  const words = name?.trim() ?? '';
  return words === '' ? note : { ...note, name: words };
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
