// @ts-check
// The branch checked out in a folder, read from git's own files. The transcript records a branch too, but Claude Code
// does not update it after /cd or a checkout outside the session.
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * @param {string} dir — a folder in the repository, at any depth
 * @returns {Promise<string | undefined>} — a detached head as its short commit; undefined outside a repository
 */
export async function readBranch(dir) {
  const gitDir = await findGitDir(resolve(dir));
  if (gitDir === undefined) return undefined;
  const head = (await readFile(join(gitDir, 'HEAD'), 'utf8').catch(() => '')).trim();
  const branch = /^ref: refs\/heads\/(.+)$/.exec(head)?.[1];
  if (branch !== undefined) return branch;
  return /^[0-9a-f]{40,64}$/.test(head) ? head.slice(0, 7) : undefined;
}

/**
 * The repository's work tree a folder is in: this folder or the nearest one above with .git — a folder, or a file in a
 * worktree or a submodule.
 * @param {string} dir
 * @returns {Promise<string | undefined>} — undefined outside a repository
 */
export async function workTreeOf(dir) {
  for (let current = resolve(dir); ; current = dirname(current)) {
    if (await stat(join(current, '.git')).then(() => true, () => false)) return current;
    if (dirname(current) === current) return undefined;
  }
}

/**
 * The repository's git folder: .git in this folder or the nearest one above. In a worktree or a submodule .git is a
 * file that points to it.
 * @param {string} dir
 * @returns {Promise<string | undefined>}
 */
async function findGitDir(dir) {
  const top = await workTreeOf(dir);
  if (top === undefined) return undefined;
  const dotGit = join(top, '.git');
  const found = await stat(dotGit).catch(() => undefined);
  if (found?.isDirectory()) return dotGit;
  const pointer = /^gitdir:\s*(.+)$/m.exec(await readFile(dotGit, 'utf8').catch(() => ''))?.[1];
  return pointer === undefined ? undefined : resolve(top, pointer.trim());
}
