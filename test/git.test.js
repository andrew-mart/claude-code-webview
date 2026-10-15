import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../test-support/temp-dir.js';
import { readBranch } from '../server/git.js';

/**
 * A folder with git's HEAD file in it.
 * @param {string} head — the HEAD file's contents
 */
async function repository(head) {
  const root = tempDir('ccw-git-');
  await mkdir(join(root, '.git'));
  await writeFile(join(root, '.git', 'HEAD'), head);
  return root;
}

test('readBranch_Should_NameBranchCheckedOutInFolderOrFolderAbove', async () => {
  const root = await repository('ref: refs/heads/feat/header\n');
  await mkdir(join(root, 'src', 'view'), { recursive: true });

  assert.equal(await readBranch(join(root, 'src', 'view')), 'feat/header');
});

test('readBranch_Should_FollowGitFileOfWorktreeOrSubmoduleToItsHead', async () => {
  const main = await repository('ref: refs/heads/main\n');
  await mkdir(join(main, '.git', 'worktrees', 'side'), { recursive: true });
  await writeFile(join(main, '.git', 'worktrees', 'side', 'HEAD'), 'ref: refs/heads/fix/side\n');
  const worktree = join(main, 'side');
  await mkdir(worktree);
  await writeFile(join(worktree, '.git'), 'gitdir: ../.git/worktrees/side\n');

  assert.equal(await readBranch(worktree), 'fix/side');
});

test('readBranch_Should_ShowDetachedHeadAsShortCommit', async () => {
  const root = await repository('1689bb5e0c4a7d2f9b8e6a5c3d1f0e9b8a7c6d5e\n');

  assert.equal(await readBranch(root), '1689bb5');
});
