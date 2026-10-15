// @ts-check
// What herdr shows, as the page needs it: which herdr workspace each session belongs to, for grouping and searching the
// session list.
//   ~/.claude/sessions/<pid>.json  → the process that has the session open
//   herdr pane process-info        → the pane that runs that process
//   Codex's threads open now       → the Codex pane that runs each (codex-live.js)
//   herdr api snapshot             → workspaces, their tabs and panes
// A session seen running keeps its workspace in a file after it ends; one never seen running is put into the workspace
// whose panes are open in its folder, if just one workspace has panes there.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isRecord, text } from '../public/model/narrow.js';
import { codexPanes } from './codex-live.js';
import { folderKey } from './folders.js';
import { foregroundPids, snapshotOf, succeeded } from './herdr.js';
import { latestRecords, processKey } from './registry.js';
import { acceptTrust } from './trust.js';
import { parseHistory } from '../public/model/history.js';
import { observed } from './session-history.js';

/**
 * @typedef {{ herdr: boolean, sessions: Record<string, string>, icons: Record<string, string> }} SessionWorkspaces — the
 *   /api/workspaces reply.
 *   herdr: whether herdr answers; without it the page shows no workspaces. sessions: the workspace's name, by session id
 * @typedef {{ snapshot: import('./herdr.js').HerdrSnapshot, sessionByPane: ReadonlyMap<string, string>, byFolder: ReadonlyMap<string, string>, icons: ReadonlyMap<string, string> } | undefined} HerdrView
 *   what herdr showed, the sessions running in its panes, the workspace of each folder, and each workspace's icon by
 *   its id; undefined: no herdr
 * @typedef {import('./herdr.js').Pane} Pane
 * @typedef {{ found: 'pane', pane: string, working: boolean } | { found: 'elsewhere' | 'none' }} CodexPlace — where a
 *   Codex session runs: in a herdr pane, its agent at work or not; elsewhere — Codex has it open outside herdr; none —
 *   closed
 */

/**
 * @param {{ herdr: import('./composer.js').RunHerdr, readRecords: () => Promise<readonly unknown[]>, codexThreads: () => Promise<readonly import('./codex-live.js').LiveThread[]>, icons: { iconsOf: (workspaces: readonly import('./workspace-icons.js').IconedWorkspace[]) => Promise<ReadonlyMap<string, string>>, setIcon: (folder: string, icon: string | undefined) => Promise<void> }, file: string, refreshMs: number, claudeCommand: string, codexCommand: string, trust: { looks: number, stepMs: number } }} deps
 *   readRecords — contents of ~/.claude/sessions/*.json; codexThreads — the threads Codex has open now; icons — each
 *   workspace's (workspace-icons.js); file — where the
 *   workspaces of sessions seen running are kept; refreshMs — herdr is asked at most this often; claudeCommand,
 *   codexCommand — what starts Claude Code, and Codex, in a new tab
 */
export function createHerdrView({ herdr, readRecords, codexThreads, icons, file, refreshMs, claudeCommand, codexCommand, trust }) {
  /**
   * A process's pane does not change while it runs: process-info is asked once for each Claude process — by its key
   * (registry.js): the number goes to another process once it is gone.
   * @type {Map<string, string>}
   */
  const paneByProcess = new Map();
  /**
   * Claude Code processes in no pane — run in an IDE, a plain terminal: not looked for again on every look at herdr, only
   * once herdr's Claude panes are other than those looked in — one told for Claude's later, as Claude starts in it.
   * @type {Map<string, string>} — the Claude panes looked in, by process
   */
  const outsideHerdr = new Map();
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
    const claudePanes = panes.filter((pane) => pane.agent === 'claude');
    const lookedIn = claudePanes.map((pane) => pane.paneId).join(' ');
    const unknown = records.filter((record) => !paneByProcess.has(processKey(record)) && outsideHerdr.get(processKey(record)) !== lookedIn);
    if (unknown.length > 0 && (await findPanes(claudePanes, unknown))) {
      for (const record of unknown) if (!paneByProcess.has(processKey(record))) outsideHerdr.set(processKey(record), lookedIn);
    }
    const shown = new Set(panes.map((pane) => pane.paneId));
    return new Map(
      records.flatMap((record) => {
        const pane = paneByProcess.get(processKey(record));
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

  /**
   * The panes of these processes, among herdr's Claude panes.
   * @param {readonly Pane[]} claudePanes
   * @param {readonly import('./registry.js').LiveRecord[]} records
   * @returns {Promise<boolean>} — whether every pane told its processes: one that did not may hold one of them
   */
  const findPanes = async (claudePanes, records) => {
    let told = true;
    for (const pane of claudePanes) {
      const info = await herdr(['pane', 'process-info', '--pane', pane.paneId]);
      if (!succeeded(info)) told = false;
      else for (const record of records) if (foregroundPids(info.json).includes(record.pid)) paneByProcess.set(processKey(record), pane.paneId);
    }
    return told;
  };

  /** @returns {Promise<HerdrView>} */
  const lookAtHerdr = async () => {
    const reply = await herdr(['api', 'snapshot']);
    const snapshot = succeeded(reply) ? snapshotOf(reply.json) : undefined;
    if (snapshot === undefined) return undefined;
    const claude = await runningSessions(snapshot.panes);
    // Codex's threads are looked at only while a pane runs Codex
    const codex = snapshot.panes.some((pane) => pane.agent === 'codex') ? codexPanes(snapshot.panes, await codexThreads()) : new Map();
    const sessionByPane = new Map([...claude, ...codex]);
    await rememberRunning(snapshot, sessionByPane);
    const iconed = await icons.iconsOf(snapshot.workspaces.map((workspace) => ({ id: workspace.id, label: workspace.label, folder: workspaceFolder(snapshot, workspace.id) })));
    return { snapshot, sessionByPane, byFolder: workspaceByFolder(snapshot.panes, workspaceLabels(snapshot)), icons: iconed };
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
   * Claude Code, or Codex, in a new tab's shell: its command typed once the shell shows its prompt — what is typed before
   * it may be lost. Claude Code asked whether to trust the folder the user chose for it is answered yes, out of the
   * reply's way.
   * @param {string} pane
   * @param {import('../public/model/composer.js').Agent} agent
   * @param {string | undefined} resumed — the session it goes on with
   * @returns {Promise<boolean>} — whether herdr took the keys
   */
  const startAgent = async (pane, agent, resumed) => {
    for (let look = 0; look < shellLooks; look++) {
      const screen = await herdr(['pane', 'read', pane, '--source', 'visible', '--format', 'text']);
      if (screen.ok && screen.text.trim() !== '') break;
      await delay(shellStepMs);
    }
    const command = agent === 'claude' ? [claudeCommand, ...(resumed === undefined ? [] : ['--resume', resumed])] : [codexCommand, ...(resumed === undefined ? [] : ['resume', resumed])];
    const started = succeeded(await herdr(['pane', 'send-text', pane, command.join(' ')])) && succeeded(await herdr(['pane', 'send-keys', pane, 'enter']));
    if (started && agent === 'claude') void acceptTrust(herdr, pane, trust).catch(() => undefined); // herdr gone meanwhile: nothing to answer
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
      if (view === undefined) return { herdr: false, sessions: {}, icons: {} };
      const { history } = await keptHistory();
      const found = sessions.flatMap(({ id, cwd }) => {
        const label = history[id]?.workspace ?? (cwd === undefined ? undefined : view.byFolder.get(folderKey(cwd)));
        return label === undefined ? [] : [/** @type {const} */ ([id, label])];
      });
      // a session's icon is its workspace's, while the workspace is open
      const iconByLabel = new Map(view.snapshot.workspaces.flatMap((workspace) => {
        const icon = view.icons.get(workspace.id);
        return icon === undefined ? [] : [/** @type {const} */ ([workspace.label, icon])];
      }));
      const iconed = found.flatMap(([id, label]) => {
        const icon = iconByLabel.get(label);
        return icon === undefined ? [] : [/** @type {const} */ ([id, icon])];
      });
      return { herdr: true, sessions: Object.fromEntries(found), icons: Object.fromEntries(iconed) };
    },
    /**
     * A new tab beside one — in its workspace, in the folder of its pane — named, or numbered by herdr, with a shell, or
     * Claude Code or Codex started in it.
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
      if (start !== 'shell' && !(await startAgent(pane, start, undefined))) return { ok: false, error: 'failed' };
      return { ok: true, target: `#/pane/${pane}` };
    },
    /**
     * A new workspace, named on one line, in a folder — ~ for the home folder — with a shell, or Claude Code or Codex
     * started in it.
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
      if (start !== 'shell' && !(await startAgent(pane, start, undefined))) return { ok: false, error: 'failed' };
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
     * Names a workspace, as herdr's own rename does.
     * @param {string} workspaceId
     * @param {string} label
     * @returns {Promise<import('../public/model/herdr.js').TabChange>}
     */
    async renameWorkspace(workspaceId, label) {
      // a workspace's name is one line
      const name = label.replace(/\s+/g, ' ').trim();
      if (name === '') return { ok: false, error: 'empty' };
      return changed(await herdr(['workspace', 'rename', workspaceId, name]));
    },
    /**
     * A workspace's icon picked by hand — one its name cannot hold, Lucide's — kept for its folder, or taken back.
     * @param {string} workspaceId
     * @param {string | undefined} icon — as kept (model/icon-choice.js); none: one at random again
     * @returns {Promise<import('../public/model/herdr.js').TabChange>}
     */
    async setWorkspaceIcon(workspaceId, icon) {
      const view = await currentView();
      const folder = view === undefined ? undefined : workspaceFolder(view.snapshot, workspaceId);
      if (folder === undefined) return { ok: false, error: 'failed' };
      await icons.setIcon(folder, icon);
      latest = undefined;
      return { ok: true };
    },
    /**
     * Closes a workspace with its tabs: what runs in them stops — Claude Code sessions can be resumed, their
     * transcripts stay.
     * @param {string} workspaceId
     * @returns {Promise<import('../public/model/herdr.js').TabChange>}
     */
    async closeWorkspace(workspaceId) {
      return changed(await herdr(['workspace', 'close', workspaceId]));
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
     * or named after the folder for a session never seen in herdr — named as the tab was, in its folder, Claude Code —
     * or Codex — resuming it there. The page stays on the session's feed.
     * @param {string} sessionId
     * @param {string | undefined} cwd — the session's folder, as its transcript tells it
     * @param {import('../public/model/composer.js').Agent} agent — whose session
     * @returns {Promise<import('../public/model/herdr.js').NewTab>}
     */
    async reopen(sessionId, cwd, agent) {
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
      if (!(await startAgent(pane, agent, sessionId))) return { ok: false, error: 'failed' };
      return { ok: true, target: `#/${sessionId}` };
    },
    /**
     * Where the sessions ran in herdr, the ones closed since included. An open session's place leaves out when it was
     * last seen — it is seen now: the reply stays the same while nothing changes, and the page's poll of it comes back
     * as 304.
     * @returns {Promise<import('../public/model/history.js').History>}
     */
    async history() {
      await currentView();
      const { history } = await keptHistory();
      return Object.fromEntries(Object.entries(history).map(([session, place]) => [session, place.open ? { ...place, lastSeen: undefined } : place]));
    },
    /**
     * Where a Codex session runs, for the composer to type into it.
     * @param {string} sessionId
     * @returns {Promise<CodexPlace>}
     */
    async codexPlace(sessionId) {
      const view = await currentView();
      const pane = view?.snapshot.panes.find((one) => view.sessionByPane.get(one.paneId) === sessionId);
      if (pane !== undefined) return { found: 'pane', pane: pane.paneId, working: pane.status === 'working' };
      return (await codexThreads()).some((thread) => thread.id === sessionId) ? { found: 'elsewhere' } : { found: 'none' };
    },
    /** @returns {Promise<import('../public/model/herdr.js').HerdrLayout>} */
    async layout() {
      const view = await currentView();
      return view === undefined ? { herdr: false, workspaces: [] } : { herdr: true, workspaces: layoutOf(view.snapshot, view.sessionByPane, view.icons) };
    },
  };
}

/**
 * herdr's workspaces and tabs in its own order — by their numbers — with the panes in each tab.
 * @param {import('./herdr.js').HerdrSnapshot} snapshot
 * @param {ReadonlyMap<string, string>} sessionByPane
 * @param {ReadonlyMap<string, string>} icons — by workspace id
 * @returns {import('../public/model/herdr.js').HerdrWorkspace[]}
 */
function layoutOf(snapshot, sessionByPane, icons) {
  const byNumber = (/** @type {{ number: number }} */ a, /** @type {{ number: number }} */ b) => a.number - b.number;
  return [...snapshot.workspaces].sort(byNumber).map((workspace) => ({
    id: workspace.id,
    number: workspace.number,
    label: workspace.label,
    ...(icons.has(workspace.id) ? { icon: icons.get(workspace.id) } : {}),
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
 * A workspace's folder: the one most of its panes are in — a tab may be opened elsewhere by the way — as its first such
 * pane writes it; even, the one its first tab's pane is in, panes of no tab after; none without a pane.
 * @param {import('./herdr.js').HerdrSnapshot} snapshot
 * @param {string} workspaceId
 * @returns {string | undefined}
 */
function workspaceFolder(snapshot, workspaceId) {
  const tabNumbers = new Map(snapshot.tabs.map((tab) => [tab.id, tab.number]));
  const order = (/** @type {Pane} */ pane) => (pane.tabId === undefined ? Infinity : (tabNumbers.get(pane.tabId) ?? Infinity));
  const panes = snapshot.panes.filter((pane) => pane.workspaceId === workspaceId && pane.cwd !== undefined).sort((a, b) => order(a) - order(b));
  /** @type {Map<string, { cwd: string, count: number }>} — in the order first met */
  const byFolder = new Map();
  for (const pane of panes) {
    if (pane.cwd === undefined) continue;
    const key = folderKey(pane.cwd);
    const known = byFolder.get(key);
    byFolder.set(key, { cwd: known?.cwd ?? pane.cwd, count: (known?.count ?? 0) + 1 });
  }
  let most;
  for (const folder of byFolder.values()) if (most === undefined || folder.count > most.count) most = folder;
  return most?.cwd;
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
