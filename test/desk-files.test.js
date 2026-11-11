import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../test-support/temp-dir.js';
import { createDeskFiles, deskFolder, deskPathIn } from '../server/desk-files.js';

/** @type {import('../public/model/notes.js').Note} */
const plan = { id: 'n1', text: '# Plan\n- ship it', at: '2026-10-31T09:00:00.000Z', shown: 'inline' };

// A desk is a file in its folder's .desks — its notes, their history, its pinned files — the pinned files' paths kept
// relative to the folder, so the desk goes on naming the same files wherever the folder is; read back, they are whole
test('deskFiles_Should_KeepNotesHistoryAndPins_PinsRelativeToDeskFolderInFile', async () => {
  const folder = join(tempDir('desk-files-'), 'shop');
  const files = createDeskFiles();
  const path = deskPathIn(folder, 'Shop / checkout');
  const spec = { path: join(folder, 'docs', 'spec.md'), at: '2026-10-31T09:01:00.000Z' };
  const outside = { path: join(folder, '..', 'billing', 'README.md'), at: '2026-10-31T09:02:00.000Z', name: 'Billing' };
  /** @type {import('../public/model/notes-history.js').NoteStep} */
  const step = { id: 's1', at: '2026-10-31T09:00:00.000Z', action: 'add', before: undefined, after: plan };

  const made = await files.change(path, (desk) => ({ ...desk, notes: [plan], pins: [spec, outside], history: [step] }), 'Shop / checkout');
  const stored = JSON.parse(await readFile(path, 'utf8'));

  assert.deepEqual(
    { path, folder: deskFolder(path), made, read: await files.read(path), stored: stored.pins.map((/** @type {{ path: string }} */ pin) => pin.path) },
    {
      path: join(folder, '.desks', 'Shop - checkout.json'),
      folder,
      made: { name: 'Shop / checkout', notes: [plan], pins: [spec, outside], history: [step] },
      read: { name: 'Shop / checkout', notes: [plan], pins: [spec, outside], history: [step] },
      stored: ['docs/spec.md', '../billing/README.md'],
    },
  );
});

// No file is no desk; the desks of a folder are the files in its .desks; a file that is not a desk is an error rather than
// an empty desk — the next change would write over it
test('deskFiles_Should_ListFoldersDesks_AndRefuseFileThatIsNoDesk', async () => {
  const folder = tempDir('desk-list-');
  const files = createDeskFiles();
  await files.change(deskPathIn(folder, 'checkout'), (desk) => desk, 'checkout');
  await files.change(deskPathIn(folder, 'billing'), (desk) => desk, 'billing');
  await writeFile(join(folder, '.desks', 'notes.txt'), 'not a desk');
  const broken = deskPathIn(folder, 'broken');
  await writeFile(broken, '{ not json');

  assert.deepEqual(
    { none: await files.read(deskPathIn(folder, 'nowhere')), listed: await files.inFolder(folder), empty: await files.inFolder(join(folder, 'none')) },
    { none: undefined, listed: [deskPathIn(folder, 'billing'), deskPathIn(folder, 'broken'), deskPathIn(folder, 'checkout')], empty: [] },
  );
  await assert.rejects(files.read(broken), /broken\.json/);
});

// A desk moved to another folder goes into its .desks, its pinned files still the same files — their paths kept
// relative to the new folder — and is gone from the old one; a desk of that name there already is not written over
test('deskFiles_Should_MoveDeskToAnotherFolder_ItsPinsStillTheSameFiles', async () => {
  const root = tempDir('desk-move-');
  const from = join(root, 'shop', 'draft');
  const to = join(root, 'shop');
  const files = createDeskFiles();
  const path = deskPathIn(from, 'checkout');
  const spec = { path: join(from, 'spec.md'), at: '2026-10-31T09:01:00.000Z' };
  await files.change(path, (desk) => ({ ...desk, pins: [spec] }), 'checkout');
  await mkdir(join(root, 'other', '.desks'), { recursive: true });
  await writeFile(deskPathIn(join(root, 'other'), 'checkout'), '{}');

  const moved = await files.move(path, to);
  const taken = await files.move(deskPathIn(to, 'checkout'), join(root, 'other'));

  assert.deepEqual(
    {
      moved,
      pins: (await files.read(deskPathIn(to, 'checkout')))?.pins,
      stored: JSON.parse(await readFile(deskPathIn(to, 'checkout'), 'utf8')).pins,
      left: await readdir(join(from, '.desks')),
      taken,
    },
    {
      moved: { ok: true, path: deskPathIn(to, 'checkout') },
      pins: [spec],
      stored: [{ path: 'draft/spec.md', at: '2026-10-31T09:01:00.000Z' }],
      left: [],
      taken: { ok: false, error: 'exists' },
    },
  );
});
