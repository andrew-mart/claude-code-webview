import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
// DOMPurify and the icons look for the DOM as their modules load: it is set up first
Object.assign(globalThis, { window, document: window.document, NodeFilter: window.NodeFilter, Text: window.Text });
const { createNotesHistoryPanel } = await import('../public/view/notes-history-view.js');

/** @typedef {import('../public/model/notes-history.js').NoteStep} NoteStep */

/** @type {import('../public/model/notes.js').Note} */
const plan = { id: 'n1', text: '# Plan\n- **check** the build', at: '2026-10-27T09:00:00.000Z', shown: 'inline' };
const at = '2026-10-27T10:00:00.000Z';
/** @type {readonly NoteStep[]} */
const steps = [
  { id: 's5', at, action: 'put', before: { ...plan, text: '# Plan v2' }, after: plan },
  { id: 's4', at, action: 'remove', before: plan, after: undefined },
  { id: 's3', at, action: 'show', before: plan, after: { ...plan, shown: 'panel', name: 'Week plan' } },
  { id: 's2', at, action: 'edit', before: { ...plan, text: '# Plan\n- the old step' }, after: plan },
  { id: 's1', at, action: 'add', before: undefined, after: plan },
];

/** The history in the side panel, its steps as given, those undone recorded. @param {() => Promise<readonly NoteStep[] | undefined>} read */
async function historyShown(read) {
  /** @type {string[]} */
  const undone = [];
  const panel = createNotesHistoryPanel({ steps: read, undo: (step) => void undone.push(step.id) });
  window.document.body.replaceChildren(panel.element);
  await panel.reload();
  return { panel, undone };
}

// The notes' changes, the latest first: what was done to which note — by its name: the one given it, else its first
// line — the text it had before
// there to look at; a step's button undoes it
test('notesHistoryPanel_Should_ListChangesLatestFirst_WithTextBefore_AndUndoOneOnPress', async () => {
  const { panel, undone } = await historyShown(async () => steps);

  const listed = [...panel.element.querySelectorAll('.notes-step')].map((row) => [row.querySelector('.notes-step-what')?.textContent, row.querySelector('.notes-step-name')?.textContent]);
  const edited = panel.element.querySelectorAll('.notes-step')[3];
  const before = [...(edited?.querySelectorAll('.notes-step-text li') ?? [])].map((item) => item.textContent);
  panel.element.querySelectorAll('.notes-step-undo')[1]?.dispatchEvent(new window.MouseEvent('click'));

  assert.deepEqual(
    { listed, before, undone },
    {
      listed: [
        ['Put back', 'Plan'],
        ['Removed', 'Plan'],
        ['Set apart', 'Week plan'],
        ['Edited', 'Plan'],
        ['Added', 'Plan'],
      ],
      before: ['the old step'],
      undone: ['s4'],
    },
  );
});

// With no changes yet, or no answer from the viewer, the panel says so
test('notesHistoryPanel_Should_SayWhenThereAreNoChanges_OrNoAnswer', async () => {
  const told = await Promise.all([async () => [], async () => undefined].map(async (read) => (await historyShown(read)).panel.element.textContent));

  assert.deepEqual(told, ['No changes of the notes yet.', 'Could not get the history from the viewer.']);
});
