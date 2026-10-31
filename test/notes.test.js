import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeNotes, notesFolderOf, parseNoteChange } from '../public/model/notes.js';

/** @typedef {import('../public/model/notes.js').Note} Note */

/** @type {Note} */
const older = { id: 'n1', text: '**TODO** check the build', at: '2026-10-27T09:00:00.000Z' };
/** @type {Note} */
const newer = { id: 'n2', text: 'idea: `herdr tab focus`', at: '2026-10-27T09:05:00.000Z' };

// The latest note written comes first; the same one twice is kept once — two devices sending one change must not double
// it; an edit keeps when the note was written; a note emptied by an edit is gone; an edit or a removal of a note removed
// on another device changes nothing
test('changeNotes_Should_KeepLatestFirst_AddOnce_EditKeepingWhen_AndDropNoteEmptied', () => {
  const added = changeNotes(changeNotes([older], { action: 'add', note: newer }), { action: 'add', note: newer });
  const edited = changeNotes(added, { action: 'edit', id: 'n1', text: '**TODO** check the build and the deploy' });

  assert.deepEqual(
    {
      added,
      edited,
      emptied: changeNotes(added, { action: 'edit', id: 'n2', text: ' \n ' }),
      removed: changeNotes(added, { action: 'remove', id: 'n1' }),
      gone: [changeNotes(added, { action: 'edit', id: 'n9', text: 'x' }), changeNotes(added, { action: 'remove', id: 'n9' })],
    },
    {
      added: [newer, older],
      edited: [newer, { ...older, text: '**TODO** check the build and the deploy' }],
      emptied: [older],
      removed: [newer],
      gone: [[newer, older], [newer, older]],
    },
  );
});

// A change the page sends, read as it is or not at all
test('parseNoteChange_Should_ReadOnlyWellFormedChanges', () => {
  assert.deepEqual(
    [
      parseNoteChange({ action: 'add', note: older }),
      parseNoteChange({ action: 'edit', id: 'n1', text: 'new text' }),
      parseNoteChange({ action: 'remove', id: 'n1' }),
      parseNoteChange({ action: 'add', note: { ...older, text: '  ' } }),
      parseNoteChange({ action: 'edit', id: 'n1' }),
      parseNoteChange({ action: 'drop', id: 'n1' }),
      parseNoteChange('add'),
    ],
    [{ action: 'add', note: older }, { action: 'edit', id: 'n1', text: 'new text' }, { action: 'remove', id: 'n1' }, undefined, undefined, undefined, undefined],
  );
});

// A session's notes are its project folder's: Claude Code's project — the folder it started in, as Claude Code names it,
// the same after a cd — and for Codex the folder it runs in, named the same way, so Claude Code and Codex in one folder
// share them; a Codex session with no folder known has none
test('notesFolderOf_Should_ShareFolder_AcrossSessionsAndAgents_AndStayAfterCd', () => {
  assert.deepEqual(
    [
      notesFolderOf({ agent: 'claude', project: 'D--dev-shop', cwd: 'D:\\dev\\shop' }),
      notesFolderOf({ agent: 'claude', project: 'D--dev-shop', cwd: 'D:\\dev\\shop\\server' }),
      notesFolderOf({ agent: 'codex', project: 'codex', cwd: 'D:\\dev\\shop' }),
      notesFolderOf({ agent: 'codex', project: 'codex', cwd: 'D:\\dev\\blog' }),
      notesFolderOf({ agent: 'codex', project: 'codex', cwd: undefined }),
    ],
    ['D--dev-shop', 'D--dev-shop', 'D--dev-shop', 'D--dev-blog', undefined],
  );
});
