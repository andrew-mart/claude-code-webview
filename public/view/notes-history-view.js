// @ts-check
// The history of a project folder's notes in the side panel, the latest change first: what was done to which note —
// named by its first line — and when, the text it had before there to open; ↶ undoes a change, putting its note back as
// it was before it — itself a change, there to be undone in turn.
import { h } from './dom.js';
import { icon } from './icons.js';
import { renderMarkdown } from './markdown.js';
import { noteName } from '../model/notes.js';

/**
 * @typedef {import('../model/notes-history.js').NoteStep} NoteStep
 */

/**
 * @param {{ steps: () => Promise<readonly NoteStep[] | undefined>, undo: (step: NoteStep) => void }} source — steps:
 *   the folder's changes, the latest first, none when the viewer did not answer; undo: a change undone
 * @returns {{ element: HTMLElement, reload: () => Promise<void>, summary: () => string | undefined }} — the
 *   side panel's list in place of a file (file-panel.js: ShownList)
 */
export function createNotesHistoryPanel({ steps, undo }) {
  const element = h('div', { className: 'notes-steps' });

  /**
   * @param {NoteStep} step
   * @returns {HTMLElement}
   */
  const stepRow = (step) => {
    // named as it became — a note removed, as it was; its text as it was — a note added, as it came
    const [named, shown] = step.before === undefined ? [step.after, step.after] : [step.after ?? step.before, step.before];
    const name = noteName(named);
    const undoing = h('button', { className: 'icon-button notes-step-undo', title: 'Undo it: the note as it was before', attrs: { type: 'button', 'aria-label': 'Undo it' } }, [icon('undo')]);
    undoing.addEventListener('click', () => undo(step));
    const text = h('details', { className: 'notes-step-text' }, [h('summary', { text: step.before === undefined ? 'The note' : 'Before' }), h('div', { className: 'md' }, [renderMarkdown(shown.text)])]);
    const head = h('div', { className: 'notes-step-head' }, [
      h('span', { className: 'notes-step-what', text: whatOf(step) }),
      h('span', { className: 'notes-step-name', text: name === '' ? 'Untitled' : name }),
      h('time', { className: 'notes-step-when', text: new Date(step.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }), attrs: { datetime: step.at } }),
      undoing,
    ]);
    return h('div', { className: 'notes-step' }, [head, text]);
  };

  return {
    element,
    async reload() {
      const now = await steps();
      if (now === undefined) element.replaceChildren(h('div', { className: 'outline-empty', text: 'Could not get the history from the viewer.' }));
      else if (now.length === 0) element.replaceChildren(h('div', { className: 'outline-empty', text: 'No changes of the notes yet.' }));
      else element.replaceChildren(...now.map(stepRow));
    },
    summary: () => 'The latest first — ↶ undoes a change',
  };
}

/**
 * What a change did to its note, as said in the history.
 * @param {NoteStep} step
 * @returns {string}
 */
function whatOf(step) {
  switch (step.action) {
    case 'add':
      return 'Added';
    case 'edit':
      return 'Edited';
    case 'remove':
      return 'Removed';
    case 'show':
      return step.after?.shown === 'panel' ? 'Set apart' : 'Back inline';
    case 'put':
      return 'Put back';
    // a note moved is the same note: no step is made of it (notes-history.js: stepOf)
    case 'move':
      return 'Moved';
    default:
      return exhaustive(step.action);
  }
}

/**
 * @param {never} value
 * @returns {never}
 */
function exhaustive(value) {
  throw new Error(`Unexpected change in the notes history: ${JSON.stringify(value)}`);
}
