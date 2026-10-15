// @ts-check
// Which Codex thread runs in which herdr pane. Codex keeps no record of its processes as Claude Code does; what it does
// keep: a lock on each thread it has open, the thread's folder, and the thread's name — which it also puts in its
// terminal's title.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isRecord, text } from '../public/model/narrow.js';
import { folderKey } from './folders.js';

/**
 * @typedef {{ id: string, cwd: string, name: string | undefined, activeAt: number }} LiveThread — a Codex thread open
 *   now, a person's (not a subagent's): its folder, the name Codex gave it, when it was last active
 */

/**
 * The threads the Codex panes run: in a pane's folder, the thread its title names; then, of a folder's panes and
 * threads left, one pane runs the one thread with no name. Panes that cannot be told apart are left out — a terminal,
 * not a feed.
 * @param {readonly import('./herdr.js').Pane[]} panes
 * @param {readonly LiveThread[]} threads
 * @returns {Map<string, string>} — thread ids by pane id
 */
export function codexPanes(panes, threads) {
  /** @type {Map<string, string>} */
  const found = new Map();
  const taken = new Set();
  /** @param {string} folder */
  const left = (folder) => threads.filter((thread) => !taken.has(thread.id) && folderKey(thread.cwd) === folder);
  const byFolder = groupBy(
    panes.flatMap((pane) => (pane.agent === 'codex' && pane.cwd !== undefined ? [{ pane, folder: folderKey(pane.cwd) }] : [])),
    ({ folder }) => folder,
  );
  for (const [folder, there] of byFolder) {
    for (const { pane } of there) {
      // the longest name the title holds: a name may be part of another
      const [named] = left(folder)
        .filter((thread) => thread.name !== undefined && pane.title?.includes(thread.name) === true)
        .sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0));
      if (named === undefined) continue;
      found.set(pane.paneId, named.id);
      taken.add(named.id);
    }
    // the one pane left runs the one thread left only when it has no name: a named one would show it in the title
    const unnamed = there.filter(({ pane }) => !found.has(pane.paneId));
    const free = left(folder).filter((thread) => thread.name === undefined);
    const [last] = unnamed;
    const [thread] = free;
    if (unnamed.length === 1 && free.length === 1 && last !== undefined && thread !== undefined) found.set(last.pane.paneId, thread.id);
  }
  return found;
}

/**
 * Codex's threads open now, from its home: the lock it holds on each (thread-writer-locks/<id>.lock) — the file stays
 * once the thread is closed, held by no one — the name it gave each (session_index.jsonl, the last one written), each
 * one's folder and who runs it from the session list.
 * @param {{ home: string, summaryOf: (id: string) => Promise<{ cwd: string | undefined, kind: 'interactive' | 'sdk', activeAt: number } | undefined>, held: (lock: string) => Promise<boolean> }} deps
 *   home — CODEX_HOME; summaryOf — a Codex session's, from the session list: none for one not found; held — whether a
 *   lock file is held now (lockHeld)
 */
export function createCodexThreads({ home, summaryOf, held }) {
  return {
    /** @returns {Promise<readonly LiveThread[]>} */
    async open() {
      const dir = join(home, 'thread-writer-locks');
      const locks = await readdir(dir).catch(() => []);
      const named = locks.flatMap((name) => (name.endsWith('.lock') && !name.startsWith('.') ? [name.slice(0, -'.lock'.length)] : []));
      const ids = (await Promise.all(named.map(async (id) => ((await held(join(dir, `${id}.lock`))) ? [id] : [])))).flat();
      if (ids.length === 0) return [];
      const names = await threadNames(join(home, 'session_index.jsonl'));
      const found = await Promise.all(
        ids.map(async (id) => {
          const summary = await summaryOf(id);
          return summary?.kind === 'interactive' && summary.cwd !== undefined ? [{ id, cwd: summary.cwd, name: names.get(id), activeAt: summary.activeAt }] : [];
        }),
      );
      return found.flat();
    },
  };
}

/**
 * Whether Codex holds a thread's lock now: on Windows a held lock cannot be read; elsewhere a lock binds only those who
 * ask for it, and the file is taken for held.
 * @param {string} lock — its file
 * @returns {Promise<boolean>}
 */
export async function lockHeld(lock) {
  if (process.platform !== 'win32') return true;
  return readFile(lock).then(
    () => false,
    (error) => error instanceof Error && 'code' in error && error.code === 'EBUSY',
  );
}

/**
 * The names Codex gave its threads: it writes a line each time it names one, the last one stands. No file: none named.
 * @param {string} file — session_index.jsonl
 * @returns {Promise<Map<string, string>>}
 */
async function threadNames(file) {
  const content = await readFile(file, 'utf8').catch(() => '');
  /** @type {Map<string, string>} */
  const names = new Map();
  for (const line of content.split('\n')) {
    const entry = parsed(line);
    const id = isRecord(entry) ? text(entry.id) : undefined;
    const name = isRecord(entry) ? text(entry.thread_name) : undefined;
    if (id !== undefined && name !== undefined) names.set(id, name);
  }
  return names;
}

/**
 * @param {string} line
 * @returns {unknown}
 */
function parsed(line) {
  try {
    return JSON.parse(line);
  } catch {
    return undefined; // an empty line, or one being written
  }
}

/**
 * @template T
 * @param {readonly T[]} items
 * @param {(item: T) => string} keyOf
 * @returns {Map<string, T[]>}
 */
function groupBy(items, keyOf) {
  /** @type {Map<string, T[]>} */
  const groups = new Map();
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
  return groups;
}
