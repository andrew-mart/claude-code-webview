import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceIcons } from '../server/workspace-icons.js';
import { workspaceIcons } from '../public/model/tab-icon.js';

/** @param {string} dir */
const iconsIn = (dir) => createWorkspaceIcons({ file: join(dir, 'workspace-icons.json'), random: () => 0 });

// A workspace's icon is the emoji its user put ahead of its name; it is remembered for its folder, so a workspace opened
// there later — named without one — gets it too, the folder's case and slashes aside
test('iconsOf_Should_GiveWorkspaceTheIconAheadOfItsName_AndTheOneItsFolderHad', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ccw-icons-'));

  const named = await iconsIn(dir).iconsOf([{ id: 'w1', label: '🦊 shop', folder: 'D:\\dev\\shop' }]);
  const later = await iconsIn(dir).iconsOf([{ id: 'w9', label: 'shop again', folder: 'd:/dev/shop/' }]);

  assert.deepEqual([...named, ...later], [['w1', '🦊'], ['w9', '🦊']]);
});

// A workspace with no icon of its own nor of its folder gets one at random — one no other workspace has — and keeps it
test('iconsOf_Should_GiveWorkspaceWithoutOneAnIconNoOtherHas_AndKeepIt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ccw-icons-'));
  const icons = iconsIn(dir);
  const first = workspaceIcons[0];
  const workspaces = [
    { id: 'w1', label: `${first} shop`, folder: 'D:/dev/shop' },
    { id: 'w2', label: 'blog', folder: 'D:/dev/blog' },
    { id: 'w3', label: 'notes', folder: 'D:/dev/notes' },
  ];

  const given = await icons.iconsOf(workspaces);
  const again = await iconsIn(dir).iconsOf(workspaces);

  assert.deepEqual({ distinct: new Set(given.values()).size, kept: [...again] }, { distinct: 3, kept: [...given] });
});

// Workspaces in one folder have its one icon, from the first look at them
test('iconsOf_Should_GiveWorkspacesOfOneFolderOneIcon_FromTheFirstLook', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ccw-icons-'));

  const icons = await iconsIn(dir).iconsOf([
    { id: 'w8', label: 'bestfit', folder: 'D:/dev/bestfit' },
    { id: 'w13', label: 'bestfit', folder: 'd:\\dev\\bestfit' },
  ]);

  assert.equal(icons.get('w8'), icons.get('w13'));
});

// An icon picked by hand that a workspace's name cannot hold — one of Lucide's — is kept for its folder; taken back,
// the folder gets one at random again
test('setIcon_Should_KeepIconPickedByHandForFolder_AndTakeItBack', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ccw-icons-'));
  const icons = iconsIn(dir);
  const shop = [{ id: 'w1', label: 'shop', folder: 'D:/dev/shop' }];

  await icons.setIcon('d:/dev/shop/', 'lucide:wallet@green');
  const picked = (await iconsIn(dir).iconsOf(shop)).get('w1');
  await icons.setIcon('D:/dev/shop', undefined);
  const again = (await iconsIn(dir).iconsOf(shop)).get('w1');

  assert.deepEqual({ picked, randomAgain: again !== undefined && !again.startsWith('lucide:') }, { picked: 'lucide:wallet@green', randomAgain: true });
});
