// @ts-check
// What herdr shows, as the page needs it: which herdr workspace each session belongs to, for grouping and searching the
// session list.
//   ~/.claude/sessions/<pid>.json  → the process that has the session open
//   herdr pane process-info        → the pane that runs that process
//   herdr api snapshot             → workspaces, their tabs and panes
// A session seen running keeps its workspace in a file after it ends; one never seen running is put into the workspace
// whose panes are open in its folder, if just one workspace has panes there.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isRecord, text } from '../public/model/narrow.js';
import { foregroundPids, snapshotOf, succeeded } from './herdr.js';
import { latestRecords } from './registry.js';
import { acceptTrust } from './trust.js';
import { parseHistory } from '../public/model/history.js';
import { observed } from './session-history.js';

/**
 * @typedef {{ herdr: boolean, sessions: Record<string, string> }} SessionWorkspaces — the /api/workspaces reply.
 *   herdr: whether herdr answers; without it the page shows no workspaces. sessions: the workspace's name, by session id
 * @typedef {{ snapshot: import('./herdr.js').HerdrSnapshot, sessionByPane: ReadonlyMap<string, string>, byFolder: ReadonlyMap<string, string> } | undefined} HerdrView
 *   what herdr showed, the sessions running in its panes, and the workspace of each folder; undefined: no herdr
 * @typedef {import('./herdr.js').Pane} Pane
 */

/**
 * @param {{ herdr: import('./composer.js').RunHerdr, readRecords: () => Promise<readonly unknown[]>, file: string, refreshMs: number, claudeCommand: string, trust: { looks: number, stepMs: number } }} deps
 *   readRecords — contents of ~/.claude/sessions/*.json; file — where the workspaces of sessions seen running are kept;
 *   refreshMs — herdr is asked at most this often; claudeCommand — what starts Claude Code in a new tab
 */
export function createHerdrView({ herdr, readRecords, file, refreshMs, claudeCommand, trust }) {
  /** A process's pane does not change while it runs: process-info is asked once for each Claude process. */
  /** @type {Map<number, string>} */
  const paneByPid = new Map();
  /** Claude Code processes in no pane — run in an IDE, a plain terminal: not looked for again on every look at herdr. */
  /** @type {Set<number>} */
  const outsideHerdr = new Set();
  /** Where every session seen running was — read from the file once, then kept here and written back. */
  /** @type {Promise<{ history: import('../public/model/history.js').History, writtenAt: number }> | undefined} */
  let kept;
  /** @type {{ at: number, view: Promise<HerdrView> } | undefined} */
  let latest;

  const keptHistory = () => {
    kept ??= readHistory(file).then((history) => ({ history, writtenAt: Date.now() }));
    return kept;
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
    const tabLabels = new Map(snapshot.tabs.map((tab) => [tab.id, tab.label]));
    const running = snapshot.panes.flatMap((pane) => {
      const session = sessionByPane.get(pane.paneId);
      const workspace = labels.get(pane.workspaceId);
      const tab = pane.tabId === undefined ? undefined : tabLabels.get(pane.tabId);
      return session === undefined || workspace === undefined ? [] : [{ session, workspace, tab, folder: pane.cwd }];
    });
    const store = await keptHistory();
    const now = Date.now();
    const { history, changed } = observed(store.history, running, now);
    store.history = history;
    // when running sessions were last seen is written now and then: a session closed meanwhile keeps a time near it
    if (!changed && (running.length === 0 || now - store.writtenAt < sightingsWriteMs)) return;
    store.writtenAt = now;
    await writeHistory(file, history);
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
   * be lost. Asked whether to trust the folder the user chose for it, it is answered yes, out of the reply's way.
   * @param {string} pane
   * @param {readonly string[]} options — after the command: --resume <session>
   * @returns {Promise<boolean>} — whether herdr took the keys
   */
  const startClaude = async (pane, options) => {
    for (let look = 0; look < shellLooks; look++) {
      const screen = await herdr(['pane', 'read', pane, '--source', 'visible', '--format', 'text']);
      if (screen.ok && screen.text.trim() !== '') break;
      await delay(shellStepMs);
    }
    const started = succeeded(await herdr(['pane', 'send-text', pane, [claudeCommand, ...options].join(' ')])) && succeeded(await herdr(['pane', 'send-keys', pane, 'enter']));
    if (started) void acceptTrust(herdr, pane, trust).catch(() => undefined); // herdr gone meanwhile: nothing to answer
    return started;
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
      const { history } = await keptHistory();
      const found = sessions.flatMap(({ id, cwd }) => {
        const label = history[id]?.workspace ?? (cwd === undefined ? undefined : view.byFolder.get(folderKey(cwd)));
        return label === undefined ? [] : [[id, label]];
      });
      return { herdr: true, sessions: Object.fromEntries(found) };
    },
    /**
     * A new tab beside one — in its workspace, in the folder of its pane — named, or numbered by herdr, with a shell, or
     * Claude Code started in it.
     * @param {string} besideTab
     * @param {import('../public/model/herdr.js').TabStart} start
     * @param {string | undefined} label
     * @returns {Promise<import('../public/model/herdr.js').NewTab>}
     */
    async createTab(besideTab, start, label) {
      const view = await currentView();
      const beside = view?.snapshot.panes.find((pane) => pane.tabId === besideTab);
      if (beside === undefined) return { ok: false, error: 'failed' };
      const reply = await herdr(['tab', 'create', '--workspace', beside.workspaceId, ...(beside.cwd === undefined ? [] : ['--cwd', beside.cwd])]);
      const pane = succeeded(reply) ? rootPaneOf(reply.json) : undefined;
      if (pane === undefined) return { ok: false, error: 'failed' };
      latest = undefined;
      const tab = succeeded(reply) ? tabOf(reply.json) : undefined;
      const name = label?.replace(/\s+/g, ' ').trim();
      if (tab !== undefined && name !== undefined && name !== '') await herdr(['tab', 'rename', tab, name]);
      if (start === 'claude' && !(await startClaude(pane, []))) return { ok: false, error: 'failed' };
      return { ok: true, target: `#/pane/${pane}` };
    },
    /**
     * A new workspace, named on one line, in a folder — ~ for the home folder — with a shell, or Claude Code started in it.
     * @param {string} label
     * @param {string} folder
     * @param {import('../public/model/herdr.js').TabStart} start
     * @returns {Promise<import('../public/model/herdr.js').NewWorkspace>}
     */
    async createWorkspace(label, folder, start) {
      const name = label.replace(/\s+/g, ' ').trim();
      if (name === '') return { ok: false, error: 'empty' };
      const cwd = folder.trim().replace(/^~(?=$|[\\/])/, homedir());
      const isFolder = isAbsolute(cwd) && (await stat(cwd).then((found) => found.isDirectory(), () => false));
      if (!isFolder) return { ok: false, error: 'no-folder' };
      const reply = await herdr(['workspace', 'create', '--label', name, '--cwd', cwd]);
      const pane = succeeded(reply) ? rootPaneOf(reply.json) : undefined;
      if (pane === undefined) return { ok: false, error: 'failed' };
      latest = undefined;
      if (start === 'claude' && !(await startClaude(pane, []))) return { ok: false, error: 'failed' };
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
    /**
     * A closed session opened again where it ran: a new tab of its workspace — the workspace opened again if it is gone,
     * or named after the folder for a session never seen in herdr — named as the tab was, in its folder, Claude Code
     * resuming it there. The page stays on the session's feed.
     * @param {string} sessionId
     * @param {string | undefined} cwd — the session's folder, as its transcript tells it
     * @returns {Promise<import('../public/model/herdr.js').NewTab>}
     */
    async reopen(sessionId, cwd) {
      const view = await currentView();
      const place = (await keptHistory()).history[sessionId];
      const folder = place?.folder ?? cwd;
      const label = place?.workspace ?? (folder === undefined ? undefined : folderName(folder));
      if (view === undefined || folder === undefined || label === undefined) return { ok: false, error: 'failed' };
      const workspace = view.snapshot.workspaces.find((known) => known.label === label);
      const reply = await herdr(workspace === undefined ? ['workspace', 'create', '--label', label, '--cwd', folder] : ['tab', 'create', '--workspace', workspace.id, '--cwd', folder]);
      const pane = succeeded(reply) ? rootPaneOf(reply.json) : undefined;
      if (pane === undefined) return { ok: false, error: 'failed' };
      latest = undefined;
      const tab = succeeded(reply) ? tabOf(reply.json) : undefined;
      // a tab nobody named went by its number, which the new tab has a new one of
      if (tab !== undefined && place?.tab !== undefined && !/^\d+$/.test(place.tab)) await herdr(['tab', 'rename', tab, place.tab]);
      if (!(await startClaude(pane, ['--resume', sessionId]))) return { ok: false, error: 'failed' };
      return { ok: true, target: `#/${sessionId}` };
    },
    /**
     * Where the sessions ran in herdr, the ones closed since included.
     * @returns {Promise<import('../public/model/history.js').History>}
     */
    async history() {
      await currentView();
      return (await keptHistory()).history;
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
 * The history kept in the file; a missing or broken file is an empty history — it is learned again from what runs.
 * Older viewers kept a session's workspace alone in the same file.
 * @param {string} file
 * @returns {Promise<import('../public/model/history.js').History>}
 */
async function readHistory(file) {
  const content = await readFile(file, 'utf8').catch(() => undefined);
  if (content === undefined) return {};
  try {
    return parseHistory(JSON.parse(content));
  } catch {
    return {}; // a corrupt file
  }
}

/**
 * @param {string} file
 * @param {import('../public/model/history.js').History} history
 */
async function writeHistory(file, history) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(history, undefined, 1)}\n`);
}

/** How often the last sightings of running sessions are written down. */
const sightingsWriteMs = 60_000;

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

/**
 * The tab a new tab or workspace opened with, as herdr tells it.
 * @param {unknown} json
 * @returns {string | undefined}
 */
function tabOf(json) {
  const result = isRecord(json) && isRecord(json.result) ? json.result : undefined;
  return result !== undefined && isRecord(result.tab) ? text(result.tab.tab_id) : undefined;
}

/**
 * The last part of a folder's path: what a workspace opened for it is named.
 * @param {string} folder
 * @returns {string | undefined}
 */
function folderName(folder) {
  return folder.split(/[\\/]/).filter((part) => part !== '').at(-1);
}
