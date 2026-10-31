import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tempDir } from '../test-support/temp-dir.js';
import { createNotesFile } from '../server/notes.js';

/** @type {import('../public/model/notes.js').Note} */
const plan = { id: 'n1', text: '# Plan', at: '2026-10-27T09:00:00.000Z', shown: 'inline' };

/** A folder's notes kept in files of a folder of their own, the history holding as many steps as the limit. @param {number} limit */
function notesFile(limit) {
  const folder = tempDir('notes-file-');
  return createNotesFile(join(folder, 'notes.json'), { history: join(folder, 'notes-history.json'), limit });
}

/** Each step as what was done, the text before and the text after. @param {readonly import('../public/model/notes-history.js').NoteStep[]} steps */
const told = (steps) => steps.map((step) => [step.action, step.before?.text, step.after?.text]);

// Each change of a folder's notes is a step of the folder's history, the latest first — none for a change that changed
// nothing — kept as many as the limit; changes sent at once are steps one after another, each from the note the one
// before it left
test('notesFile_Should_KeepStepOfEachChange_PerFolder_UpToLimit_OneAfterAnother', async () => {
  const notes = notesFile(3);

  await notes.change('D--dev-shop', { action: 'add', note: plan });
  await notes.change('D--dev-shop', { action: 'edit', id: 'n1', text: '# Plan' });
  await Promise.all([notes.change('D--dev-shop', { action: 'edit', id: 'n1', text: '# Plan v2' }), notes.change('D--dev-shop', { action: 'edit', id: 'n1', text: '# Plan v3' })]);
  await notes.change('D--dev-shop', { action: 'remove', id: 'n1' });
  await notes.change('D--dev-blog', { action: 'add', note: { ...plan, text: '# Blog plan' } });

  assert.deepEqual(
    { shop: told(await notes.history('D--dev-shop')), blog: told(await notes.history('D--dev-blog')), left: await notes.list('D--dev-shop') },
    {
      shop: [
        ['remove', '# Plan v3', undefined],
        ['edit', '# Plan v2', '# Plan v3'],
        ['edit', '# Plan', '# Plan v2'],
      ],
      blog: [['add', undefined, '# Blog plan']],
      left: [],
    },
  );
});
