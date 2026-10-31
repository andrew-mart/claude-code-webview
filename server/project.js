// @ts-check
// A session's project in the file panel: its folders, one at a time as they open, and its text searched. The search
// is git's: in a repository its files and new ones, not what it ignores; outside one the folder's files, its ignore
// files minded all the same. A search stops at so many matches, and says there were more.
import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

/**
 * @typedef {{ text: string, mode: 'text' | 'regex', caseSensitive: boolean, wholeWord: boolean }} SearchQuery
 * @typedef {{ name: string, kind: 'folder' | 'file' }} FolderEntry
 * @typedef {{ path: string, line: number, column: number, text: string }} Match — line, column: from 1; text: the
 *   line's, cut around the match when long
 * @typedef {'not-absolute' | 'not-found' | 'not-a-folder'} FolderRefusal
 * @typedef {{ ok: true, path: string, entries: FolderEntry[], more: boolean } | { ok: false, error: FolderRefusal }} FolderListing
 * @typedef {{ ok: true, root: string, matches: Match[], more: boolean } | { ok: false, error: FolderRefusal | 'bad-pattern' | 'no-git' }} SearchOutcome
 */

/** A match's line longer than this is cut around the match. */
const maxLineChars = 240;
/** How long a search may take: a big project is searched no longer. */
export const searchTimeoutMs = 20_000;
const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * A folder's folders, then its files, each by name as a person sorts them; git's own folder left out.
 * @param {string} requested — an absolute path, or a path from the home folder (~/…)
 * @param {{ home: string, maxEntries: number }} options
 * @returns {Promise<FolderListing>}
 */
export async function listFolder(requested, { home, maxEntries }) {
  const folder = await folderAt(requested, home);
  if (!folder.ok) return folder;
  const dirents = await readdir(folder.path, { withFileTypes: true });
  const entries = await Promise.all(
    dirents
      .filter((dirent) => dirent.name !== '.git')
      .map(async (dirent) => {
        // a link is what it leads to; one that leads nowhere is left out
        const isFolder = dirent.isSymbolicLink() ? (await stat(join(folder.path, dirent.name)).catch(() => undefined))?.isDirectory() : dirent.isDirectory();
        return isFolder === undefined ? [] : [{ name: dirent.name, kind: isFolder ? /** @type {const} */ ('folder') : /** @type {const} */ ('file') }];
      }),
  );
  const sorted = entries.flat().sort((a, b) => (a.kind === b.kind ? names.compare(a.name, b.name) : a.kind === 'folder' ? -1 : 1));
  return { ok: true, path: folder.path, entries: sorted.slice(0, maxEntries), more: sorted.length > maxEntries };
}

/**
 * The project's text searched: every match with its file, line and column.
 * @param {string} requested — the project's folder: an absolute path, or a path from the home folder (~/…)
 * @param {SearchQuery} query
 * @param {{ home: string, maxMatches: number, timeoutMs: number }} options — timeoutMs: how long it may take (searchTimeoutMs)
 * @returns {Promise<SearchOutcome>}
 */
export async function searchProject(requested, query, { home, maxMatches, timeoutMs }) {
  const folder = await folderAt(requested, home);
  if (!folder.ok) return folder;
  const how = [query.mode === 'regex' ? '-E' : '-F', ...(query.caseSensitive ? [] : ['-i']), ...(query.wholeWord ? ['-w'] : [])];
  const inRepository = await gitGrep(folder.path, ['--untracked', ...how, '-e', query.text], maxMatches, timeoutMs);
  // exit code 128: not a repository — its folder is searched as plain files
  const found = inRepository.ok || inRepository.error !== 'not-a-repository' ? inRepository : await gitGrep(folder.path, ['--no-index', '--exclude-standard', ...how, '-e', query.text], maxMatches, timeoutMs);
  if (!found.ok) return { ok: false, error: found.error === 'not-a-repository' ? 'bad-pattern' : found.error };
  return { ok: true, root: folder.path, matches: found.matches.map((match) => ({ ...match, path: join(folder.path, match.path) })), more: found.more };
}

/**
 * git grep in the folder, read as it prints, stopped once it found enough.
 * @param {string} dir
 * @param {readonly string[]} args — what to look for, and where
 * @param {number} maxMatches
 * @param {number} timeoutMs — how long it may take: stopped then, what it found so far, and more maybe
 * @returns {Promise<{ ok: true, matches: Match[], more: boolean } | { ok: false, error: 'not-a-repository' | 'bad-pattern' | 'no-git' }>}
 */
function gitGrep(dir, args, maxMatches, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn('git', ['-c', 'safe.directory=*', '-c', 'core.quotepath=off', '--no-optional-locks', 'grep', '-n', '--column', '-z', '-I', '--no-color', ...args, '--', '.'], {
      cwd: dir,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    /** @type {Match[]} */
    const matches = [];
    let more = false;
    let rest = '';
    let errors = '';
    // stopped by its time, what it found so far: there may be more
    const timer = setTimeout(() => {
      more = true;
      child.kill();
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (/** @type {string} */ chunk) => {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) {
        const match = matchOf(line);
        if (match === undefined) continue;
        if (matches.length === maxMatches) {
          more = true;
          child.kill();
          return;
        }
        matches.push(match);
      }
    });
    child.stderr.on('data', (/** @type {string} */ chunk) => {
      errors += chunk;
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ ok: false, error: 'no-git' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      // 1: nothing found; 128: not a repository, or a pattern git could not read
      if (code === 128 && !more) resolve({ ok: false, error: /not a git repository/i.test(errors) ? 'not-a-repository' : 'bad-pattern' });
      else resolve({ ok: true, matches, more });
    });
  });
}

/**
 * @param {string} line — git grep's with -z: path, line, column and the text, NUL between them
 * @returns {Match | undefined}
 */
function matchOf(line) {
  const [path, lineNumber, column, ...text] = line.split('\0');
  const at = Number(lineNumber);
  const from = Number(column);
  if (path === undefined || !Number.isSafeInteger(at) || !Number.isSafeInteger(from)) return undefined;
  const whole = text.join('\0').replace(/\r$/, '');
  return { path, line: at, column: from, text: cutAround(whole, from - 1) };
}

/**
 * @param {string} text
 * @param {number} index — where the match starts, in UTF-8 bytes as git counts — near enough in characters
 */
function cutAround(text, index) {
  if (text.length <= maxLineChars) return text;
  const start = Math.max(0, Math.min(index - 40, text.length - maxLineChars));
  return `${start > 0 ? '…' : ''}${text.slice(start, start + maxLineChars)}…`;
}

/**
 * @param {string} requested
 * @param {string} home
 * @returns {Promise<{ ok: true, path: string } | { ok: false, error: FolderRefusal }>}
 */
export async function folderAt(requested, home) {
  const path = /^~[\\/]/.test(requested) ? join(home, requested.slice(2)) : requested;
  if (!isAbsolute(path)) return { ok: false, error: 'not-absolute' };
  const info = await stat(path).catch(() => undefined);
  if (info === undefined) return { ok: false, error: 'not-found' };
  if (!info.isDirectory()) return { ok: false, error: 'not-a-folder' };
  return { ok: true, path };
}
