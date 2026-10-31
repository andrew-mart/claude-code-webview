import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeNotes } from '../public/model/notes.js';
import { parseSteps, recordStep, stepOf, undoStep } from '../public/model/notes-history.js';

/** @typedef {import('../public/model/notes.js').Note} Note */
/** @typedef {import('../public/model/notes.js').NoteChange} NoteChange */
/** @typedef {import('../public/model/notes-history.js').NoteStep} NoteStep */

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

// A note saved as it is typed is edited every few seconds: its edits one after another — within ten minutes of each
// other — are one step, from the note before the first to the note after the last, and a note written and then filled
// in is one step of its writing; an edit after another note's step, or after ten minutes, is a step of its own
test('recordStep_Should_JoinNotesEditsFollowingEachOther_IntoOneStep', () => {
  const at = (/** @type {string} */ time) => `2026-10-27T10:${time}.000Z`;
  const empty = { ...plan, text: '' };
  /** @type {NoteStep[]} */
  const typed = [
    { id: 's1', at: at('00:00'), action: 'add', before: undefined, after: empty },
    { id: 's2', at: at('00:05'), action: 'edit', before: empty, after: { ...plan, text: '# Pl' } },
    { id: 's3', at: at('00:09'), action: 'edit', before: { ...plan, text: '# Pl' }, after: plan },
    { id: 's4', at: at('01:00'), action: 'add', before: undefined, after: ideas },
    { id: 's5', at: at('02:00'), action: 'edit', before: plan, after: { ...plan, text: '# Plan\n- one' } },
    { id: 's6', at: at('15:00'), action: 'edit', before: { ...plan, text: '# Plan\n- one' }, after: { ...plan, text: '# Plan\n- one\n- two' } },
  ];

  const kept = typed.reduce((/** @type {readonly NoteStep[]} */ steps, step) => recordStep(steps, step, 10), []);

  assert.deepEqual(
    kept.map((step) => [step.id, step.at, step.action, step.before?.text, step.after?.text]),
    [
      ['s6', at('15:00'), 'edit', '# Plan\n- one', '# Plan\n- one\n- two'],
      ['s5', at('02:00'), 'edit', '# Plan', '# Plan\n- one'],
      ['s4', at('01:00'), 'add', undefined, '# Ideas'],
      ['s1', at('00:09'), 'add', undefined, '# Plan'],
    ],
  );
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
