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
import { agyPanes } from './agy-live.js';
import { codexPanes } from './codex-live.js';
import { folderKey } from './folders.js';
import { foregroundPids, forkedFrom, overShell, shellAtPrompt, snapshotOf, succeeded } from './herdr.js';
import { latestRecords, processKey } from './registry.js';
import { acceptTrust } from './trust.js';
import { parseHistory, tabToContinue } from '../public/model/history.js';
import { observed } from './session-history.js';

/**
 * @typedef {{ herdr: boolean, sessions: Record<string, string>, icons: Record<string, string> }} SessionWorkspaces — the
 *   /api/workspaces reply.
 *   herdr: whether herdr answers; without it the page shows no workspaces. sessions: the workspace's name, by session id
 * @typedef {{ snapshot: import('./herdr.js').HerdrSnapshot, sessionByPane: ReadonlyMap<string, string>, byFolder: ReadonlyMap<string, string>, icons: ReadonlyMap<string, string>, hidden: ReadonlySet<string>, hiddenWorkspaces: ReadonlySet<string> } | undefined} HerdrView
 *   what herdr showed, the sessions running in its panes, the workspace of each folder, and each workspace's icon by
 *   its id; the panes hidden from the page's list, and the workspaces, by their ids; undefined: no herdr
 * @typedef {import('./herdr.js').Pane} Pane
 * @typedef {{ found: 'pane', pane: string, working: boolean } | { found: 'elsewhere' | 'none' }} AgentPlace — where a
 *   Codex session runs, an agy conversation: in a herdr pane, its agent at work or not; elsewhere — the agent has it
 *   open outside herdr, or in a pane not told apart; none — closed
 * @typedef {{ name: string, value: string }} ShellVariable — set for a command typed into a shell: a name and value
 *   no shell reads otherwise than as written
 * @typedef {{ env: readonly ShellVariable[], shell: 'powershell' | 'posix', endProcess: (pid: number) => Promise<boolean> }} Restarting
 *   — how a session is restarted: env — the variables its agent starts again with; shell — the panes' shell, which
 *   sets them its way; endProcess — a process ended, true once it is gone
 * @typedef {{ launcher: 'claude' | 'claude-gpt', at: number }} Launch — a Claude Code session started by the viewer: in
 *   ordinary Claude Code or through GPT, and when, in ms
 */

/** A viewer told nothing of restarting: no process of its is ended, so no session restarts. */
/** @type {Restarting} */
const noRestarting = { env: [], shell: 'posix', endProcess: async () => false };

/**
 * @param {{ herdr: import('./composer.js').RunHerdr, readRecords: () => Promise<readonly unknown[]>, codexThreads: () => Promise<readonly import('./codex-live.js').LiveThread[]>, icons: { iconsOf: (workspaces: readonly import('./workspace-icons.js').IconedWorkspace[]) => Promise<ReadonlyMap<string, string>>, setIcon: (folder: string, icon: string | undefined) => Promise<void> }, hidden: ReturnType<typeof import('./hidden-panes.js').createHiddenPanes>, hiddenWorkspaces: ReturnType<typeof import('./hidden-workspaces.js').createHiddenWorkspaces>, file: string, refreshMs: number, claudeCommand: string, claudeGptCommand?: string | undefined, claudeModelOf?: ((session: string) => Promise<import('./claude-model.js').LastAnswer | undefined>) | undefined, codexCommand: string, agyCommand?: string | undefined, agyRuns?: () => Promise<readonly import('./agy-live.js').AgyRun[]>, trust: { looks: number, stepMs: number }, restart?: Restarting }} deps
 *   readRecords — contents of ~/.claude/sessions/*.json; codexThreads — the threads Codex has open now; agyRuns — agy's
 *   processes alive now (agy-live.js), none told — no agy; icons — each
 *   workspace's (workspace-icons.js); hidden — the panes hidden from the page's list (hidden-panes.js);
 *   hiddenWorkspaces — the workspaces hidden from it, by their ids (hidden-workspaces.js); file — where the
 *   workspaces of sessions seen running are kept; refreshMs — herdr is asked at most this often; claudeCommand,
 *   codexCommand, agyCommand — what starts Claude Code, Codex and Antigravity CLI in a new tab — none, no agy;
 *   restart — how a session is restarted where it runs
 */
export function createHerdrView({ herdr, readRecords, codexThreads, icons, hidden, hiddenWorkspaces, file, refreshMs, claudeCommand, claudeGptCommand, claudeModelOf = async () => undefined, codexCommand, agyCommand, agyRuns = async () => [], trust, restart = noRestarting }) {
  /**
   * A process's pane does not change while it runs: process-info is asked once for each Claude process — by its key
   * (registry.js): the number goes to another process once it is gone.
   * @type {Map<string, string>}
   */
  const paneByProcess = new Map();
  /**
   * The session a Claude process goes on from as a fork — a tab duplicated from the page — read off its command line as
   * its pane is found, by the process's key.
   * @type {Map<string, string>}
   */
  const forkedByProcess = new Map();
  /**
   * Claude Code processes in no pane — run in an IDE, a plain terminal: not looked for again on every look at herdr, only
   * once herdr's Claude panes are other than those looked in — one told for Claude's later, as Claude starts in it.
   * @type {Map<string, string>} — the Claude panes looked in, by process
   */
  const outsideHerdr = new Map();
  /** New GPT panes not yet associated with a session in Claude Code's registry. @type {Set<string>} */
  const gptPanes = new Set();
  /**
   * The launcher each session the viewer resumed was last started in, and when: it runs there — until it answers again,
   * which tells it anew.
   * @type {Map<string, Launch>}
   */
  const launches = new Map();
  /**
   * When the page started Codex in a pane, ms, by pane id: before its first message Codex's thread names no folder,
   * and the pane runs the first one made after it started (codex-live.js).
   * @type {Map<string, number>}
   */
  const codexStarts = new Map();
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
    const store = await keptHistory();
    const labels = workspaceLabels(snapshot);
    const tabLabels = new Map(snapshot.tabs.map((tab) => [tab.id, tab.label]));
    const sightings = await Promise.all(snapshot.panes.map(async (pane) => {
      const session = sessionByPane.get(pane.paneId);
      const workspace = labels.get(pane.workspaceId);
      const tab = pane.tabId === undefined ? undefined : tabLabels.get(pane.tabId);
      if (session === undefined || workspace === undefined) return undefined;
      // through GPT or not as the launch or the answer tells it; neither telling, the history keeps what it knew
      const gpt = pane.agent !== 'claude' || claudeGptCommand === undefined ? undefined : gptPanes.delete(pane.paneId) ? true : throughGptNow(await claudeModelOf(session), launches.get(session));
      return { session, workspace, tab, terminal: pane.terminal, folder: pane.cwd, ...(gpt === undefined ? {} : { claudeGpt: gpt }) };
    }));
    const running = sightings.filter((sighting) => sighting !== undefined);
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
      else {
        for (const record of records.filter((one) => foregroundPids(info.json).includes(one.pid))) {
          paneByProcess.set(processKey(record), pane.paneId);
          const parent = forkedFrom(info.json, record.pid);
          if (parent !== undefined) forkedByProcess.set(processKey(record), parent);
        }
      }
    }
    return told;
  };

  /**
   * The processes herdr told in each agy pane, by pane id: asked once for a pane while they hold an agy run's process —
   * a pane's process does not change while it runs — and asked again once they hold none: agy not logged its run yet,
   * quit there, or started anew.
   * @type {Map<string, readonly number[]>}
   */
  const agyProcessesTold = new Map();

  /**
   * The processes in the agy panes, for agy's runs to be told apart by them (agy-live.js agyPanes).
   * @param {readonly Pane[]} panes
   * @param {readonly import('./agy-live.js').AgyRun[]} runs
   * @returns {Promise<ReadonlyMap<string, readonly number[]>>}
   */
  const agyProcessesIn = async (panes, runs) => {
    const agyOnes = panes.filter((pane) => pane.agent === 'agy');
    for (const pane of agyProcessesTold.keys()) if (!agyOnes.some((one) => one.paneId === pane)) agyProcessesTold.delete(pane);
    for (const pane of agyOnes) {
      const known = agyProcessesTold.get(pane.paneId);
      if (known !== undefined && runs.some((run) => known.includes(run.serverPid))) continue;
      const info = await herdr(['pane', 'process-info', '--pane', pane.paneId]);
      if (succeeded(info)) agyProcessesTold.set(pane.paneId, foregroundPids(info.json));
    }
    return agyProcessesTold;
  };

  /**
   * What the agy panes run, told apart by their processes.
   * @param {readonly Pane[]} panes
   */
  const agyPanesNow = async (panes) => {
    const runs = await agyRuns();
    return agyPanes(panes, runs, await agyProcessesIn(panes, runs));
  };

  /** @returns {Promise<HerdrView>} */
  const lookAtHerdr = async () => {
    const reply = await herdr(['api', 'snapshot']);
    const snapshot = succeeded(reply) ? snapshotOf(reply.json) : undefined;
    if (snapshot === undefined) return undefined;
    const claude = await runningSessions(snapshot.panes);
    // Codex's threads are looked at only while a pane runs Codex; agy's runs, while one runs agy
    // a pane gone forgets when Codex was started in it
    for (const pane of codexStarts.keys()) if (!snapshot.panes.some((one) => one.paneId === pane)) codexStarts.delete(pane);
    const codex = snapshot.panes.some((pane) => pane.agent === 'codex') ? codexPanes(snapshot.panes, await codexThreads(), codexStarts) : new Map();
    const agy = snapshot.panes.some((pane) => pane.agent === 'agy') ? await agyPanesNow(snapshot.panes) : { conversations: new Map(), started: new Map() };
    const sessions = new Map([...claude, ...codex, ...agy.conversations]);
    // an agy run before its first message shows by its own id, which no tab goes on with: agy makes the conversation
    await rememberRunning(snapshot, sessions);
    const sessionByPane = new Map([...sessions, ...agy.started]);
    const iconed = await icons.iconsOf(snapshot.workspaces.map((workspace) => ({ id: workspace.id, label: workspace.label, folder: workspaceFolder(snapshot, workspace.id) })));
    const hiddenIds = await hiddenWorkspaces.hiddenAmong(snapshot.workspaces.map((workspace) => workspace.id));
    return { snapshot, sessionByPane, byFolder: workspaceByFolder(snapshot.panes, workspaceLabels(snapshot)), icons: iconed, hidden: await hidden.hiddenAmong(snapshot.panes), hiddenWorkspaces: hiddenIds };
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
   * Claude Code, Codex or Antigravity CLI in a new tab's shell: its command typed once the shell shows its prompt — what is typed before
   * it may be lost. Claude Code asked whether to trust the folder the user chose for it is answered yes, out of the
   * reply's way.
   * @param {string} pane
   * @param {Exclude<import('../public/model/herdr.js').TabStart, 'shell'>} agent
   * @param {GoOn | undefined} goOn — the session it goes on with: resumed, or forked into a new one; none for a new session
   * @param {string} [ahead] - typed ahead of the command in the same line: the variables it starts with
   * @param {'as-it-ran' | 'as-asked'} [launcher] - as-it-ran: ordinary Claude Code starts through GPT if the session it
   *   goes on with ran so; as-asked: it starts in ordinary Claude Code all the same
   * @returns {Promise<boolean>} — whether herdr took the keys
   */
  const startAgent = async (pane, agent, goOn, ahead = '', launcher = 'as-it-ran') => {
    const claude = agent === 'claude' || agent === 'claude-gpt';
    const answer = claude && goOn !== undefined ? await claudeModelOf(goOn.session) : undefined;
    const gptModel = answer !== undefined && isGptModel(answer.model) ? answer.model : undefined;
    // the session it goes on with ran through GPT as its launch or its answer tells — neither telling, as the history does
    const told = goOn === undefined ? undefined : throughGptNow(answer, launches.get(goOn.session));
    const ranThroughGpt = told === undefined ? goOn !== undefined && (await keptHistory()).history[goOn.session]?.claudeGpt === true : told;
    const gpt = agent === 'claude-gpt' || (agent === 'claude' && launcher === 'as-it-ran' && ranThroughGpt);
    const startCommand = agent === 'codex' ? codexCommand : agent === 'agy' ? agyCommand : gpt ? claudeGptCommand : claudeCommand;
    if (startCommand === undefined) return false;
    for (let look = 0; look < shellLooks; look++) {
      const screen = await herdr(['pane', 'read', pane, '--source', 'visible', '--format', 'text']);
      if (screen.ok && screen.text.trim() !== '') break;
      await delay(shellStepMs);
    }
    const goingOn = agent === 'codex' ? codexGoingOn(goOn) : agent === 'agy' ? agyGoingOn(goOn) : claudeGoingOn(goOn);
    const command = [startCommand, ...goingOn, ...(gpt && gptModel !== undefined ? ['--model', gptModel] : [])];
    const startedAt = Date.now();
    const started = succeeded(await herdr(['pane', 'send-text', pane, `${ahead}${command.join(' ')}`])) && succeeded(await herdr(['pane', 'send-keys', pane, 'enter']));
    if (started && gpt) gptPanes.add(pane);
    if (started && agent === 'codex') codexStarts.set(pane, startedAt);
    if (started && claude && goOn?.as === 'resume') launches.set(goOn.session, { launcher: gpt ? 'claude-gpt' : 'claude', at: Date.now() });
    if (started && claude) void acceptTrust(herdr, pane, trust).catch(() => undefined); // herdr gone meanwhile: nothing to answer
    return started;
  };

  /** Pages that ask at once, or within refreshMs, share one look at herdr. */
  const currentView = () => {
    if (latest === undefined || Date.now() - latest.at >= refreshMs) latest = { at: Date.now(), view: lookAtHerdr() };
    return latest.view;
  };

  return {
    /**
     * The session this one goes on from as a fork of it, while it runs in a pane — a tab duplicated from the page: until
     * its first new message Claude Code keeps its conversation in that one's transcript alone. None for any other session.
     * @param {string} sessionId
     * @returns {Promise<string | undefined>}
     */
    async forkedFrom(sessionId) {
      const record = latestRecords(await readRecords()).get(sessionId);
      return record === undefined ? undefined : forkedByProcess.get(processKey(record));
    },
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
     * A copy of a tab: a new tab in its workspace and folder, named "<its name>::<the first number not taken>" — a copy
     * of a copy counted on from the same name — with the session in it forked: Claude Code resumes it as a new session of
     * its own, Codex forks its thread; a tab with no session gets a shell. The page goes to the new tab.
     * @param {string} tabId
     * @returns {Promise<import('../public/model/herdr.js').NewTab>}
     */
    async duplicateTab(tabId) {
      const view = await currentView();
      const tab = view?.snapshot.tabs.find((known) => known.id === tabId);
      const panes = view?.snapshot.panes.filter((pane) => pane.tabId === tabId) ?? [];
      const source = panes.find((pane) => view?.sessionByPane.has(pane.paneId)) ?? panes[0];
      if (view === undefined || tab === undefined || source === undefined) return { ok: false, error: 'failed' };
      const forked = forkOf(source, view.sessionByPane.get(source.paneId));
      // a session's id is typed into a shell: one that is no id is not
      if (forked === 'not-an-id') return { ok: false, error: 'failed' };
      const reply = await herdr(['tab', 'create', '--workspace', source.workspaceId, ...(source.cwd === undefined ? [] : ['--cwd', source.cwd])]);
      const pane = succeeded(reply) ? rootPaneOf(reply.json) : undefined;
      if (pane === undefined) return { ok: false, error: 'failed' };
      latest = undefined;
      const created = succeeded(reply) ? tabOf(reply.json) : undefined;
      const names = view.snapshot.tabs.filter((known) => known.workspaceId === source.workspaceId).map((known) => known.label);
      if (created !== undefined) await herdr(['tab', 'rename', created, copyName(tab.label, names)]);
      if (forked !== undefined && !(await startAgent(pane, forked.agent, { session: forked.session, as: 'fork' }))) return { ok: false, error: 'failed' };
      return { ok: true, target: `#/pane/${pane}` };
    },
    /**
     * A new workspace, named on one line, in a folder — ~ for the home folder — with a shell, or Claude Code or Codex
     * started in it. A folder that is not there is made first when asked, with the folders above it.
     * @param {string} label
     * @param {string} folder
     * @param {import('../public/model/herdr.js').TabStart} start
     * @param {import('../public/model/herdr.js').MissingFolder} missing
     * @returns {Promise<import('../public/model/herdr.js').NewWorkspace>}
     */
    async createWorkspace(label, folder, start, missing) {
      const name = label.replace(/\s+/g, ' ').trim();
      if (name === '') return { ok: false, error: 'empty' };
      const cwd = folder.trim().replace(/^~(?=$|[\\/])/, homedir());
      const isFolder = isAbsolute(cwd) && (await stat(cwd).then((found) => found.isDirectory(), () => false));
      if (!isFolder && (missing === 'refuse' || !isAbsolute(cwd))) return { ok: false, error: 'no-folder' };
      if (!isFolder && !(await mkdir(cwd, { recursive: true }).then(() => true, () => false))) return { ok: false, error: 'not-created' };
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
     * Moves a tab among its workspace's tabs, as herdr does when one is dragged in its own bar.
     * @param {string} tabId
     * @param {number} place — between the tabs as they stand: 0 before the first, their count after the last
     * @returns {Promise<import('../public/model/herdr.js').TabChange>}
     */
    async moveTab(tabId, place) {
      return changed(await herdr(['tab', 'move', tabId, String(place)]));
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
     * Hides a workspace from the page's list — that one alone, kept by its id — until shown again.
     * @param {string} workspaceId
     * @returns {Promise<import('../public/model/herdr.js').TabChange>}
     */
    async hideWorkspace(workspaceId) {
      const view = await currentView();
      if (view?.snapshot.workspaces.some((workspace) => workspace.id === workspaceId) !== true) return { ok: false, error: 'failed' };
      await hiddenWorkspaces.hide(workspaceId);
      latest = undefined;
      return { ok: true };
    },
    /**
     * Shows a hidden workspace in the page's list again.
     * @param {string} workspaceId
     * @returns {Promise<import('../public/model/herdr.js').TabChange>}
     */
    async showWorkspace(workspaceId) {
      const view = await currentView();
      if (view?.snapshot.workspaces.some((workspace) => workspace.id === workspaceId) !== true) return { ok: false, error: 'failed' };
      await hiddenWorkspaces.show(workspaceId);
      latest = undefined;
      return { ok: true };
    },
    /**
     * Hides a pane's session from the page's list until its agent changes state.
     * @param {string} paneId
     * @returns {Promise<import('../public/model/herdr.js').TabChange>}
     */
    async hidePane(paneId) {
      const view = await currentView();
      const pane = view?.snapshot.panes.find((one) => one.paneId === paneId);
      if (pane === undefined) return { ok: false, error: 'failed' };
      await hidden.hide(pane.paneId, pane.activity);
      latest = undefined;
      return { ok: true };
    },
    /**
     * Shows every pane hidden again, before its agent changes state.
     * @returns {Promise<import('../public/model/herdr.js').TabChange>}
     */
    async showHidden() {
      await hidden.showAll();
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
     * Takes herdr to a tab — its workspace with it — as a click on it in herdr would.
     * @param {string} tabId
     * @returns {Promise<import('../public/model/herdr.js').TabChange>}
     */
    async focusTab(tabId) {
      return changed(await herdr(['tab', 'focus', tabId]));
    },
    /**
     * A Claude Code session restarted where it runs: its process ended — its turn and its background commands with it —
     * and Claude Code started again in its tab resuming it, the variables given (--restart-env) set ahead of it, or
     * none; in the launcher it ran in, or in the one asked — ordinary Claude Code, or Claude Code through GPT. A session
     * running in no herdr tab, or whose process did not end, is not: nothing is typed over a Claude Code still there.
     * @param {string} sessionId
     * @param {'given' | 'none'} variables — those given set ahead of Claude Code, or none: a plain restart
     * @param {import('../public/model/herdr.js').RestartLauncher} launcher
     * @returns {Promise<import('../public/model/herdr.js').TabChange>}
     */
    async restart(sessionId, variables, launcher) {
      const view = await currentView();
      const pane = view?.snapshot.panes.find((one) => one.agent === 'claude' && view.sessionByPane.get(one.paneId) === sessionId);
      const record = latestRecords(await readRecords()).get(sessionId);
      // a session's id is typed into a shell: one that is no id is not
      if (pane === undefined || record === undefined || !sessionIdPattern.test(sessionId)) return { ok: false, error: 'failed' };
      if (!(await restart.endProcess(record.pid))) return { ok: false, error: 'failed' };
      latest = undefined;
      // the shell is back once Claude Code is gone: what is typed meanwhile waits for it
      await delay(shellStepMs);
      const ahead = shellVariables(variables === 'given' ? restart.env : [], restart.shell);
      const started = await startAgent(pane.paneId, launcher === 'claude-gpt' ? 'claude-gpt' : 'claude', { session: sessionId, as: 'resume' }, ahead, launcher === 'as-it-ran' ? 'as-it-ran' : 'as-asked');
      return started ? { ok: true } : { ok: false, error: 'failed' };
    },
    /**
     * A session's agent quit to its tab's shell: what runs over the shell — Claude Code, or Codex — ends, its turn and
     * its background commands with it; the tab stays, at its shell's prompt. A session in no herdr tab, or a pane whose
     * shell herdr does not tell, is not touched.
     * @param {string} sessionId
     * @returns {Promise<import('../public/model/herdr.js').TabChange>}
     */
    async exit(sessionId) {
      const view = await currentView();
      const pane = view?.snapshot.panes.find((one) => view.sessionByPane.get(one.paneId) === sessionId);
      if (pane === undefined) return { ok: false, error: 'failed' };
      const info = await herdr(['pane', 'process-info', '--pane', pane.paneId]);
      const running = succeeded(info) ? overShell(info.json) : [];
      if (running.length === 0) return { ok: false, error: 'failed' };
      latest = undefined;
      for (const pid of running) if (!(await restart.endProcess(pid))) return { ok: false, error: 'failed' };
      return { ok: true };
    },
    /**
     * A closed session opened again where it ran: a new tab of its workspace — the workspace opened again if it is gone,
     * or named after the folder for a session never seen in herdr — named as the tab was, or as a copy of it while it is
     * open, in its folder, Claude Code — or Codex — resuming it there. The page stays on the session's feed.
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
      const names = view.snapshot.tabs.filter((known) => known.workspaceId === workspace?.id).map((known) => known.label);
      // a tab nobody named went by its number, which the new tab has a new one of; one still open — another conversation
      // going on in it — is copied
      if (tab !== undefined && place?.tab !== undefined && !/^\d+$/.test(place.tab)) await herdr(['tab', 'rename', tab, names.includes(place.tab) ? copyName(place.tab, names) : place.tab]);
      if (!(await startAgent(pane, agent, { session: sessionId, as: 'resume' }))) return { ok: false, error: 'failed' };
      return { ok: true, target: `#/${sessionId}` };
    },
    /**
     * A tab with nothing running in it — its shell at its prompt, as herdr brings tabs back after a restart of the
     * computer — goes on with the conversation that ran last in it (model/history.js): Claude Code resumes it there,
     * through GPT when it ran so, or Codex does, or agy; a tab the history does not know goes on with its folder's latest
     * Claude Code conversation, as claude --continue would, resumed by its id. Nothing is typed into a tab where
     * something runs, nor is a conversation Claude Code or agy runs anywhere now started twice.
     * @param {string} tabId
     * @param {readonly Pick<import('./sessions.js').SessionInfo, 'id' | 'agent' | 'cwd' | 'kind' | 'modifiedAt'>[]} sessions
     *   — the session list: whose each session is, and the folder's latest
     * @returns {Promise<import('../public/model/herdr.js').TabChange>}
     */
    async continueTab(tabId, sessions) {
      const view = await currentView();
      if (view === undefined) return { ok: false, error: 'failed' };
      const tab = view.snapshot.tabs.find((known) => known.id === tabId);
      const workspace = tab === undefined ? undefined : workspaceLabels(view.snapshot).get(tab.workspaceId);
      const panes = view.snapshot.panes.filter((pane) => pane.tabId === tabId);
      const [pane] = panes;
      if (tab === undefined || workspace === undefined || pane === undefined) return { ok: false, error: 'failed' };
      const next = tabToContinue((await keptHistory()).history, sessions, { workspace, tab: tab.label, folder: pane.cwd });
      if (next.kind === 'running' || next.kind === 'none') return { ok: false, error: 'failed' };
      const session = next.session;
      // a session's id is typed into a shell: one that is no id is not
      if (!sessionIdPattern.test(session) || latestRecords(await readRecords()).has(session)) return { ok: false, error: 'failed' };
      if ((await agyRuns()).some((run) => run.conversation === session)) return { ok: false, error: 'failed' };
      for (const one of panes) {
        const info = await herdr(['pane', 'process-info', '--pane', one.paneId]);
        if (!succeeded(info) || !shellAtPrompt(info.json)) return { ok: false, error: 'failed' };
      }
      latest = undefined;
      const agent = sessions.find((listed) => listed.id === session)?.agent ?? 'claude';
      return (await startAgent(pane.paneId, agent, { session, as: 'resume' })) ? { ok: true } : { ok: false, error: 'failed' };
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
     * @returns {Promise<AgentPlace>}
     */
    async codexPlace(sessionId) {
      const view = await currentView();
      const pane = view?.snapshot.panes.find((one) => one.agent === 'codex' && view.sessionByPane.get(one.paneId) === sessionId);
      if (pane !== undefined) return { found: 'pane', pane: pane.paneId, working: pane.status === 'working' };
      return (await codexThreads()).some((thread) => thread.id === sessionId) ? { found: 'elsewhere' } : { found: 'none' };
    },
    /**
     * Where agy runs a conversation, for the composer to type into it: in its pane; elsewhere — a program's run, a pane
     * not told apart from another agy's in its folder; or closed.
     * @param {string} sessionId
     * @returns {Promise<AgentPlace>}
     */
    async agyPlace(sessionId) {
      const view = await currentView();
      const pane = view?.snapshot.panes.find((one) => one.agent === 'agy' && view.sessionByPane.get(one.paneId) === sessionId);
      if (pane !== undefined) return { found: 'pane', pane: pane.paneId, working: pane.status === 'working' };
      return (await agyRuns()).some((run) => run.conversation === sessionId) ? { found: 'elsewhere' } : { found: 'none' };
    },
    /** @returns {Promise<import('../public/model/herdr.js').HerdrLayout>} */
    async layout() {
      const view = await currentView();
      /** @type {{ agy?: true }} */
      const agy = agyCommand === undefined ? {} : { agy: true };
      return view === undefined ? { herdr: false, workspaces: [] } : { herdr: true, ...(claudeGptCommand === undefined ? {} : { claudeGpt: /** @type {const} */ (true) }), ...agy, ...(restart.env.length === 0 ? {} : { restartEnv: restart.env.map(({ name, value }) => `${name}=${value}`) }), workspaces: layoutOf(view.snapshot, view.sessionByPane, view.icons, view.hidden, view.hiddenWorkspaces) };
    },
  };
}

/** @param {string | undefined} model @returns {boolean} */
function isGptModel(model) {
  return model !== undefined && /^gpt-[a-z0-9.-]+(?:\[1m\])?$/.test(model);
}

/**
 * Whether a Claude Code session runs through GPT now: as the viewer last started it — unless it has answered since —
 * else as its last answer came; unknown while neither tells.
 * @param {import('./claude-model.js').LastAnswer | undefined} answer
 * @param {Launch | undefined} launch
 * @returns {boolean | undefined}
 */
function throughGptNow(answer, launch) {
  if (launch !== undefined && (answer === undefined || answer.at < launch.at)) return launch.launcher === 'claude-gpt';
  return answer === undefined ? undefined : isGptModel(answer.model);
}

/**
 * herdr's workspaces and tabs in its own order — the workspaces by their numbers, the tabs as herdr lists them: a tab
 * keeps the number it was opened with when it is moved — with the panes in each tab.
 * @param {import('./herdr.js').HerdrSnapshot} snapshot
 * @param {ReadonlyMap<string, string>} sessionByPane
 * @param {ReadonlyMap<string, string>} icons — by workspace id
 * @param {ReadonlySet<string>} hidden — the panes hidden from the page's list
 * @param {ReadonlySet<string>} hiddenWorkspaces — the workspaces hidden from it, by id
 * @returns {import('../public/model/herdr.js').HerdrWorkspace[]}
 */
function layoutOf(snapshot, sessionByPane, icons, hidden, hiddenWorkspaces) {
  const byNumber = (/** @type {{ number: number }} */ a, /** @type {{ number: number }} */ b) => a.number - b.number;
  return [...snapshot.workspaces].sort(byNumber).map((workspace) => ({
    id: workspace.id,
    number: workspace.number,
    label: workspace.label,
    ...(icons.has(workspace.id) ? { icon: icons.get(workspace.id) } : {}),
    status: workspace.status,
    activeTab: workspace.activeTab,
    ...(hiddenWorkspaces.has(workspace.id) ? { hidden: true } : {}),
    tabs: snapshot.tabs
      .filter((tab) => tab.workspaceId === workspace.id)
      .map((tab) => {
        const panes = snapshot.panes.filter((pane) => pane.tabId === tab.id);
        const folder = panes[0]?.cwd;
        return {
          id: tab.id,
          number: tab.number,
          label: tab.label,
          status: tab.status,
          ...(folder === undefined ? {} : { folder }),
          panes: panes.map((pane) => ({ id: pane.paneId, agent: pane.agent, status: pane.status, title: pane.title, session: sessionByPane.get(pane.paneId), size: pane.size, activity: pane.activity, ...(hidden.has(pane.paneId) ? { hidden: true } : {}) })),
        };
      }),
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

/**
 * @typedef {{ session: string, as: 'resume' | 'fork' }} GoOn — a session an agent goes on with: resumed, or forked into
 *   a new session of its own
 */

/**
 * Variables set ahead of a command typed into a shell, as the shell sets them: PowerShell's for the rest of the shell's
 * life, a POSIX shell's for the command alone.
 * @param {readonly ShellVariable[]} env
 * @param {'powershell' | 'posix'} shell
 * @returns {string}
 */
function shellVariables(env, shell) {
  return env.map(({ name, value }) => (shell === 'powershell' ? `$env:${name}='${value}'; ` : `${name}=${value} `)).join('');
}

/**
 * What follows Claude Code's command to go on with a session.
 * @param {GoOn | undefined} goOn
 * @returns {string[]}
 */
function claudeGoingOn(goOn) {
  if (goOn === undefined) return [];
  return goOn.as === 'resume' ? ['--resume', goOn.session] : ['--resume', goOn.session, '--fork-session'];
}

/**
 * What follows Codex's command to go on with a thread.
 * @param {GoOn | undefined} goOn
 * @returns {string[]}
 */
function codexGoingOn(goOn) {
  if (goOn === undefined) return [];
  return goOn.as === 'resume' ? ['resume', goOn.session] : ['fork', goOn.session];
}

/**
 * What follows Antigravity CLI's command to go on with a conversation: agy goes on with it by its id; it makes no copy of
 * one, and a copy goes on with it as well.
 * @param {GoOn | undefined} goOn
 * @returns {string[]}
 */
function agyGoingOn(goOn) {
  return goOn === undefined ? [] : ['--conversation', goOn.session];
}

/** A session's id, as Claude Code, Codex and Antigravity CLI make them. */
const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What a copy of a pane forks: the session its agent runs — none for a shell; not-an-id for a session whose id is not
 * one, as it would be typed into a shell.
 * @param {import('./herdr.js').Pane} pane
 * @param {string | undefined} session
 * @returns {{ agent: import('../public/model/composer.js').Agent, session: string } | 'not-an-id' | undefined}
 */
function forkOf(pane, session) {
  if (session === undefined || (pane.agent !== 'claude' && pane.agent !== 'codex')) return undefined;
  return sessionIdPattern.test(session) ? { agent: pane.agent, session } : 'not-an-id';
}

/**
 * The name of a tab's copy: "<its name>::<n>", n the first number the workspace's tabs leave free; a copy of a copy is
 * counted on from the same name — "checkout fix::1" copied is "checkout fix::2", or on.
 * @param {string} label
 * @param {readonly string[]} names — of the workspace's tabs
 * @returns {string}
 */
function copyName(label, names) {
  const base = label.replace(/::.*$/s, '').trim();
  const taken = new Set(names.flatMap((name) => (name.startsWith(`${base}::`) ? [name.slice(base.length + 2)] : [])));
  let number = 1;
  while (taken.has(String(number))) number++;
  return `${base}::${number}`;
}
