// @ts-check
// The notes of every project folder, in one file on this computer: every device — and every session in the folder —
// sees the same ones. Kept as the per-session lists are, under the folder's name (model/notes.js: notesFolderOf).
import { changeNotes, parseNotes } from '../public/model/notes.js';
import { createSessionListFile } from './session-lists.js';

/**
 * @typedef {import('../public/model/notes.js').Note} Note
 * @typedef {import('../public/model/notes.js').NoteChange} NoteChange
 * @typedef {import('./session-lists.js').SessionLists<Note, NoteChange>} Notes
 */

/**
 * @param {string} file
 * @returns {Notes}
 */
export function createNotesFile(file) {
  return createSessionListFile({ file, what: 'notes', parse: parseNotes, apply: changeNotes });
}
