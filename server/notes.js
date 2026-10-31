// @ts-check
// The notes of every project folder, in one file on this computer: every device — and every session in the folder —
// sees the same ones. Kept as the per-session lists are, under the folder's name (model/notes.js: notesFolderOf). Each
// change is a step of the folder's history, in a file of its own (model/notes-history.js), so that it can be undone.
import { randomUUID } from 'node:crypto';
import { changeNotes, parseNotes } from '../public/model/notes.js';
import { parseSteps, recordStep, stepOf } from '../public/model/notes-history.js';
import { createSessionListFile } from './session-lists.js';

/**
 * @typedef {import('../public/model/notes.js').Note} Note
 * @typedef {import('../public/model/notes.js').NoteChange} NoteChange
 * @typedef {import('../public/model/notes-history.js').NoteStep} NoteStep
 * @typedef {import('./session-lists.js').SessionLists<Note, NoteChange> & { history: (folder: string) => Promise<readonly NoteStep[]> }} Notes
 *   — history: the folder's steps, the latest first
 */

/**
 * @param {string} file
 * @param {{ history: string, limit: number }} kept — history: the file of the steps; limit: how many a folder keeps
 * @returns {Notes}
 */
export function createNotesFile(file, { history, limit }) {
  const notes = createSessionListFile({ file, what: 'notes', parse: parseNotes, apply: changeNotes });
  /** @type {import('./session-lists.js').SessionLists<NoteStep, NoteStep>} */
  const steps = createSessionListFile({ file: history, what: 'notes history', parse: parseSteps, apply: (kept, step) => recordStep(kept, step, limit) });
  // A change and its step, one after another: each step starts from the notes the one before it left.
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();
  return {
    list: notes.list,
    history: steps.list,
    change(folder, change) {
      const changed = queue.then(async () => {
        const before = await notes.list(folder);
        const after = await notes.change(folder, change);
        const step = stepOf(before, after, change, { id: randomUUID(), at: new Date().toISOString() });
        if (step !== undefined) await steps.change(folder, step);
        return after;
      });
      queue = changed.catch(() => undefined);
      return changed;
    },
  };
}
