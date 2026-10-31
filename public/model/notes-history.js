// @ts-check
// The history of a project folder's notes: each change a step — the note as it was before it and as it became — kept
// the latest first, so that any step can be undone: the note put back as it was, itself a step of its own.
import { isRecord, text } from './narrow.js';
import { parseNotes } from './notes.js';

/**
 * @typedef {import('./notes.js').Note} Note
 * @typedef {import('./notes.js').NoteChange} NoteChange
 * @typedef {{ id: string, at: string, action: NoteChange['action'] } & ({ before: Note, after: Note | undefined } | { before: undefined, after: Note })} NoteStep
 *   — at: when it was made; action: the change; before, after: the note as it was and as it became — none before it
 *   was added, none after it was removed
 */

/**
 * The step a change made: its note before and after it; none when the change changed nothing.
 * @param {readonly Note[]} before — the notes before the change
 * @param {readonly Note[]} after — the notes it left
 * @param {NoteChange} change
 * @param {{ id: string, at: string }} stamp — the step's id, and when it was made
 * @returns {NoteStep | undefined}
 */
export function stepOf(before, after, change, stamp) {
  const noteId = change.action === 'add' || change.action === 'put' ? change.note.id : change.id;
  const was = before.find((note) => note.id === noteId);
  const now = after.find((note) => note.id === noteId);
  if (sameNote(was, now)) return undefined;
  if (was !== undefined) return { ...stamp, action: change.action, before: was, after: now };
  return now === undefined ? undefined : { ...stamp, action: change.action, before: undefined, after: now };
}

/**
 * The change that undoes a step: a note it added removed, any other put back as it was before it.
 * @param {NoteStep} step
 * @returns {NoteChange}
 */
export function undoStep(step) {
  return step.before === undefined ? { action: 'remove', id: step.after.id } : { action: 'put', note: step.before };
}

/**
 * @param {readonly NoteStep[]} steps — the latest first
 * @param {NoteStep} step — a new one
 * @param {number} limit — how many are kept
 * @returns {readonly NoteStep[]}
 */
export function recordStep(steps, step, limit) {
  return [step, ...steps].slice(0, limit);
}

/**
 * Steps from stored JSON — the server's file, its reply: a step of any other shape is dropped.
 * @param {unknown} stored — result of JSON.parse
 * @returns {readonly NoteStep[]}
 */
export function parseSteps(stored) {
  if (!Array.isArray(stored)) return [];
  return stored.filter(isRecord).flatMap((item) => {
    const step = stepFrom(item);
    return step === undefined ? [] : [step];
  });
}

/**
 * @param {Record<string, unknown>} item
 * @returns {NoteStep | undefined}
 */
function stepFrom(item) {
  const id = text(item.id);
  const at = text(item.at);
  const action = actionOf(item.action);
  const [before] = parseNotes([item.before]);
  const [after] = parseNotes([item.after]);
  if (id === undefined || at === undefined || action === undefined) return undefined;
  if (before !== undefined) return { id, at, action, before, after };
  return after === undefined ? undefined : { id, at, action, before: undefined, after };
}

/**
 * @param {unknown} value
 * @returns {NoteChange['action'] | undefined}
 */
function actionOf(value) {
  return value === 'add' || value === 'edit' || value === 'remove' || value === 'show' || value === 'put' ? value : undefined;
}

/**
 * @param {Note | undefined} one
 * @param {Note | undefined} other
 */
function sameNote(one, other) {
  if (one === undefined || other === undefined) return one === other;
  return one.text === other.text && one.at === other.at && one.shown === other.shown;
}
