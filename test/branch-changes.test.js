import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { tempDir } from '../test-support/temp-dir.js';
import { branchChanges, branchFileDiff } from '../server/branch-changes.js';

const run = promisify(execFile);

/**
 * A git repository of its own in a temporary folder, on main.
 * @param {import('node:test').TestContext} t
 */
async function gitRepo(t) {
  const dir = tempDir('ccw-git-');
  const git = async (/** @type {string[]} */ ...args) => (await run('git', args, { cwd: dir })).stdout;
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.name', 'Ann');
  await git('config', 'user.email', 'ann@example.com');
  await git('config', 'core.autocrlf', 'false');
  /** Files written and committed. @param {Record<string, string>} files @param {string} message */
  const commit = async (files, message) => {
    for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
    await git('add', '-A');
    await git('commit', '-q', '-m', message);
  };
  return { dir, git, commit };
}

/** What a reply says, in short. @param {Awaited<ReturnType<typeof branchChanges>>} changes */
function summary(changes) {
  assert.ok(changes.ok);
  return { branch: changes.branch, base: changes.base.name, how: changes.base.how, commits: changes.commits.map((commit) => commit.subject), files: changes.files };
}

// A branch's changes are all it changed since it was made — its commits and what is not committed yet, new files
// included — not what its parent got after
test('branchChanges_Should_ShowWhatBranchChangedSinceItWasMade_UncommittedIncluded', async (t) => {
  const repo = await gitRepo(t);
  await repo.commit({ 'base.txt': 'one\n', 'gone.txt': 'x\n' }, 'start');
  await repo.git('checkout', '-q', '-b', 'feat');
  await repo.commit({ 'base.txt': 'one\ntwo\n' }, 'feat: two');
  await repo.git('rm', '-q', 'gone.txt');
  await repo.git('commit', '-q', '-m', 'feat: drop gone');
  await repo.git('checkout', '-q', 'main');
  await repo.commit({ 'main-only.txt': 'm\n' }, 'main moves on');
  await repo.git('checkout', '-q', 'feat');
  await writeFile(join(repo.dir, 'base.txt'), 'one\ntwo\nthree\n');
  await writeFile(join(repo.dir, 'new.txt'), 'n\n');

  assert.deepEqual(summary(await branchChanges(repo.dir, {})), {
    branch: 'feat',
    base: 'main',
    how: 'made-from',
    commits: ['feat: drop gone', 'feat: two'],
    files: [
      { path: 'base.txt', oldPath: undefined, status: 'modified', added: 2, removed: 0 },
      { path: 'gone.txt', oldPath: undefined, status: 'deleted', added: 0, removed: 1 },
      { path: 'new.txt', oldPath: undefined, status: 'untracked', added: 1, removed: 0 },
    ],
  });
});

// The reply names the repository's top folder, the files' paths are from it: the page opens a changed file by it
test('branchChanges_Should_NameRepositoryTop_When_AskedFromFolderInside', async (t) => {
  const repo = await gitRepo(t);
  await repo.commit({ 'a.txt': 'a\n' }, 'start');
  await repo.git('checkout', '-q', '-b', 'feat');
  await mkdir(join(repo.dir, 'src'));
  await writeFile(join(repo.dir, 'src', 'b.txt'), 'b\n');

  const changes = await branchChanges(join(repo.dir, 'src'), {});

  assert.ok(changes.ok);
  assert.deepEqual({ root: changes.root, files: changes.files.map((file) => file.path) }, { root: (await realpath(repo.dir)).replaceAll('\\', '/'), files: ['src/b.txt'] });
});

// A branch made from another branch is compared with that one; another base can be chosen
test('branchChanges_Should_CompareWithBranchItWasMadeFrom_OrWithBaseChosen', async (t) => {
  const repo = await gitRepo(t);
  await repo.commit({ 'a.txt': 'a\n' }, 'start');
  await repo.git('checkout', '-q', '-b', 'feat');
  await repo.commit({ 'b.txt': 'b\n' }, 'feat: b');
  await repo.git('checkout', '-q', '-b', 'feat-more');
  await repo.commit({ 'c.txt': 'c\n' }, 'more: c');

  const files = (/** @type {Awaited<ReturnType<typeof branchChanges>>} */ changes) => summary(changes).files.map((file) => file.path);

  assert.deepEqual(
    { auto: summary(await branchChanges(repo.dir, {})).base, autoFiles: files(await branchChanges(repo.dir, {})), chosenFiles: files(await branchChanges(repo.dir, { base: 'main' })) },
    { auto: 'feat', autoFiles: ['c.txt'], chosenFiles: ['b.txt', 'c.txt'] },
  );
});

// Going back to a branch is no making of it: the main branch, checked out again from a branch made from it, is not
// compared with that one — with nothing it was pushed to, only what is not committed yet is its change
test('branchChanges_Should_NotTakeBranchCheckedOutAgainForMadeFromBranchLeft', async (t) => {
  const repo = await gitRepo(t);
  await repo.commit({ 'a.txt': 'a\n' }, 'start');
  await repo.git('checkout', '-q', '-b', 'feat');
  await repo.commit({ 'b.txt': 'b\n' }, 'feat: b');
  await repo.git('checkout', '-q', 'main');
  await writeFile(join(repo.dir, 'a.txt'), 'a\nmore\n');

  const changes = summary(await branchChanges(repo.dir, {}));

  assert.deepEqual({ branch: changes.branch, base: changes.base, how: changes.how, files: changes.files.map((file) => file.path) }, { branch: 'main', base: 'HEAD', how: 'head', files: ['a.txt'] });
});

// A branch git kept no record of making — fetched, or its records expired — is compared with the main branch
test('branchChanges_Should_CompareWithMainBranch_When_ThereIsNoRecordOfMakingBranch', async (t) => {
  const repo = await gitRepo(t);
  await repo.commit({ 'a.txt': 'a\n' }, 'start');
  await repo.git('checkout', '-q', '-b', 'feat');
  await repo.commit({ 'b.txt': 'b\n' }, 'feat: b');
  await repo.git('reflog', 'expire', '--expire=now', '--all');

  const changes = summary(await branchChanges(repo.dir, {}));

  assert.deepEqual({ base: changes.base, how: changes.how, files: changes.files.map((file) => file.path) }, { base: 'main', how: 'main-branch', files: ['b.txt'] });
});

/** The base a branch's changes are counted from. @param {string} dir */
async function baseSha(dir) {
  const changes = await branchChanges(dir, {});
  assert.ok(changes.ok);
  return changes.base.sha;
}

// A changed file's diff since the base: its lines numbered on both sides, the hunks set apart
test('branchFileDiff_Should_GiveLinesChangedSinceBase_NumberedOnBothSides', async (t) => {
  const repo = await gitRepo(t);
  const lines = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
  await repo.commit({ 'list.txt': `${lines.join('\n')}\n` }, 'start');
  await repo.git('checkout', '-q', '-b', 'feat');
  await repo.commit({ 'list.txt': `${['line 1', 'line 2 changed', ...lines.slice(2, 11), 'line 12', 'line 13'].join('\n')}\n` }, 'feat: change');

  const diff = await branchFileDiff(repo.dir, { base: await baseSha(repo.dir), path: 'list.txt', oldPath: undefined, status: 'modified' });

  assert.ok(diff.ok);
  assert.deepEqual(
    diff.rows.map((row) => [row.kind, row.oldNo, row.newNo, row.text]),
    [
      ['ctx', 1, 1, 'line 1'],
      ['del', 2, undefined, 'line 2'],
      ['add', undefined, 2, 'line 2 changed'],
      ['ctx', 3, 3, 'line 3'],
      ['ctx', 4, 4, 'line 4'],
      ['ctx', 5, 5, 'line 5'],
      ['gap', undefined, undefined, ''],
      ['ctx', 10, 10, 'line 10'],
      ['ctx', 11, 11, 'line 11'],
      ['ctx', 12, 12, 'line 12'],
      ['add', undefined, 13, 'line 13'],
    ],
  );
});

// A new file git does not track yet comes whole as added, a deleted one whole as removed; a binary one has no lines
test('branchFileDiff_Should_GiveNewFileAsAdded_DeletedAsRemoved_AndSayBinary', async (t) => {
  const repo = await gitRepo(t);
  await repo.commit({ 'old.txt': 'a\nb\n', 'logo.bin': 'x\0y' }, 'start');
  await repo.git('checkout', '-q', '-b', 'feat');
  await repo.git('rm', '-q', 'old.txt');
  await writeFile(join(repo.dir, 'logo.bin'), 'x\0z');
  await writeFile(join(repo.dir, 'new.txt'), 'n1\nn2\n');
  const base = await baseSha(repo.dir);
  const rowsOf = async (/** @type {string} */ path, /** @type {import('../public/model/branch-changes.js').ChangeStatus} */ status) => {
    const diff = await branchFileDiff(repo.dir, { base, path, oldPath: undefined, status });
    assert.ok(diff.ok);
    return { binary: diff.binary, rows: diff.rows.map((row) => [row.kind, row.oldNo, row.newNo, row.text]) };
  };

  assert.deepEqual(
    { added: await rowsOf('new.txt', 'untracked'), removed: await rowsOf('old.txt', 'deleted'), binary: await rowsOf('logo.bin', 'modified') },
    {
      added: { binary: false, rows: [['add', undefined, 1, 'n1'], ['add', undefined, 2, 'n2']] },
      removed: { binary: false, rows: [['del', 1, undefined, 'a'], ['del', 2, undefined, 'b']] },
      binary: { binary: true, rows: [] },
    },
  );
});

// A folder that is not in a git repository has no branch to show
test('branchChanges_Should_SayFolderIsNotInRepository', async (t) => {
  const dir = tempDir('ccw-plain-');

  assert.deepEqual(await branchChanges(dir, {}), { ok: false, error: 'not-a-repository' });
});
