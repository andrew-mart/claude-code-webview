import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeNotes, noteName, noteTitle, notesFolderOf, parseNoteChange, parseNotes } from '../public/model/notes.js';

/** @typedef {import('../public/model/notes.js').Note} Note */

/** @type {Note} */
const older = { id: 'n1', text: '**TODO** check the build', at: '2026-10-27T09:00:00.000Z', shown: 'inline' };
/** @type {Note} */
const newer = { id: 'n2', text: 'idea: `herdr tab focus`', at: '2026-10-27T09:05:00.000Z', shown: 'panel' };

// A note is shown inline in the outline unless it is set apart — listed by its name, opening in the side panel: one
// kept before notes could be set apart, or with a way not known, inline
test('parseNotes_Should_ShowNoteInline_UnlessSetApart', () => {
  const { shown, ...kept } = older;

  assert.deepEqual(
    parseNotes([kept, { ...newer, shown: 'panel' }, { ...older, id: 'n3', shown: 'sideways' }]).map((note) => [note.id, note.shown]),
    [
      ['n1', 'inline'],
      ['n2', 'panel'],
      ['n3', 'inline'],
    ],
  );
});

// A note with no words is a note: written empty, to be filled in, it is kept; one with no text at all is no note
test('parseNotes_Should_KeepNoteWithNoWords_AndDropOneWithNoText', () => {
  const { text: _none, ...textless } = older;

  assert.deepEqual(
    parseNotes([{ ...older, text: '' }, { ...newer, text: ' \n ' }, { ...textless, id: 'n3' }, { ...older, id: 'n4', text: 42 }]).map((note) => [note.id, note.text]),
    [
      ['n1', ''],
      ['n2', ' \n '],
    ],
  );
});

// The latest note written comes first; the same one twice is kept once — two devices sending one change must not double
// it; an edit keeps when the note was written; a note emptied by an edit stays, empty — the bin removes a note; an edit
// or a removal of a note removed on another device changes nothing
test('changeNotes_Should_KeepLatestFirst_AddOnce_EditKeepingWhen_AndKeepNoteEmptied', () => {
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
      emptied: [{ ...newer, text: ' \n ' }, older],
      removed: [newer],
      gone: [[newer, older], [newer, older]],
    },
  );
});

// A note is set apart — or brought back inline — where it is in the list; one removed meanwhile changes nothing
test('changeNotes_Should_SetNoteApartOrBackInline_InItsPlace', () => {
  assert.deepEqual(
    [
      changeNotes([newer, older], { action: 'show', id: 'n1', shown: 'panel' }),
      changeNotes([newer, older], { action: 'show', id: 'n2', shown: 'inline' }),
      changeNotes([newer, older], { action: 'show', id: 'n9', shown: 'panel' }),
    ],
    [
      [newer, { ...older, shown: 'panel' }],
      [{ ...newer, shown: 'inline' }, older],
      [newer, older],
    ],
  );
});

// A note put back as it was — after its removal, or over the text an edit gave it — takes its place by when it was
// written, once
test('changeNotes_Should_PutNoteBackAsItWas_InItsPlace', () => {
  assert.deepEqual(
    [
      changeNotes([newer], { action: 'put', note: older }),
      changeNotes([newer, { ...older, text: 'later text', shown: 'panel' }], { action: 'put', note: older }),
    ],
    [
      [newer, older],
      [newer, older],
    ],
  );
});

// A change the page sends, read as it is or not at all
// A note may be named by hand, and is listed by that name — else by its first line: an edit names it, renames it or
// leaves it to its first line again with a blank name; an edit from a page that knows no names leaves the name as it was
test('changeNotes_Should_NameNoteByHand_AndKeepName_When_EditSaysNothingOfIt', () => {
  const named = changeNotes([older], { action: 'edit', id: 'n1', text: older.text, name: ' Build checks ' });
  const textOnly = changeNotes(named, { action: 'edit', id: 'n1', text: '**TODO** check the deploy' });
  const unnamed = changeNotes(textOnly, { action: 'edit', id: 'n1', text: '**TODO** check the deploy', name: ' ' });

  assert.deepEqual(
    { listedBy: [named, textOnly, unnamed].map(([note]) => note && noteName(note)), unnamed },
    { listedBy: ['Build checks', 'Build checks', 'TODO check the deploy'], unnamed: [{ ...older, text: '**TODO** check the deploy' }] },
  );
});

// A name comes and goes with its note — in the server's file, in a note added or an edit sent by the page — without the
// spaces around it; a blank name, or one of another kind, is none
test('parseNotes_And_parseNoteChange_Should_CarryNoteName', () => {
  assert.deepEqual(
    {
      stored: parseNotes([{ ...older, name: ' Build checks ' }, { ...newer, name: '  ' }, { ...newer, id: 'n4', name: 7 }]),
      added: parseNoteChange({ action: 'add', note: { ...newer, name: 'Ideas' } }),
      edited: parseNoteChange({ action: 'edit', id: 'n1', text: 'new text', name: 'Build checks' }),
    },
    {
      stored: [{ ...older, name: 'Build checks' }, newer, { ...newer, id: 'n4' }],
      added: { action: 'add', note: { ...newer, name: 'Ideas' } },
      edited: { action: 'edit', id: 'n1', text: 'new text', name: 'Build checks' },
    },
  );
});

// The notes stand in the order they are put in: a note moved goes before the one it is let go before — with none, last —
// and stays there; a note added comes first and one put back as it was takes its place by when it was written, both
// leaving the others where they were moved to; a move of a note removed meanwhile changes nothing
test('changeNotes_Should_MoveNoteBeforeAnother_AndKeepTheOrderMovedTo', () => {
  /** @param {string} id @param {string} at @returns {Note} */
  const noteAt = (id, at) => ({ id, text: id, at: `2026-10-27T09:${at}:00.000Z`, shown: 'inline' });
  const [n1, n2, n3, n4] = [noteAt('n1', '00'), noteAt('n2', '05'), noteAt('n3', '10'), noteAt('n4', '15')];
  const moved = changeNotes([n3, n2, n1], { action: 'move', id: 'n3', before: 'n1' });
  const last = changeNotes(moved, { action: 'move', id: 'n2' });
  const added = changeNotes(last, { action: 'add', note: n4 });
  const putBack = changeNotes(changeNotes(added, { action: 'remove', id: 'n3' }), { action: 'put', note: n3 });
  const ids = (/** @type {readonly Note[]} */ notes) => notes.map((note) => note.id).join(' ');

  assert.deepEqual(
    { moved: ids(moved), last: ids(last), added: ids(added), putBack: ids(putBack), gone: ids(changeNotes(last, { action: 'move', id: 'n9', before: 'n1' })) },
    { moved: 'n2 n3 n1', last: 'n3 n1 n2', added: 'n4 n3 n1 n2', putBack: 'n4 n3 n1 n2', gone: 'n3 n1 n2' },
  );
});

test('parseNoteChange_Should_ReadOnlyWellFormedChanges', () => {
  assert.deepEqual(
    [
      parseNoteChange({ action: 'add', note: older }),
      parseNoteChange({ action: 'edit', id: 'n1', text: 'new text' }),
      parseNoteChange({ action: 'remove', id: 'n1' }),
      parseNoteChange({ action: 'show', id: 'n1', shown: 'panel' }),
      parseNoteChange({ action: 'show', id: 'n1', shown: 'sideways' }),
      parseNoteChange({ action: 'put', note: older }),
      parseNoteChange({ action: 'put', note: { id: 'n1' } }),
      parseNoteChange({ action: 'add', note: { ...older, text: 42 } }),
      parseNoteChange({ action: 'edit', id: 'n1' }),
      parseNoteChange({ action: 'move', id: 'n1', before: 'n2' }),
      parseNoteChange({ action: 'move', id: 'n1' }),
      parseNoteChange({ action: 'move', before: 'n2' }),
      parseNoteChange({ action: 'drop', id: 'n1' }),
      parseNoteChange('add'),
    ],
    [
      { action: 'add', note: older },
      { action: 'edit', id: 'n1', text: 'new text' },
      { action: 'remove', id: 'n1' },
      { action: 'show', id: 'n1', shown: 'panel' },
      undefined,
      { action: 'put', note: older },
      undefined,
      undefined,
      undefined,
      { action: 'move', id: 'n1', before: 'n2' },
      { action: 'move', id: 'n1' },
      undefined,
      undefined,
      undefined,
    ],
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

// A note listed by its name: its first line with words, as read — no markdown's marks: a heading's #, a list's bullet or
// number, a quote's >, emphasis, code's ticks, a link's address
test('noteTitle_Should_NameNoteByItsFirstLine_AsRead', () => {
  assert.deepEqual(
    [
      noteTitle('# Plan for the week\n- notes'),
      noteTitle('\n\n**TODO** check the `build`'),
      noteTitle('- [the spec](https://example.com/spec) first'),
      noteTitle('1. > _quoted_ idea'),
      noteTitle('   \n## \n plain text'),
    ],
    ['Plan for the week', 'TODO check the build', 'the spec first', 'quoted idea', 'plain text'],
  );
});
