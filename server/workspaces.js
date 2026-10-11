// @ts-check
// Which herdr workspace each session belongs to, for grouping and searching the session list:
//   ~/.claude/sessions/<pid>.json       → the process that has the session open
//   herdr pane process-info             → the pane that runs that process
//   herdr pane list + workspace list    → the pane's workspace and its name
// A session seen running keeps that workspace in a file after it ends; one never seen running is put into the
// workspace whose panes are open in its folder, if just one workspace has panes there.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isRecord } from '../public/model/narrow.js';
import { foregroundPids, panesOf, succeeded, workspaceLabels } from './herdr.js';
import { latestRecords } from './registry.js';

/**
 * @typedef {{ herdr: boolean, sessions: Record<string, string> }} SessionWorkspaces — the /api/workspaces reply.
 *   herdr: whether herdr answers; without it the page shows no workspaces. sessions: the workspace's name, by session id
 * @typedef {{ byFolder: ReadonlyMap<string, string> } | undefined} HerdrView — what herdr showed; undefined: no herdr
 */

/**
 * @param {{ herdr: import('./composer.js').RunHerdr, readRecords: () => Promise<readonly unknown[]>, file: string, refreshMs: number }} deps
 *   readRecords — contents of ~/.claude/sessions/*.json; file — where the workspaces of sessions seen running are kept;
 *   refreshMs — herdr is asked at most this often
 */
export function createWorkspaces({ herdr, readRecords, file, refreshMs }) {
  /** A process's pane does not change while it runs: process-info is asked once for each Claude process. */
  /** @type {Map<number, string>} */
  const paneByPid = new Map();
  /** The workspace of every session seen running, by session id — read from the file once. */
  /** @type {Promise<Map<string, string>> | undefined} */
  let remembered;
  /** @type {{ at: number, view: Promise<HerdrView> } | undefined} */
  let latest;

  const seenSessions = () => {
    remembered ??= readRemembered(file);
    return remembered;
  };

  /**
   * The sessions running now: their panes' workspaces are remembered.
   * @param {ReadonlyMap<string, string>} labels
   * @param {readonly import('./herdr.js').Pane[]} panes
   */
  const rememberRunning = async (labels, panes) => {
    const records = [...latestRecords(await readRecords()).values()];
    if (records.some((record) => !paneByPid.has(record.pid))) await findPanes(panes);
    const seen = await seenSessions();
    let learned = false;
    for (const record of records) {
      const pane = panes.find((known) => known.paneId === paneByPid.get(record.pid));
      const label = pane === undefined ? undefined : labels.get(pane.workspaceId);
      if (label === undefined || seen.get(record.sessionId) === label) continue;
      seen.set(record.sessionId, label);
      learned = true;
    }
    if (learned) await writeRemembered(file, seen);
  };

  /** @param {readonly import('./herdr.js').Pane[]} panes */
  const findPanes = async (panes) => {
    for (const pane of panes.filter((known) => known.claude)) {
      const info = await herdr(['pane', 'process-info', '--pane', pane.paneId]);
      if (succeeded(info)) for (const pid of foregroundPids(info.json)) paneByPid.set(pid, pane.paneId);
    }
  };

  /** @returns {Promise<HerdrView>} */
  const lookAtHerdr = async () => {
    const workspaceList = await herdr(['workspace', 'list']);
    const paneList = await herdr(['pane', 'list']);
    if (!succeeded(workspaceList) || !succeeded(paneList)) return undefined;
    const labels = workspaceLabels(workspaceList.json);
    const panes = panesOf(paneList.json);
    await rememberRunning(labels, panes);
    return { byFolder: workspaceByFolder(panes, labels) };
  };

  /** Pages that ask at once, or within refreshMs, share one look at herdr. */
  const currentView = () => {
    if (latest === undefined || Date.now() - latest.at >= refreshMs) latest = { at: Date.now(), view: lookAtHerdr() };
    return latest.view;
  };

  return {
    /**
     * @param {readonly { id: string, cwd: string | undefined }[]} sessions — the session list
     * @returns {Promise<SessionWorkspaces>}
     */
    async of(sessions) {
      const view = await currentView();
      if (view === undefined) return { herdr: false, sessions: {} };
      const seen = await seenSessions();
      const found = sessions.flatMap(({ id, cwd }) => {
        const label = seen.get(id) ?? (cwd === undefined ? undefined : view.byFolder.get(folderKey(cwd)));
        return label === undefined ? [] : [[id, label]];
      });
      return { herdr: true, sessions: Object.fromEntries(found) };
    },
  };
}

/**
 * The workspace of each folder where panes of just one workspace are open.
 * @param {readonly import('./herdr.js').Pane[]} panes
 * @param {ReadonlyMap<string, string>} labels — workspace names by id
 * @returns {Map<string, string>} — by folderKey
 */
function workspaceByFolder(panes, labels) {
  /** @type {Map<string, Set<string>>} */
  const byFolder = new Map();
  for (const pane of panes) {
    const label = labels.get(pane.workspaceId);
    if (pane.cwd === undefined || label === undefined) continue;
    const key = folderKey(pane.cwd);
    byFolder.set(key, new Set([...(byFolder.get(key) ?? []), label]));
  }
  return new Map([...byFolder].flatMap(([folder, found]) => (found.size === 1 ? [...found].map((label) => /** @type {const} */ ([folder, label])) : [])));
}

/**
 * A folder as a key: the case, the kind of slashes and a trailing slash do not matter.
 * @param {string} path
 */
function folderKey(path) {
  return path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * @param {string} file
 * @returns {Promise<Map<string, string>>}
 */
async function readRemembered(file) {
  const content = await readFile(file, 'utf8').catch(() => undefined);
  if (content === undefined) return new Map();
  try {
    const json = JSON.parse(content);
    return new Map(isRecord(json) ? Object.entries(json).flatMap(([id, label]) => (typeof label === 'string' ? [/** @type {const} */ ([id, label])] : [])) : []);
  } catch {
    return new Map(); // a corrupt file — the workspaces are learned again from the sessions running now
  }
}

/**
 * @param {string} file
 * @param {ReadonlyMap<string, string>} seen
 */
async function writeRemembered(file, seen) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(Object.fromEntries(seen), undefined, 1)}\n`);
}
