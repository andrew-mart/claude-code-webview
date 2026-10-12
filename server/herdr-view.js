// @ts-check
// What herdr shows, as the page needs it: which herdr workspace each session belongs to, for grouping and searching the
// session list.
//   ~/.claude/sessions/<pid>.json  → the process that has the session open
//   herdr pane process-info        → the pane that runs that process
//   herdr api snapshot             → workspaces, their tabs and panes
// A session seen running keeps its workspace in a file after it ends; one never seen running is put into the workspace
// whose panes are open in its folder, if just one workspace has panes there.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isRecord, text } from '../public/model/narrow.js';
import { foregroundPids, snapshotOf, succeeded } from './herdr.js';
import { latestRecords } from './registry.js';

/**
 * @typedef {{ herdr: boolean, sessions: Record<string, string> }} SessionWorkspaces — the /api/workspaces reply.
 *   herdr: whether herdr answers; without it the page shows no workspaces. sessions: the workspace's name, by session id
 * @typedef {{ snapshot: import('./herdr.js').HerdrSnapshot, sessionByPane: ReadonlyMap<string, string>, byFolder: ReadonlyMap<string, string> } | undefined} HerdrView
 *   what herdr showed, the sessions running in its panes, and the workspace of each folder; undefined: no herdr
 * @typedef {import('./herdr.js').Pane} Pane
 */

/**
 * @param {{ herdr: import('./composer.js').RunHerdr, readRecords: () => Promise<readonly unknown[]>, file: string, refreshMs: number, claudeCommand: string }} deps
 *   readRecords — contents of ~/.claude/sessions/*.json; file — where the workspaces of sessions seen running are kept;
 *   refreshMs — herdr is asked at most this often; claudeCommand — what starts Claude Code in a new tab
 */
export function createHerdrView({ herdr, readRecords, file, refreshMs, claudeCommand }) {
  /** A process's pane does not change while it runs: process-info is asked once for each Claude process. */
  /** @type {Map<number, string>} */
  const paneByPid = new Map();
  /** Claude Code processes in no pane — run in an IDE, a plain terminal: not looked for again on every look at herdr. */
  /** @type {Set<number>} */
  const outsideHerdr = new Set();
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
   * Which session runs in which pane: the processes of Claude Code's registry, found in herdr's panes.
   * @param {readonly Pane[]} panes
   * @returns {Promise<Map<string, string>>} — session ids by pane id
   */
  const runningSessions = async (panes) => {
    const records = [...latestRecords(await readRecords()).values()];
    const unknown = records.filter((record) => !paneByPid.has(record.pid) && !outsideHerdr.has(record.pid));
    if (unknown.length > 0) {
      await findPanes(panes);
      for (const record of unknown) if (!paneByPid.has(record.pid)) outsideHerdr.add(record.pid);
    }
    const shown = new Set(panes.map((pane) => pane.paneId));
    return new Map(
      records.flatMap((record) => {
        const pane = paneByPid.get(record.pid);
        return pane !== undefined && shown.has(pane) ? [/** @type {const} */ ([pane, record.sessionId])] : [];
      }),
    );
  };

  /**
   * The workspaces of the sessions running now are remembered.
   * @param {import('./herdr.js').HerdrSnapshot} snapshot
   * @param {ReadonlyMap<string, string>} sessionByPane
   */
  const rememberRunning = async (snapshot, sessionByPane) => {
    const labels = workspaceLabels(snapshot);
    const seen = await seenSessions();
    let learned = false;
    for (const pane of snapshot.panes) {
      const session = sessionByPane.get(pane.paneId);
      const label = labels.get(pane.workspaceId);
      if (session === undefined || label === undefined || seen.get(session) === label) continue;
      seen.set(session, label);
      learned = true;
    }
    if (learned) await writeRemembered(file, seen);
  };

  /** @param {readonly Pane[]} panes */
  const findPanes = async (panes) => {
    for (const pane of panes.filter((known) => known.agent === 'claude')) {
      const info = await herdr(['pane', 'process-info', '--pane', pane.paneId]);
      if (succeeded(info)) for (const pid of foregroundPids(info.json)) paneByPid.set(pid, pane.paneId);
    }
  };

  /** @returns {Promise<HerdrView>} */
  const lookAtHerdr = async () => {
    const reply = await herdr(['api', 'snapshot']);
    const snapshot = succeeded(reply) ? snapshotOf(reply.json) : undefined;
    if (snapshot === undefined) return undefined;
    const sessionByPane = await runningSessions(snapshot.panes);
    await rememberRunning(snapshot, sessionByPane);
    return { snapshot, sessionByPane, byFolder: workspaceByFolder(snapshot.panes, workspaceLabels(snapshot)) };
  };

  /**
   * After a tab is renamed or closed the next look at herdr is a fresh one: the page shows the change at once.
   * @param {import('./composer.js').HerdrReply} reply
   * @returns {import('../public/model/herdr.js').TabChange}
   */
  const changed = (reply) => {
    if (!succeeded(reply)) return { ok: false, error: 'failed' };
    latest = undefined;
    return { ok: true };
  };

  /**
   * Claude Code in a new tab's shell: its command typed once the shell shows its prompt — what is typed before it may
   * be lost.
   * @param {string} pane
   * @returns {Promise<boolean>} — whether herdr took the keys
   */
  const startClaude = async (pane) => {
    for (let look = 0; look < shellLooks; look++) {
      const screen = await herdr(['pane', 'read', pane, '--source', 'visible', '--format', 'text']);
      if (screen.ok && screen.text.trim() !== '') break;
      await delay(shellStepMs);
    }
    return succeeded(await herdr(['pane', 'send-text', pane, claudeCommand])) && succeeded(await herdr(['pane', 'send-keys', pane, 'enter']));
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
    async workspacesOf(sessions) {
      const view = await currentView();
      if (view === undefined) return { herdr: false, sessions: {} };
      const seen = await seenSessions();
      const found = sessions.flatMap(({ id, cwd }) => {
        const label = seen.get(id) ?? (cwd === undefined ? undefined : view.byFolder.get(folderKey(cwd)));
        return label === undefined ? [] : [[id, label]];
      });
      return { herdr: true, sessions: Object.fromEntries(found) };
    },
    /**
     * A new tab beside one — in its workspace, in the folder of its pane — with a shell, or Claude Code started in it.
     * @param {string} besideTab
     * @param {import('../public/model/herdr.js').TabStart} start
     * @returns {Promise<import('../public/model/herdr.js').NewTab>}
     */
    async createTab(besideTab, start) {
      const view = await currentView();
      const beside = view?.snapshot.panes.find((pane) => pane.tabId === besideTab);
      if (beside === undefined) return { ok: false, error: 'failed' };
      const reply = await herdr(['tab', 'create', '--workspace', beside.workspaceId, ...(beside.cwd === undefined ? [] : ['--cwd', beside.cwd])]);
      const pane = succeeded(reply) ? rootPaneOf(reply.json) : undefined;
      if (pane === undefined) return { ok: false, error: 'failed' };
      latest = undefined;
      if (start === 'claude' && !(await startClaude(pane))) return { ok: false, error: 'failed' };
      return { ok: true, target: `#/pane/${pane}` };
    },
    /**
     * Names a tab, as herdr's own rename does.
     * @param {string} tabId
     * @param {string} label
     * @returns {Promise<import('../public/model/herdr.js').TabChange>}
     */
    async renameTab(tabId, label) {
      // a tab's name is one line
      const name = label.replace(/\s+/g, ' ').trim();
      if (name === '') return { ok: false, error: 'empty' };
      return changed(await herdr(['tab', 'rename', tabId, name]));
    },
    /**
     * Closes a tab: what runs in it stops — a Claude Code session can be resumed, its transcript stays.
     * @param {string} tabId
     * @returns {Promise<import('../public/model/herdr.js').TabChange>}
     */
    async closeTab(tabId) {
      return changed(await herdr(['tab', 'close', tabId]));
    },
    /** @returns {Promise<import('../public/model/herdr.js').HerdrLayout>} */
    async layout() {
      const view = await currentView();
      return view === undefined ? { herdr: false, workspaces: [] } : { herdr: true, workspaces: layoutOf(view.snapshot, view.sessionByPane) };
    },
  };
}

/**
 * herdr's workspaces and tabs in its own order — by their numbers — with the panes in each tab.
 * @param {import('./herdr.js').HerdrSnapshot} snapshot
 * @param {ReadonlyMap<string, string>} sessionByPane
 * @returns {import('../public/model/herdr.js').HerdrWorkspace[]}
 */
function layoutOf(snapshot, sessionByPane) {
  const byNumber = (/** @type {{ number: number }} */ a, /** @type {{ number: number }} */ b) => a.number - b.number;
  return [...snapshot.workspaces].sort(byNumber).map((workspace) => ({
    id: workspace.id,
    number: workspace.number,
    label: workspace.label,
    status: workspace.status,
    activeTab: workspace.activeTab,
    tabs: snapshot.tabs
      .filter((tab) => tab.workspaceId === workspace.id)
      .sort(byNumber)
      .map((tab) => ({
        id: tab.id,
        number: tab.number,
        label: tab.label,
        status: tab.status,
        panes: snapshot.panes
          .filter((pane) => pane.tabId === tab.id)
          .map((pane) => ({ id: pane.paneId, agent: pane.agent, status: pane.status, title: pane.title, session: sessionByPane.get(pane.paneId), size: pane.size, activity: pane.activity })),
      })),
  }));
}

/**
 * @param {import('./herdr.js').HerdrSnapshot} snapshot
 * @returns {Map<string, string>} — workspace names by id
 */
function workspaceLabels(snapshot) {
  return new Map(snapshot.workspaces.map((workspace) => [workspace.id, workspace.label]));
}

/**
 * The workspace of each folder where panes of just one workspace are open.
 * @param {readonly Pane[]} panes
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

/** A new tab's shell shows its prompt within a few seconds. */
const shellStepMs = 150;
const shellLooks = 30;

/**
 * The pane a new tab opened with, as herdr's tab.create tells it.
 * @param {unknown} json
 * @returns {string | undefined}
 */
function rootPaneOf(json) {
  const result = isRecord(json) && isRecord(json.result) ? json.result : undefined;
  return result !== undefined && isRecord(result.root_pane) ? text(result.root_pane.pane_id) : undefined;
}
