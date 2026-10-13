// @ts-check
// A branch's changes, from git: the branch it was made from — git records it in its reflogs as the branch is made —
// the commit it left that branch at, and all it changed since, what is not committed yet included. git runs as a
// program with its arguments, no shell, and takes no lock: the session's own git may be at work in the same folder.
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

/**
 * @typedef {import('../public/model/branch-changes.js').BranchChanges} BranchChanges
 * @typedef {import('../public/model/branch-changes.js').BranchBase} BranchBase
 * @typedef {import('../public/model/branch-changes.js').BranchCommit} BranchCommit
 * @typedef {import('../public/model/branch-changes.js').ChangedFile} ChangedFile
 * @typedef {import('../public/model/branch-changes.js').ChangeStatus} ChangeStatus
 * @typedef {import('../public/model/branch-changes.js').FileDiff} FileDiff
 * @typedef {import('../public/model/tool.js').DiffRow} DiffRow
 * @typedef {{ ok: true, out: string } | { ok: false, missing: boolean }} GitReply — missing: there is no git program
 */

/** Paths as they are, not quoted, and taken as they are — no pattern; a repository owned by another user — a
 * container's mount — is read all the same. */
const gitSettings = ['-c', 'core.quotepath=off', '-c', 'safe.directory=*', '--no-optional-locks', '--literal-pathspecs'];
const gitTimeoutMs = 15_000;
const maxGitOutput = 32 * 1024 * 1024;
/** The commits listed at most: a branch far longer than that is shown by its files all the same. */
const maxCommits = 500;
/** A new file larger than this is not read to count its lines. */
const maxCountedBytes = 2 * 1024 * 1024;
/** The lines of a file's diff given at most: the rest of a larger one is left out. */
const maxDiffRows = 20_000;
/** The tree with nothing in it: the base of a repository with no commit yet. */
const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** @type {Readonly<Record<string, ChangeStatus>>} */
const statuses = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', T: 'type-changed', U: 'modified' };

/**
 * What the branch checked out in the folder changed since it left its base.
 * @param {string} dir — a folder in the repository
 * @param {{ base?: string | undefined }} options — base: a branch to compare with instead of the one the branch was made
 *   from
 * @returns {Promise<BranchChanges>}
 */
export async function branchChanges(dir, { base }) {
  if (!(await stat(dir).catch(() => undefined))?.isDirectory()) return { ok: false, error: 'not-a-repository' };
  const top = await git(dir, ['rev-parse', '--show-toplevel']);
  if (!top.ok) return { ok: false, error: top.missing ? 'no-git' : 'not-a-repository' };
  const root = top.out.trim();
  const branch = lineOf(await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']));
  const found = (base === undefined ? undefined : await chosenBase(root, base)) ?? (await baseOf(root, branch));
  const [commits, files, branches] = await Promise.all([commitsSince(root, found.sha), filesSince(root, found.sha), branchNames(root)]);
  return { ok: true, root, branch, base: found, commits, files, branches };
}

/**
 * The base the branch is compared with: the branch it was made from; with no record of that, the main branch; on the
 * main branch, what it was pushed to; with none of them, the last commit.
 * @param {string} root
 * @param {string | undefined} branch
 * @returns {Promise<BranchBase>}
 */
async function baseOf(root, branch) {
  const parent = branch === undefined ? undefined : await madeFrom(root, branch);
  const fromParent = parent === undefined ? undefined : await forkedFrom(root, parent, 'made-from');
  if (fromParent !== undefined) return fromParent;
  const main = await mainBranch(root);
  const fromMain = main === undefined || main === branch ? undefined : await forkedFrom(root, main, 'main-branch');
  if (fromMain !== undefined) return fromMain;
  const upstream = lineOf(await git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']));
  const fromUpstream = upstream === undefined ? undefined : await forkedFrom(root, upstream, 'upstream');
  if (fromUpstream !== undefined) return fromUpstream;
  return { name: 'HEAD', sha: lineOf(await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])) ?? emptyTree, how: 'head' };
}

/**
 * @param {string} root
 * @param {string} name
 * @returns {Promise<BranchBase | undefined>}
 */
async function chosenBase(root, name) {
  return name.startsWith('-') ? undefined : forkedFrom(root, name, 'chosen');
}

/**
 * Where the checked-out branch left another: their last common commit.
 * @param {string} root
 * @param {string} name
 * @param {BranchBase['how']} how
 * @returns {Promise<BranchBase | undefined>}
 */
async function forkedFrom(root, name, how) {
  const sha = lineOf(await git(root, ['merge-base', 'HEAD', name]));
  return sha === undefined ? undefined : { name, sha, how };
}

/**
 * The branch this one was made from, as git recorded it as it made the branch: the oldest line of the branch's own
 * reflog says "branch: Created from main" — or "from HEAD", and then HEAD's reflog says from which branch it moved into
 * the new one that same second. A branch whose reflog starts otherwise — cloned, fetched, made by git init — was not
 * made from another here; a checkout back to a branch that already was is no making of it.
 * @param {string} root
 * @param {string} branch
 * @returns {Promise<string | undefined>}
 */
async function madeFrom(root, branch) {
  const [making] = reflog(await git(root, ['reflog', 'show', '--date=unix', '--format=%gd%x09%gs', `refs/heads/${branch}`, '--'])).slice(-1);
  const from = /^branch: Created from (.+)$/.exec(making?.subject ?? '')?.[1];
  if (making === undefined || from === undefined) return undefined;
  if (from !== 'HEAD') return (await isBranch(root, from)) ? from : undefined;
  const moves = reflog(await git(root, ['reflog', 'show', '--date=unix', '--format=%gd%x09%gs', 'HEAD', '--']));
  const into = moves.flatMap(({ at, subject }) => {
    const [, left, entered] = /^checkout: moving from (\S+) to (\S+)$/.exec(subject) ?? [];
    return entered === branch && left !== undefined && left !== branch && Math.abs(at - making.at) <= 2 ? [left] : [];
  });
  const left = into.at(-1);
  return left !== undefined && (await isBranch(root, left)) ? left : undefined;
}

/**
 * A reflog read with --date=unix --format=%gd%x09%gs: when each line was written, seconds, and what it says.
 * @param {GitReply} reply
 * @returns {{ at: number, subject: string }[]}
 */
function reflog(reply) {
  return linesOf(reply).map((line) => {
    const [selector = '', ...subject] = line.split('\t');
    return { at: Number(/@\{(\d+)\}$/.exec(selector)?.[1] ?? Number.NaN), subject: subject.join('\t') };
  });
}

/**
 * The repository's main branch: the one its remote points at, else main or master.
 * @param {string} root
 * @returns {Promise<string | undefined>}
 */
async function mainBranch(root) {
  const remote = lineOf(await git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']));
  const local = remote?.replace(/^origin\//, '');
  for (const name of [local, 'main', 'master', remote, 'origin/main', 'origin/master']) {
    if (name !== undefined && (await isBranch(root, name))) return name;
  }
  return undefined;
}

/**
 * @param {string} root
 * @param {string} name
 */
async function isBranch(root, name) {
  for (const ref of [`refs/heads/${name}`, `refs/remotes/${name}`]) {
    if ((await git(root, ['rev-parse', '--verify', '--quiet', ref])).ok) return true;
  }
  return false;
}

/**
 * @param {string} root
 * @param {string} base
 * @returns {Promise<BranchCommit[]>}
 */
async function commitsSince(root, base) {
  const log = await git(root, ['log', `--max-count=${maxCommits}`, '--format=%H%x09%s', `${base}..HEAD`, '--']);
  return linesOf(log).map((line) => {
    const [sha = '', ...subject] = line.split('\t');
    return { sha, subject: subject.join('\t') };
  });
}

/**
 * The files changed since the base — committed or not — and the new ones git does not track yet, by path.
 * @param {string} root
 * @param {string} base
 * @returns {Promise<ChangedFile[]>}
 */
async function filesSince(root, base) {
  const [names, counts, untracked] = await Promise.all([
    git(root, ['diff', '--name-status', '-z', '-M', base, '--']),
    git(root, ['diff', '--numstat', '-z', '-M', base, '--']),
    git(root, ['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  const lines = lineCounts(counts.ok ? counts.out : '');
  const tracked = changedNames(names.ok ? names.out : '').map((file) => ({ ...file, ...(lines.get(file.path) ?? { added: undefined, removed: undefined }) }));
  const fresh = await Promise.all(
    (untracked.ok ? untracked.out.split('\0') : [])
      .filter((path) => path !== '')
      .map(async (path) => ({ path, oldPath: undefined, status: /** @type {const} */ ('untracked'), added: await countLines(join(root, path)), removed: 0 })),
  );
  return [...tracked, ...fresh].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * git diff --name-status -z: a status and a path, or a status and two paths for a rename or a copy — R100, C75.
 * @param {string} out
 * @returns {{ path: string, oldPath: string | undefined, status: ChangeStatus }[]}
 */
function changedNames(out) {
  const fields = out.split('\0');
  /** @type {{ path: string, oldPath: string | undefined, status: ChangeStatus }[]} */
  const files = [];
  for (let index = 0; index < fields.length - 1; ) {
    const code = fields[index] ?? '';
    const status = statuses[code.charAt(0)] ?? 'modified';
    const pair = status === 'renamed' || status === 'copied';
    const oldPath = pair ? fields[index + 1] : undefined;
    const path = fields[index + (pair ? 2 : 1)] ?? '';
    files.push({ path, oldPath, status });
    index += pair ? 3 : 2;
  }
  return files;
}

/**
 * git diff --numstat -z: lines added and removed by path — "-" for a binary file; a rename's paths come after it.
 * @param {string} out
 * @returns {Map<string, { added: number | undefined, removed: number | undefined }>}
 */
function lineCounts(out) {
  const fields = out.split('\0');
  /** @type {Map<string, { added: number | undefined, removed: number | undefined }>} */
  const counts = new Map();
  for (let index = 0; index < fields.length - 1; ) {
    const [added = '', removed = '', path = ''] = (fields[index] ?? '').split('\t');
    const count = { added: added === '-' ? undefined : Number(added), removed: removed === '-' ? undefined : Number(removed) };
    // a rename: its old and new paths follow in fields of their own
    const renamed = path === '';
    counts.set(renamed ? (fields[index + 2] ?? '') : path, count);
    index += renamed ? 3 : 1;
  }
  return counts;
}

/**
 * A new file's lines; none for a binary or a large one.
 * @param {string} file
 * @returns {Promise<number | undefined>}
 */
async function countLines(file) {
  const info = await stat(file).catch(() => undefined);
  if (info === undefined || !info.isFile() || info.size > maxCountedBytes) return undefined;
  const bytes = await readFile(file).catch(() => undefined);
  if (bytes === undefined || bytes.includes(0)) return undefined;
  const text = bytes.toString('utf8');
  if (text === '') return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

/**
 * The repository's branches, local and remote, for a base to be chosen from.
 * @param {string} root
 * @returns {Promise<string[]>}
 */
async function branchNames(root) {
  return linesOf(await git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'])).filter((name) => !name.endsWith('/HEAD'));
}

/**
 * @param {GitReply} reply
 * @returns {string | undefined} — the reply's first line; none when git failed or said nothing
 */
function lineOf(reply) {
  const line = reply.ok ? reply.out.split('\n')[0]?.trim() : undefined;
  return line === '' ? undefined : line;
}

/**
 * @param {GitReply} reply
 * @returns {string[]}
 */
function linesOf(reply) {
  return reply.ok ? reply.out.split('\n').map((line) => line.trimEnd()).filter((line) => line !== '') : [];
}

/**
 * @param {string} dir
 * @param {readonly string[]} args
 * @returns {Promise<GitReply>}
 */
function git(dir, args) {
  return new Promise((resolve) => {
    execFile('git', [...gitSettings, ...args], { cwd: dir, timeout: gitTimeoutMs, maxBuffer: maxGitOutput, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (error, stdout) => {
      if (error === null) resolve({ ok: true, out: stdout });
      else resolve({ ok: false, missing: error.code === 'ENOENT' });
    });
  });
}

/**
 * One changed file's diff since the base: its lines numbered on both sides; a new file git does not track yet whole, as
 * added.
 * @param {string} dir — a folder in the repository
 * @param {{ base: string, path: string, oldPath: string | undefined, status: ChangeStatus }} file — base: the commit
 *   the changes are counted from; path: from the repository's top
 * @returns {Promise<FileDiff>}
 */
export async function branchFileDiff(dir, { base, path, oldPath, status }) {
  if (!(await stat(dir).catch(() => undefined))?.isDirectory()) return { ok: false, error: 'not-a-repository' };
  const top = await git(dir, ['rev-parse', '--show-toplevel']);
  if (!top.ok) return { ok: false, error: top.missing ? 'no-git' : 'not-a-repository' };
  const root = top.out.trim();
  if (status === 'untracked') return newFileRows(root, path);
  const diff = await git(root, ['diff', '-M', base, '--', ...(oldPath === undefined ? [] : [oldPath]), path]);
  const text = diff.ok ? diff.out : '';
  if (/^Binary files .* differ$/m.test(text)) return { ok: true, rows: [], binary: true };
  return { ok: true, rows: unifiedRows(text), binary: false };
}

/**
 * A new file whole, as added lines; nothing outside the repository is read.
 * @param {string} root
 * @param {string} path
 * @returns {Promise<FileDiff>}
 */
async function newFileRows(root, path) {
  const file = resolve(root, path);
  const inside = relative(root, file);
  if (inside === '' || inside.startsWith('..') || resolve(root, inside) !== file) return { ok: false, error: 'not-in-repository' };
  const bytes = await readFile(file).catch(() => undefined);
  if (bytes === undefined) return { ok: false, error: 'not-in-repository' };
  if (bytes.includes(0)) return { ok: true, rows: [], binary: true };
  const lines = bytes.toString('utf8').replace(/\r?\n$/, '').split(/\r?\n/);
  return { ok: true, rows: lines.slice(0, maxDiffRows).map((line, index) => ({ kind: 'add', oldNo: undefined, newNo: index + 1, text: line })), binary: false };
}

/**
 * git's unified diff as rows: each hunk's lines numbered from its header on both sides, a gap between hunks.
 * @param {string} text
 * @returns {DiffRow[]}
 */
function unifiedRows(text) {
  /** @type {DiffRow[]} */
  const rows = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const line of text.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk !== null) {
      if (inHunk) rows.push({ kind: 'gap', oldNo: undefined, newNo: undefined, text: '' });
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || rows.length >= maxDiffRows) continue;
    const body = line.slice(1).replace(/\r$/, '');
    // "\ No newline at end of file" and the empty end of the output are no lines of the file
    if (line.startsWith(' ')) rows.push({ kind: 'ctx', oldNo: oldNo++, newNo: newNo++, text: body });
    else if (line.startsWith('-')) rows.push({ kind: 'del', oldNo: oldNo++, newNo: undefined, text: body });
    else if (line.startsWith('+')) rows.push({ kind: 'add', oldNo: undefined, newNo: newNo++, text: body });
  }
  return rows;
}
