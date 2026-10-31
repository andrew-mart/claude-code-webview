import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeNotes } from '../public/model/notes.js';
import { parseSteps, recordStep, stepOf, undoStep } from '../public/model/notes-history.js';

/** @typedef {import('../public/model/notes.js').Note} Note */
/** @typedef {import('../public/model/notes.js').NoteChange} NoteChange */

/** @type {Note} */
const plan = { id: 'n1', text: '# Plan', at: '2026-10-27T09:00:00.000Z', shown: 'inline' };
/** @type {Note} */
const ideas = { id: 'n2', text: '# Ideas', at: '2026-10-27T09:05:00.000Z', shown: 'panel' };
const stamp = { id: 's1', at: '2026-10-27T10:00:00.000Z' };

/** The notes a change leaves, and its step. @param {readonly Note[]} before @param {NoteChange} change */
const stepped = (before, change) => {
  const after = changeNotes(before, change);
  return { after, step: stepOf(before, after, change, stamp) };
};

// Each change is a step of the note it changed — the note as it was and as it became, none before it was added or after
// it was removed; a change that changed nothing is no step
test('stepOf_Should_KeepNoteBeforeAndAfterChange_AndNoStepForChangeOfNothing', () => {
  assert.deepEqual(
    [
      stepped([ideas], { action: 'add', note: plan }).step,
      stepped([ideas, plan], { action: 'edit', id: 'n1', text: '# Plan v2' }).step,
      stepped([ideas, plan], { action: 'remove', id: 'n2' }).step,
      stepped([plan], { action: 'show', id: 'n1', shown: 'panel' }).step,
      stepped([plan], { action: 'edit', id: 'n1', text: '# Plan', name: 'Week plan' }).step,
      stepped([plan], { action: 'edit', id: 'n1', text: '# Plan' }).step,
      stepped([plan], { action: 'remove', id: 'n9' }).step,
    ],
    [
      { ...stamp, action: 'add', before: undefined, after: plan },
      { ...stamp, action: 'edit', before: plan, after: { ...plan, text: '# Plan v2' } },
      { ...stamp, action: 'remove', before: ideas, after: undefined },
      { ...stamp, action: 'show', before: plan, after: { ...plan, shown: 'panel' } },
      { ...stamp, action: 'edit', before: plan, after: { ...plan, name: 'Week plan' } },
      undefined,
      undefined,
    ],
  );
});

// Undoing a step leaves the notes as they were before it: a note added is gone, one removed is back in its place, an
// edit's text and a way shown are as they were
test('undoStep_Should_LeaveNotesAsTheyWereBeforeStep', () => {
  /** @type {[readonly Note[], NoteChange][]} */
  const changes = [
    [[ideas], { action: 'add', note: plan }],
    [[ideas, plan], { action: 'remove', id: 'n1' }],
    [[ideas, plan], { action: 'edit', id: 'n2', text: '# Ideas, more' }],
    [[ideas, plan], { action: 'show', id: 'n2', shown: 'inline' }],
  ];

  const undone = changes.map(([before, change]) => {
    const { after, step } = stepped(before, change);
    assert.ok(step !== undefined);
    return changeNotes(after, undoStep(step));
  });

  assert.deepEqual(undone, [[ideas], [ideas, plan], [ideas, plan], [ideas, plan]]);
});

// The steps are kept the latest first, as many as the limit; steps of another shape are dropped as read
test('recordStep_Should_KeepLatestFirst_UpToLimit_AndParseStepsDropWhatItCannotRead', () => {
  const step = (/** @type {string} */ id) => ({ id, at: stamp.at, action: /** @type {const} */ ('add'), before: undefined, after: plan });

  assert.deepEqual(
    {
      kept: recordStep([step('s2'), step('s1')], step('s3'), 2).map((one) => one.id),
      read: parseSteps([step('s1'), { ...step('s2'), action: 'fly' }, { id: 's3', at: stamp.at, action: 'remove' }, 'junk']).map((one) => one.id),
    },
    { kept: ['s3', 's2'], read: ['s1'] },
  );
});
