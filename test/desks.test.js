import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from '../test-support/temp-dir.js';
import { createDeskFiles, deskPathIn } from '../server/desk-files.js';
import { createDesks } from '../server/desks.js';

/**
 * @typedef {import('../public/model/notes.js').Note} Note
 */

/** @param {string} id @param {string} text @returns {Note} */
const note = (id, text) => ({ id, text, at: '2026-10-31T09:00:00.000Z', shown: 'inline' });

/**
 * The desks of these sessions, in a folder of their own: acme, its billing-fix task folder, and the task's draft under it;
 * shop beside them. Each session's place — the folder it started in, the herdr workspace it runs in — as given; the
 * folders are there on the disk, but one gone from it.
 * @param {Record<string, { startedIn?: string, workspace?: string, gone?: boolean }>} sessions — the folders relative to
 *   the root
 */
function desksOf(sessions) {
  const root = tempDir('desks-');
  const folder = (/** @type {string} */ relativePath) => join(root, ...relativePath.split('/'));
  for (const { startedIn, gone } of Object.values(sessions)) if (startedIn !== undefined && gone !== true) mkdirSync(folder(startedIn), { recursive: true });
  const desks = createDesks({
    registry: join(root, 'state', 'desks.json'),
    files: createDeskFiles(),
    limit: 50,
    place: async (id) => {
      const known = sessions[id];
      return known === undefined ? undefined : { startedIn: known.startedIn === undefined ? undefined : folder(known.startedIn), workspace: known.workspace };
    },
  });
  /** @param {string} id */
  const notesOf = async (id) => (await desks.notes(id)).map((one) => one.text);
  return { desks, folder, notesOf };
}

// A herdr workspace's sessions share its desk wherever they started: the first note makes the desk in the folder that
// session started in, named after the workspace; a session outside herdr finds it from a folder under that one; a
// session elsewhere has none; one whose folder is not known, or gone from the disk, cannot make one — and the folder is
// not made again for it
test('desks_Should_GiveWorkspacesSessionsOneDesk_WhereverTheyStarted', async () => {
  const { desks, folder, notesOf } = desksOf({
    task: { startedIn: 'acme/billing-fix', workspace: 'orders' },
    parent: { startedIn: 'acme', workspace: 'orders' },
    below: { startedIn: 'acme/billing-fix/draft' },
    elsewhere: { startedIn: 'shop' },
    nowhere: {},
    gone: { startedIn: 'deleted/long ago', gone: true },
  });

  await desks.changeNotes('task', { action: 'add', note: note('n1', 'Where the bug is') });
  const refused = await desks.changeNotes('nowhere', { action: 'add', note: note('n2', 'Lost') });
  const notMade = { note: await desks.changeNotes('gone', { action: 'add', note: note('n3', 'Lost too') }), desk: await desks.create('gone', 'Anything') };

  assert.deepEqual(
    {
      desk: await desks.current('parent'),
      seen: { task: await notesOf('task'), parent: await notesOf('parent'), below: await notesOf('below'), elsewhere: await notesOf('elsewhere') },
      refused,
      notMade,
      noFolderMade: existsSync(folder('deleted')),
    },
    {
      desk: { path: deskPathIn(folder('acme/billing-fix'), 'orders'), name: 'orders', folder: folder('acme/billing-fix') },
      seen: { task: ['Where the bug is'], parent: ['Where the bug is'], below: ['Where the bug is'], elsewhere: [] },
      refused: undefined,
      notMade: { note: undefined, desk: undefined },
      noFolderMade: false,
    },
  );
});

// A desk keeps the files pinned on it, as its notes, and the notes' changes — the latest first
test('desks_Should_KeepPinsAndNotesHistory_OnTheDesk', async () => {
  const { desks, folder } = desksOf({ task: { startedIn: 'acme/billing-fix', workspace: 'orders' }, parent: { startedIn: 'acme', workspace: 'orders' } });
  const spec = { path: join(folder('acme/billing-fix'), 'spec.md'), at: '2026-10-31T09:01:00.000Z' };

  await desks.changePins('task', { action: 'add', pin: spec });
  await desks.changeNotes('task', { action: 'add', note: note('n1', 'Plan') });
  await desks.changeNotes('parent', { action: 'remove', id: 'n1' });

  assert.deepEqual(
    { pins: await desks.pins('parent'), history: (await desks.history('task')).map((step) => step.action) },
    { pins: [spec], history: ['remove', 'add'] },
  );
});

// A new desk for the next piece of work becomes the workspace's — every session of it on the new one — in the folder the
// session started in; the desks around are offered — the folder's and its parents', those chosen before — and one
// chosen is the workspace's again
test('desks_Should_SwitchWorkspaceToDeskMadeOrChosen_OfferingDesksAround', async () => {
  const { desks, folder, notesOf } = desksOf({ task: { startedIn: 'acme/billing-fix', workspace: 'orders' }, parent: { startedIn: 'acme', workspace: 'orders' } });
  await desks.changeNotes('task', { action: 'add', note: note('n1', 'First task') });
  const first = await desks.current('task');

  const made = await desks.create('parent', 'Second task');
  await desks.changeNotes('task', { action: 'add', note: note('n2', 'Second task notes') });
  const onNew = { task: await notesOf('task'), parent: await notesOf('parent') };
  const offered = (await desks.offered('task')).map((desk) => desk.name);
  const chosen = await desks.choose('parent', first?.path ?? '');

  assert.deepEqual(
    { made, onNew, offered, chosen, back: await notesOf('task') },
    {
      made: { path: deskPathIn(folder('acme'), 'Second task'), name: 'Second task', folder: folder('acme') },
      onNew: { task: ['Second task notes'], parent: ['Second task notes'] },
      offered: ['Second task', 'orders'],
      chosen: first,
      back: ['First task'],
    },
  );
});

// The desk moved to another folder — the right one, as it turned out — is still the workspace's, its notes and pinned
// files the same; another note moved from it to another desk is on that one alone
test('desks_Should_MoveDeskToAnotherFolder_AndNoteToAnotherDesk', async () => {
  const { desks, folder, notesOf } = desksOf({ task: { startedIn: 'acme/billing-fix/draft', workspace: 'orders' }, next: { startedIn: 'shop', workspace: 'shop' } });
  const spec = { path: join(folder('acme/billing-fix/draft'), 'spec.md'), at: '2026-10-31T09:01:00.000Z' };
  await desks.changePins('task', { action: 'add', pin: spec });
  await desks.changeNotes('task', { action: 'add', note: note('n1', 'Keep here') });
  await desks.changeNotes('task', { action: 'add', note: note('n2', 'Take along') });
  await desks.changeNotes('next', { action: 'add', note: note('n3', 'Shop notes') });

  const moved = await desks.move('task', folder('acme/billing-fix'));
  const target = await desks.current('next');
  const left = await desks.moveNote('task', 'n2', target?.path ?? '');

  assert.deepEqual(
    { moved, current: await desks.current('task'), pins: await desks.pins('task'), left: left?.map((one) => one.text), next: await notesOf('next') },
    {
      moved: { ok: true, path: deskPathIn(folder('acme/billing-fix'), 'orders') },
      current: { path: deskPathIn(folder('acme/billing-fix'), 'orders'), name: 'orders', folder: folder('acme/billing-fix') },
      pins: [spec],
      left: ['Keep here'],
      next: ['Take along', 'Shop notes'],
    },
  );
});
