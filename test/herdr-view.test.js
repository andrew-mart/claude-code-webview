import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../test-support/temp-dir.js';
import { agyStartedId } from '../server/agy-live.js';
import { createHerdrView } from '../server/herdr-view.js';
import { createHiddenPanes } from '../server/hidden-panes.js';
import { createHiddenWorkspaces } from '../server/hidden-workspaces.js';

const running = '7d4e1b20-2222-4333-8444-955566667777';

/**
 * @typedef {{ workspace_id: string, label: string, number?: number, agent_status?: string, active_tab_id?: string }} FakeWorkspace
 * @typedef {{ tab_id: string, workspace_id: string, number: number, label: string, agent_status: string }} FakeTab
 * @typedef {{ pane_id: string, workspace_id: string, cwd: string, tab_id?: string, terminal_id?: string, agent?: string, agent_status?: string, terminal_title_stripped?: string, state_change_seq?: number, pid?: number, shell_pid?: number, argv?: readonly string[] }} FakePane
 * @typedef {{ tab_id: string, workspace_id: string, panes: { pane_id: string, rect: { x: number, y: number, width: number, height: number } }[] }} FakeLayout
 */

/**
 * A fake herdr: workspaces (numbered in order unless told), tabs and panes; a pane's pid — and the command line, if
 * given — is what process-info tells about it, with its shell's pid if given: the same pid, the shell at its prompt. missing — herdr is not installed at all; fail — installed, but no server answers.
 * @param {{ workspaces?: readonly FakeWorkspace[], tabs?: readonly FakeTab[], panes?: readonly FakePane[], layouts?: readonly FakeLayout[], missing?: boolean, fail?: boolean }} [layout]
 */
function fakeHerdr({ workspaces = [], tabs = [], panes = [], layouts = [], missing = false, fail = false } = {}) {
  /** @param {readonly string[]} args @returns {Promise<import('../server/composer.js').HerdrReply>} */
  return async (args) => {
    if (missing) return { ok: false, error: 'spawn herdr ENOENT', missing: true };
    if (fail) return { ok: false, error: 'no herdr server is running', missing: false };
    const [subject, command, , pane] = args;
    if (subject === 'api' && command === 'snapshot') {
      const shown = { workspaces: workspaces.map((workspace, at) => ({ number: at + 1, ...workspace })), tabs, panes: panes.map(({ pid, shell_pid, state_change_seq, argv, ...pane }) => pane), agents: panes.filter((pane) => pane.agent !== undefined).map(({ pid, shell_pid, argv, ...agent }) => agent), layouts };
      return { ok: true, json: { result: { type: 'session_snapshot', snapshot: shown } }, text: '' };
    }
    if (subject === 'pane' && command === 'process-info') {
      const known = panes.find((one) => one.pane_id === pane);
      const told = known?.pid === undefined ? [] : [{ pid: known.pid, ...(known.argv === undefined ? {} : { argv: known.argv }) }];
      return { ok: true, json: { result: { process_info: { foreground_processes: told, ...(known?.shell_pid === undefined ? {} : { shell_pid: known.shell_pid }) } } }, text: '' };
    }
    return { ok: false, error: `the fake herdr does not know ${args.join(' ')}`, missing: false };
  };
}

/** herdr with trip_plans, where Claude runs the session in a pane opened in D:\trip_plans, and notebook. */
const tripPlans = {
  workspaces: [
    { workspace_id: 'w2', label: 'trip_plans' },
    { workspace_id: 'w3', label: 'notebook' },
  ],
  panes: [{ pane_id: 'w2:p1', workspace_id: 'w2', cwd: 'D:\\trip_plans', agent: 'claude', pid: 101 }],
};
const runningRecord = { pid: 101, sessionId: running, kind: 'interactive', status: 'idle', updatedAt: 1 };
/** Workspaces with no icons: their own test gives them some. */
const noIcons = { iconsOf: async () => new Map(), setIcon: async () => undefined };
/** No pane hidden from the page: hiding's own tests hide some. */
const noHidden = { hide: async () => undefined, showAll: async () => undefined, hiddenAmong: async () => new Set() };
/** No workspace hidden from the page: hiding's own test hides some. */
const noHiddenWorkspaces = { hide: async () => undefined, show: async () => undefined, hiddenAmong: async () => new Set() };

/**
 * @param {import('node:test').TestContext} t
 * @param {{ herdr: ReturnType<typeof fakeHerdr>, records: readonly unknown[], dir?: string, codex?: readonly import('../server/codex-live.js').LiveThread[], agy?: readonly import('../server/agy-live.js').AgyRun[], agyCommand?: string }} setup
 *   — dir: where the remembered workspaces are kept, to share it between two viewer runs; codex: the threads Codex has
 *   open; agy: agy's processes alive; agyCommand: what starts agy — none, no agy
 */
async function workspacesOf(t, { herdr, records, dir, codex = [], agy = [], agyCommand }) {
  const folder = dir ?? tempDir('ccw-workspaces-');
  return createHerdrView({ herdr, readRecords: async () => records, codexThreads: async () => codex, agyRuns: async () => agy, icons: noIcons, hidden: noHidden, hiddenWorkspaces: noHiddenWorkspaces, file: join(folder, 'workspaces.json'), refreshMs: 0, trust: { looks: 3, stepMs: 1 }, claudeCommand: 'claude', codexCommand: 'codex', agyCommand });
}

test('workspaces_Should_PutRunningSessionIntoWorkspaceOfItsPane', async (t) => {
  const workspaces = await workspacesOf(t, { herdr: fakeHerdr(tripPlans), records: [runningRecord] });

  assert.deepEqual(await workspaces.workspacesOf([{ id: running, cwd: 'D:\\elsewhere' }]), { herdr: true, sessions: { [running]: 'trip_plans' }, icons: {} });
});

// Once seen running, a session stays in its workspace after it ends — the pane closed, the viewer restarted
test('workspaces_Should_KeepWorkspaceOfSessionSeenRunning_AfterItEnds', async (t) => {
  const dir = tempDir('ccw-workspaces-');
  await (await workspacesOf(t, { herdr: fakeHerdr(tripPlans), records: [runningRecord], dir })).workspacesOf([{ id: running, cwd: 'D:\\elsewhere' }]);

  const afterRestart = await workspacesOf(t, { herdr: fakeHerdr({ workspaces: tripPlans.workspaces }), records: [], dir });

  assert.deepEqual(await afterRestart.workspacesOf([{ id: running, cwd: 'D:\\elsewhere' }]), { herdr: true, sessions: { [running]: 'trip_plans' }, icons: {} });
});

// A session never seen running belongs to the workspace whose panes are open in its folder — when there is just one
test('workspaces_Should_PutOldSessionIntoTheOnlyWorkspaceWithPaneInItsFolder', async (t) => {
  const herdr = fakeHerdr({
    workspaces: [
      { workspace_id: 'w2', label: 'trip_plans' },
      { workspace_id: 'w3', label: 'notebook' },
      { workspace_id: 'w4', label: 'web' },
    ],
    panes: [
      { pane_id: 'w2:p1', workspace_id: 'w2', cwd: 'D:\\trip_plans', agent: 'claude', pid: 101 },
      { pane_id: 'w2:p2', workspace_id: 'w2', cwd: 'D:\\dev' },
      { pane_id: 'w3:p1', workspace_id: 'w3', cwd: 'D:\\notebook' },
      { pane_id: 'w4:p1', workspace_id: 'w4', cwd: 'D:\\dev' },
    ],
  });
  const workspaces = await workspacesOf(t, { herdr, records: [runningRecord] });

  const found = await workspaces.workspacesOf([
    { id: running, cwd: 'D:\\notebook' },
    { id: 'old', cwd: 'd:\\Notebook\\' },
    { id: 'shared', cwd: 'D:\\dev' },
    { id: 'nowhere', cwd: undefined },
  ]);

  assert.deepEqual(found, { herdr: true, sessions: { [running]: 'trip_plans', old: 'notebook' }, icons: {} });
});

// Without herdr the page shows no workspaces at all
test('workspaces_Should_TellThereIsNoHerdr_When_ItIsNotInstalledOrDoesNotAnswer', async (t) => {
  const sessions = [{ id: running, cwd: 'D:\\trip_plans' }];

  const replies = await Promise.all(
    [fakeHerdr({ ...tripPlans, missing: true }), fakeHerdr({ ...tripPlans, fail: true })].map(async (herdr) => (await workspacesOf(t, { herdr, records: [runningRecord] })).workspacesOf(sessions)),
  );

  assert.deepEqual(replies, [
    { herdr: false, sessions: {}, icons: {} },
    { herdr: false, sessions: {}, icons: {} },
  ]);
});

// The page asks every few seconds, and every herdr call starts a process
test('workspaces_Should_AskHerdrAtMostOncePerRefreshPeriod', async (t) => {
  /** @type {string[]} */
  const asked = [];
  const herdr = fakeHerdr(tripPlans);
  /** @param {readonly string[]} args */
  const counting = (args) => {
    asked.push(args.slice(0, 2).join(' '));
    return herdr(args);
  };
  const folder = tempDir('ccw-workspaces-');
  const workspaces = createHerdrView({ herdr: counting, readRecords: async () => [runningRecord], codexThreads: async () => [], icons: noIcons, hidden: noHidden, hiddenWorkspaces: noHiddenWorkspaces, file: join(folder, 'workspaces.json'), refreshMs: 60_000, trust: { looks: 3, stepMs: 1 }, claudeCommand: 'claude', codexCommand: 'codex' });

  await Promise.all([workspaces.workspacesOf([]), workspaces.workspacesOf([])]);
  await workspaces.workspacesOf([{ id: running, cwd: undefined }]);

  assert.equal(asked.filter((call) => call === 'api snapshot').length, 1);
});

// The sidebar and the session header show herdr as it is: workspaces in herdr's order, the tabs as herdr lists them — a
// tab moved keeps the number it was opened with — each tab's folder, its first pane's, the panes in each tab, and which
// session runs in a pane with Claude Code
test('herdrView_Should_LayOutWorkspacesTabsAndPanes_WithSessionOfClaudePane', async (t) => {
  const herdr = fakeHerdr({
    workspaces: [
      { workspace_id: 'w3', label: 'notebook', number: 2, agent_status: 'idle', active_tab_id: 'w3:t1' },
      { workspace_id: 'w2', label: 'trip_plans', number: 1, agent_status: 'working', active_tab_id: 'w2:t3' },
    ],
    tabs: [
      { tab_id: 'w2:t3', workspace_id: 'w2', number: 3, label: 'search', agent_status: 'working' },
      { tab_id: 'w3:t1', workspace_id: 'w3', number: 1, label: '1', agent_status: 'unknown' },
      { tab_id: 'w2:t1', workspace_id: 'w2', number: 1, label: 'hotels', agent_status: 'done' },
    ],
    panes: [
      { pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1', cwd: 'D:/trip_plans', agent: 'claude', agent_status: 'done', terminal_title_stripped: 'Resume', state_change_seq: 50, pid: 101 },
      { pane_id: 'w2:p3', workspace_id: 'w2', tab_id: 'w2:t3', cwd: 'D:/trip_plans', agent: 'claude', agent_status: 'working', terminal_title_stripped: 'Search', state_change_seq: 80, pid: 303 },
      { pane_id: 'w3:p1', workspace_id: 'w3', tab_id: 'w3:t1', cwd: 'D:/notebook', agent_status: 'unknown', terminal_title_stripped: 'nvim' },
    ],
    layouts: [
      { tab_id: 'w2:t1', workspace_id: 'w2', panes: [{ pane_id: 'w2:p1', rect: { x: 0, y: 0, width: 154, height: 44 } }] },
      { tab_id: 'w3:t1', workspace_id: 'w3', panes: [{ pane_id: 'w3:p1', rect: { x: 0, y: 0, width: 100, height: 30 } }] },
    ],
  });
  const view = await workspacesOf(t, { herdr, records: [runningRecord] });

  assert.deepEqual(await view.layout(), {
    herdr: true,
    workspaces: [
      {
        id: 'w2',
        number: 1,
        label: 'trip_plans',
        status: 'working',
        activeTab: 'w2:t3',
        tabs: [
          { id: 'w2:t3', number: 3, label: 'search', status: 'working', folder: 'D:/trip_plans', panes: [{ id: 'w2:p3', agent: 'claude', status: 'working', title: 'Search', session: undefined, size: undefined, activity: 80 }] },
          { id: 'w2:t1', number: 1, label: 'hotels', status: 'done', folder: 'D:/trip_plans', panes: [{ id: 'w2:p1', agent: 'claude', status: 'done', title: 'Resume', session: running, size: { cols: 154, rows: 44 }, activity: 50 }] },
        ],
      },
      {
        id: 'w3',
        number: 2,
        label: 'notebook',
        status: 'idle',
        activeTab: 'w3:t1',
        tabs: [{ id: 'w3:t1', number: 1, label: '1', status: 'unknown', folder: 'D:/notebook', panes: [{ id: 'w3:p1', agent: undefined, status: 'unknown', title: 'nvim', session: undefined, size: { cols: 100, rows: 30 }, activity: undefined }] }],
      },
    ],
  });
});

// A Claude Code process outside herdr — in an IDE, a plain terminal — is in no pane. herdr is asked about its panes'
// processes once for it, not on every look: each round is a request per pane, and herdr answers a terminal's keys
// after them
test('herdrView_Should_LookForPaneOfProcessOnce_WhenItRunsOutsideHerdr', async (t) => {
  /** @type {string[]} */
  const asked = [];
  const herdr = fakeHerdr(tripPlans);
  /** @param {readonly string[]} args */
  const counting = (args) => {
    asked.push(args.slice(0, 2).join(' '));
    return herdr(args);
  };
  const outside = { pid: 777, sessionId: '0b1c2d3e-4444-4555-8666-977788899900', kind: 'interactive', status: 'idle', updatedAt: 2 };
  const folder = tempDir('ccw-workspaces-');
  const view = createHerdrView({ herdr: counting, codexThreads: async () => [], readRecords: async () => [runningRecord, outside], icons: noIcons, hidden: noHidden, hiddenWorkspaces: noHiddenWorkspaces, file: join(folder, 'workspaces.json'), refreshMs: 0, trust: { looks: 3, stepMs: 1 }, claudeCommand: 'claude', codexCommand: 'codex' });

  await view.workspacesOf([]);
  await view.workspacesOf([]);
  await view.workspacesOf([]);

  assert.equal(asked.filter((call) => call === 'pane process-info').length, 1);
});

// A tab duplicated from the page goes on from its session as a fork — Claude Code started `--resume <id> --fork-session`
// — whose transcript Claude Code writes only with the first new message; until then its conversation is the session's
// it was forked from. The view tells which, for a session running in a pane; a session started anew forks from none
test('herdrView_Should_TellSessionPaneForkedFrom', async () => {
  const forked = '7d4e1b20-aaaa-4bbb-8ccc-000000000002';
  const fork = { pane_id: 'w2:p2', workspace_id: 'w2', cwd: 'D:\\trip_plans', agent: 'claude', pid: 102, argv: ['claude.exe', '--resume', running, '--fork-session'] };
  const herdr = fakeHerdr({ ...tripPlans, panes: [...tripPlans.panes, fork] });
  const forkRecord = { pid: 102, sessionId: forked, kind: 'interactive', status: 'idle', updatedAt: 2 };
  const view = createHerdrView({ herdr, codexThreads: async () => [], readRecords: async () => [runningRecord, forkRecord], icons: noIcons, hidden: noHidden, hiddenWorkspaces: noHiddenWorkspaces, file: join(tempDir('ccw-workspaces-'), 'workspaces.json'), refreshMs: 0, trust: { looks: 3, stepMs: 1 }, claudeCommand: 'claude', codexCommand: 'codex' });

  await view.workspacesOf([]);

  assert.deepEqual([await view.forkedFrom(forked), await view.forkedFrom(running)], [running, undefined]);
});

// Each workspace has its icon (workspace-icons.js), told its name and folder — its first tab's pane's: in herdr's layout,
// and in the session list by each session of it
test('herdrView_Should_GiveEachWorkspaceItsIcon_InTheLayoutAndBySessionsOfIt', async (t) => {
  /** @type {import('../server/workspace-icons.js').IconedWorkspace[][]} */
  const asked = [];
  const icons = {
    /** @param {readonly import('../server/workspace-icons.js').IconedWorkspace[]} workspaces */
    iconsOf: async (workspaces) => {
      asked.push([...workspaces]);
      return new Map(workspaces.map((workspace, at) => [workspace.id, at === 0 ? '🦊' : '🐙']));
    },
    setIcon: async () => undefined,
  };
  const folder = tempDir('ccw-workspaces-');
  const view = createHerdrView({ herdr: fakeHerdr(tripPlans), readRecords: async () => [runningRecord], codexThreads: async () => [], icons, hidden: noHidden, hiddenWorkspaces: noHiddenWorkspaces, file: join(folder, 'workspaces.json'), refreshMs: 0, trust: { looks: 3, stepMs: 1 }, claudeCommand: 'claude', codexCommand: 'codex' });

  const layout = await view.layout();
  const listed = await view.workspacesOf([{ id: running, cwd: 'D:\\elsewhere' }]);

  assert.deepEqual(
    { told: asked[0], layout: layout.workspaces.map((workspace) => [workspace.label, workspace.icon]), listed: listed.icons },
    {
      told: [
        { id: 'w2', label: 'trip_plans', folder: 'D:\\trip_plans' },
        { id: 'w3', label: 'notebook', folder: undefined },
      ],
      layout: [['trip_plans', '🦊'], ['notebook', '🐙']],
      listed: { [running]: '🦊' },
    },
  );
});

// A workspace's folder, which its icon is remembered for, is the one most of its panes are in — not its first tab's,
// opened elsewhere by the way; even, its first tab's
test('herdrView_Should_TellIconsTheFolderMostOfAWorkspacesPanesAreIn', async (t) => {
  /** @type {string[]} */
  const told = [];
  const icons = {
    /** @param {readonly import('../server/workspace-icons.js').IconedWorkspace[]} workspaces */
    iconsOf: async (workspaces) => {
      told.push(...workspaces.map((workspace) => `${workspace.label}: ${workspace.folder}`));
      return new Map();
    },
    setIcon: async () => undefined,
  };
  const herdr = fakeHerdr({
    workspaces: [
      { workspace_id: 'w1', label: 'webview' },
      { workspace_id: 'w2', label: 'even' },
    ],
    tabs: [
      { tab_id: 'w1:t1', workspace_id: 'w1', number: 1, label: '1', agent_status: 'idle' },
      { tab_id: 'w1:t4', workspace_id: 'w1', number: 4, label: '4', agent_status: 'idle' },
      { tab_id: 'w1:t6', workspace_id: 'w1', number: 6, label: '6', agent_status: 'idle' },
      { tab_id: 'w2:t2', workspace_id: 'w2', number: 2, label: '2', agent_status: 'idle' },
      { tab_id: 'w2:t1', workspace_id: 'w2', number: 1, label: '1', agent_status: 'idle' },
    ],
    panes: [
      { pane_id: 'w1:p1', workspace_id: 'w1', tab_id: 'w1:t1', cwd: 'D:\\dev\\shop' },
      { pane_id: 'w1:p4', workspace_id: 'w1', tab_id: 'w1:t4', cwd: 'D:\\dev\\webview' },
      { pane_id: 'w1:p6', workspace_id: 'w1', tab_id: 'w1:t6', cwd: 'd:/dev/webview/' },
      { pane_id: 'w2:p2', workspace_id: 'w2', tab_id: 'w2:t2', cwd: 'D:\\dev\\b' },
      { pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1', cwd: 'D:\\dev\\a' },
    ],
  });
  const folder = tempDir('ccw-workspaces-');
  const view = createHerdrView({ herdr, readRecords: async () => [], codexThreads: async () => [], icons, hidden: noHidden, hiddenWorkspaces: noHiddenWorkspaces, file: join(folder, 'workspaces.json'), refreshMs: 0, trust: { looks: 3, stepMs: 1 }, claudeCommand: 'claude', codexCommand: 'codex' });

  await view.layout();

  assert.deepEqual(told, ['webview: D:\\dev\\webview', 'even: D:\\dev\\a']);
});

// An icon picked by hand for a workspace — one its name cannot hold — is kept for the workspace's folder; for no
// workspace herdr has, nothing is kept
test('setWorkspaceIcon_Should_KeepIconForWorkspacesFolder', async (t) => {
  /** @type {string[]} */
  const kept = [];
  const icons = { iconsOf: async () => new Map(), setIcon: async (/** @type {string} */ folder, /** @type {string | undefined} */ icon) => void kept.push(`${folder}: ${icon}`) };
  const folder = tempDir('ccw-workspaces-');
  const view = createHerdrView({ herdr: fakeHerdr(tripPlans), readRecords: async () => [], codexThreads: async () => [], icons, hidden: noHidden, hiddenWorkspaces: noHiddenWorkspaces, file: join(folder, 'workspaces.json'), refreshMs: 0, trust: { looks: 3, stepMs: 1 }, claudeCommand: 'claude', codexCommand: 'codex' });

  const outcomes = [await view.setWorkspaceIcon('w2', 'lucide:wallet@green'), await view.setWorkspaceIcon('w2', undefined), await view.setWorkspaceIcon('w9', 'lucide:wallet')];

  assert.deepEqual({ outcomes, kept }, { outcomes: [{ ok: true }, { ok: true }, { ok: false, error: 'failed' }], kept: ['D:\\trip_plans: lucide:wallet@green', 'D:\\trip_plans: undefined'] });
});

// A Claude Code process looked for before herdr tells its pane for Claude's is found once herdr does: it is not taken
// for one outside herdr for good
test('workspaces_Should_FindPaneOfSession_When_HerdrTellsItsAgentAfterTheFirstLook', async (t) => {
  /** @type {FakePane} */
  const pane = { pane_id: 'w2:p1', workspace_id: 'w2', cwd: 'D:\\trip_plans', pid: 101 };
  const view = await workspacesOf(t, { herdr: fakeHerdr({ workspaces: tripPlans.workspaces, panes: [pane] }), records: [runningRecord] });
  const sessions = [{ id: running, cwd: 'D:\\elsewhere' }];

  const before = await view.workspacesOf(sessions);
  pane.agent = 'claude';
  const after = await view.workspacesOf(sessions);

  assert.deepEqual([before, after], [{ herdr: true, sessions: {}, icons: {} }, { herdr: true, sessions: { [running]: 'trip_plans' }, icons: {} }]);
});

// A process's number goes to another once it is gone: a new Claude under an old one's number is looked for anew, its
// session put into its own pane's workspace
test('workspaces_Should_FindPaneAnew_When_ProcessNumberIsTakenByAnotherClaude', async (t) => {
  /** @type {FakePane} */
  const jobs = { pane_id: 'w2:p1', workspace_id: 'w2', cwd: 'D:\\trip_plans', agent: 'claude', pid: 101 };
  /** @type {FakePane} */
  const notebook = { pane_id: 'w3:p1', workspace_id: 'w3', cwd: 'D:\\notebook', agent: 'claude', pid: 555 };
  const panes = [jobs, notebook];
  const records = [{ ...runningRecord, startedAt: 1000 }];
  const view = await workspacesOf(t, { herdr: fakeHerdr({ workspaces: tripPlans.workspaces, panes }), records });
  const later = '9b1c2d30-1111-4222-8333-944455556666';

  await view.workspacesOf([]);
  panes.splice(0, 2, { ...jobs, pid: 202 }, { ...notebook, pid: 101 });
  records.splice(0, 1, { ...runningRecord, sessionId: later, startedAt: 2000 });

  assert.deepEqual(await view.workspacesOf([{ id: later, cwd: 'D:\\elsewhere' }]), { herdr: true, sessions: { [later]: 'notebook' }, icons: {} });
});

/**
 * herdr with one workspace, web, and its tabs, the first one's pane in D:/shop; renaming, closing and opening a tab
 * change them, a new tab's pane shows its shell's prompt unless told what it shows; the changes and what is typed are
 * recorded.
 * @param {{ fails?: boolean, screens?: readonly string[], opened?: readonly FakeTab[], panes?: readonly FakePane[] }} [options] -
 *   fails: herdr refuses to rename, close or open; screens: what a pane shows, one per look, the last staying; opened,
 *   panes: the tabs and panes herdr has to start with, unless the usual two tabs with a shell in the first
 */
function tabsHerdr({
  fails = false,
  screens = ['PS D:\\shop> '],
  opened = [
    { tab_id: 'w2:t1', workspace_id: 'w2', number: 1, label: '1', agent_status: 'idle' },
    { tab_id: 'w2:t2', workspace_id: 'w2', number: 2, label: 'tests', agent_status: 'idle' },
  ],
  panes = [{ pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1', cwd: 'D:/shop' }],
} = {}) {
  /** @type {readonly FakeTab[]} */
  let tabs = opened;
  /** @type {string[]} */
  const changes = [];
  let reads = 0;
  /** @param {readonly string[]} args @returns {Promise<import('../server/composer.js').HerdrReply>} */
  const run = async (args) => {
    const [subject, command, tab, label] = args;
    if (subject === 'pane' && command === 'read') return { ok: true, json: undefined, text: screens[Math.min(reads++, screens.length - 1)] ?? '' };
    if (subject === 'pane' && (command === 'send-text' || command === 'send-keys')) {
      changes.push(args.join(' '));
      return { ok: true, json: { result: { type: 'ok' } }, text: '' };
    }
    if (subject === 'workspace' && (command === 'rename' || command === 'close')) {
      changes.push(args.join(' '));
      return fails ? { ok: false, error: 'workspace_not_found', missing: false } : { ok: true, json: { result: { type: 'ok' } }, text: '' };
    }
    if (subject === 'workspace' && command === 'create') {
      changes.push(args.join(' '));
      return { ok: true, json: { result: { type: 'workspace_created', workspace: { workspace_id: 'w5' }, tab: { tab_id: 'w5:t1' }, root_pane: { pane_id: 'w5:p1' } } }, text: '' };
    }
    if (subject !== 'tab') return fakeHerdr({ workspaces: [{ workspace_id: 'w2', label: 'web' }], tabs, panes })(args);
    changes.push(args.join(' '));
    if (fails) return { ok: false, error: 'tab_not_found', missing: false };
    if (command === 'create') {
      const number = tabs.length + 1;
      tabs = [...tabs, { tab_id: `w2:t${number}`, workspace_id: 'w2', number, label: String(number), agent_status: 'unknown' }];
      return { ok: true, json: { result: { type: 'tab_created', tab: { tab_id: `w2:t${number}` }, root_pane: { pane_id: `w2:p${number}` } } }, text: '' };
    }
    if (command === 'move') {
      // as herdr moves one: to the place between the tabs as they stand — each keeps its number, given as it was opened
      const from = tabs.findIndex((known) => known.tab_id === tab);
      const moved = tabs[from];
      const place = Number(label);
      const rest = tabs.filter((known) => known.tab_id !== tab);
      const order = moved === undefined ? tabs : [...rest.slice(0, from < place ? place - 1 : place), moved, ...rest.slice(from < place ? place - 1 : place)];
      tabs = order;
      return { ok: true, json: { result: { type: 'tab_list' } }, text: '' };
    }
    tabs = command === 'close' ? tabs.filter((known) => known.tab_id !== tab) : tabs.map((known) => (known.tab_id === tab && label !== undefined ? { ...known, label } : known));
    return { ok: true, json: { result: { type: 'ok' } }, text: '' };
  };
  return { run, changes };
}

/**
 * @param {ReturnType<typeof tabsHerdr>} herdr — asked at most once a minute
 * @param {string} [claudeCommand] - what starts Claude Code in a new tab
 */
async function tabsView(herdr, claudeCommand = 'claude') {
  const folder = tempDir('ccw-workspaces-');
  return createHerdrView({ herdr: herdr.run, readRecords: async () => [], codexThreads: async () => [], icons: noIcons, hidden: noHidden, hiddenWorkspaces: noHiddenWorkspaces, file: join(folder, 'workspaces.json'), refreshMs: 60_000, trust: { looks: 3, stepMs: 1 }, claudeCommand, codexCommand: 'codex-yolo' });
}

// A session restarted where it runs: its Claude Code ended, then started again in its tab resuming it, the variables
// asked for set ahead of it as the computer's shell sets them — PowerShell's on Windows, a POSIX shell's elsewhere — the
// page told them. A session running nowhere in herdr is not restarted; one whose Claude Code did not end gets nothing
// typed over it
test('restart_Should_EndClaudeInItsTab_AndResumeSessionThere_WithVariablesSet', async () => {
  const herdr = tabsHerdr({ panes: [{ pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1', cwd: 'D:/shop', agent: 'claude', pid: 101 }] });
  /** @type {number[]} */
  const ended = [];
  const env = [
    { name: 'CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP', value: '1' },
    { name: 'SHOP_ENV', value: 'staging' },
  ];
  /** @param {'powershell' | 'posix'} shell @param {boolean} ends */
  const viewer = (shell, ends) =>
    createHerdrView({ herdr: herdr.run, readRecords: async () => [runningRecord], codexThreads: async () => [], icons: noIcons, hidden: noHidden, hiddenWorkspaces: noHiddenWorkspaces, file: join(tempDir('ccw-restart-'), 'workspaces.json'), refreshMs: 0, trust: { looks: 3, stepMs: 1 }, claudeCommand: 'my-claude', codexCommand: 'codex', restart: { env, shell, endProcess: async (pid) => (ended.push(pid), ends) } });

  const told = (await viewer('posix', true).layout()).restartEnv;
  const outcomes = [
    await viewer('powershell', true).restart(running, 'given', 'as-it-ran'),
    await viewer('posix', true).restart(running, 'given', 'as-it-ran'),
    await viewer('posix', true).restart('9a1c2a10-1111-4222-8333-000000000099', 'given', 'as-it-ran'),
    await viewer('posix', false).restart(running, 'given', 'as-it-ran'),
  ];

  assert.deepEqual(
    { told, outcomes, ended, typed: herdr.changes.filter((change) => change.startsWith('pane send-text')) },
    {
      told: ['CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1', 'SHOP_ENV=staging'],
      outcomes: [{ ok: true }, { ok: true }, { ok: false, error: 'failed' }, { ok: false, error: 'failed' }],
      ended: [101, 101, 101],
      typed: [
        `pane send-text w2:p1 $env:CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP='1'; $env:SHOP_ENV='staging'; my-claude --resume ${running}`,
        `pane send-text w2:p1 CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1 SHOP_ENV=staging my-claude --resume ${running}`,
      ],
    },
  );
});

test('createTab_Should_StartClaudeGptSeparatelyFromOrdinaryClaude', async () => {
  const herdr = tabsHerdr();
  const folder = tempDir('ccw-gpt-');
  const view = createHerdrView({ herdr: herdr.run, readRecords: async () => [], codexThreads: async () => [], icons: noIcons, hidden: noHidden, hiddenWorkspaces: noHiddenWorkspaces, file: join(folder, 'workspaces.json'), refreshMs: 0, trust: { looks: 3, stepMs: 1 }, claudeCommand: 'claude-normal', claudeGptCommand: 'claude-via-gpt', codexCommand: 'codex' });

  const outcomes = [await view.createTab('w2:t1', 'claude-gpt', undefined), await view.createTab('w2:t1', 'claude', undefined)];

  assert.deepEqual({ outcomes, commands: herdr.changes.filter((change) => change.startsWith('pane send-text')) }, {
    outcomes: [{ ok: true, target: '#/pane/w2:p3' }, { ok: true, target: '#/pane/w2:p4' }],
    commands: ['pane send-text w2:p3 claude-via-gpt', 'pane send-text w2:p4 claude-normal'],
  });
});

// Antigravity CLI starts in a new tab by its command, and an agy conversation goes on — reopened from the page in a tab
// of its folder — by its id, as agy --conversation <id> does
test('createTab_Should_StartAgy_AndReopenItsConversationByItsId', async () => {
  const herdr = tabsHerdr();
  const conversation = '9342f993-b892-4839-845d-ce2d261b092e';
  const view = createHerdrView({ herdr: herdr.run, readRecords: async () => [], codexThreads: async () => [], icons: noIcons, hidden: noHidden, hiddenWorkspaces: noHiddenWorkspaces, file: join(tempDir('ccw-agy-'), 'workspaces.json'), refreshMs: 0, trust: { looks: 3, stepMs: 1 }, claudeCommand: 'claude', codexCommand: 'codex', agyCommand: 'agy-yolo' });

  const outcomes = [await view.createTab('w2:t1', 'agy', undefined), await view.reopen(conversation, 'D:/shop', 'agy')];

  assert.deepEqual({ outcomes, commands: herdr.changes.filter((change) => change.startsWith('pane send-text')) }, {
    outcomes: [{ ok: true, target: '#/pane/w2:p3' }, { ok: true, target: `#/${conversation}` }],
    commands: ['pane send-text w2:p3 agy-yolo', `pane send-text w5:p1 agy-yolo --conversation ${conversation}`],
  });
});

test('reopen_Should_KeepGptLauncherAndModel_ForSessionStartedOutsideViewer', async () => {
  const herdr = tabsHerdr();
  const folder = tempDir('ccw-gpt-');
  const view = createHerdrView({ herdr: herdr.run, readRecords: async () => [], codexThreads: async () => [], icons: noIcons, hidden: noHidden, hiddenWorkspaces: noHiddenWorkspaces, file: join(folder, 'workspaces.json'), refreshMs: 0, trust: { looks: 3, stepMs: 1 }, claudeCommand: 'claude-normal', claudeGptCommand: 'claude-via-gpt', claudeModelOf: async () => ({ model: 'gpt-6.1-sol', at: Date.parse('2026-10-31T10:00:00Z') }), codexCommand: 'codex' });

  const outcome = await view.reopen(running, 'D:/shop', 'claude');

  assert.deepEqual({ outcome, commands: herdr.changes.filter((change) => change.startsWith('pane send-text')) }, {
    outcome: { ok: true, target: `#/${running}` },
    commands: [`pane send-text w5:p1 claude-via-gpt --resume ${running} --model gpt-6.1-sol`],
  });
});

test('reopen_Should_KeepGptLauncherAfterRestart_WhenSessionHasNotAnsweredYet', async () => {
  /** @type {FakePane[]} */
  const panes = [{ pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1', cwd: 'D:/shop' }];
  /** @type {unknown[]} */
  const records = [];
  const herdr = tabsHerdr({ panes });
  const folder = tempDir('ccw-gpt-');
  const startViewer = () => createHerdrView({ herdr: herdr.run, readRecords: async () => records, codexThreads: async () => [], icons: noIcons, hidden: noHidden, hiddenWorkspaces: noHiddenWorkspaces, file: join(folder, 'workspaces.json'), refreshMs: 0, trust: { looks: 3, stepMs: 1 }, claudeCommand: 'claude-normal', claudeGptCommand: 'claude-via-gpt', codexCommand: 'codex' });
  const view = startViewer();
  await view.createTab('w2:t1', 'claude-gpt', undefined);
  panes.push({ pane_id: 'w2:p3', workspace_id: 'w2', tab_id: 'w2:t3', cwd: 'D:/shop', agent: 'claude', pid: 101 });
  records.push(runningRecord);
  await view.history();
  panes.pop();
  records.pop();
  await view.history();

  await startViewer().reopen(running, 'D:/shop', 'claude');

  assert.deepEqual(herdr.changes.filter((change) => change.startsWith('pane send-text')), [
    'pane send-text w2:p3 claude-via-gpt',
    `pane send-text w2:p4 claude-via-gpt --resume ${running}`,
  ]);
});

/** @param {import('../public/model/herdr.js').HerdrLayout} layout */
const tabNames = (layout) => layout.workspaces.flatMap((workspace) => workspace.tabs.map((tab) => tab.label));

// A tab named from the page gets its name in herdr — on one line — and the page sees it at once, not after the next look
test('renameTab_Should_NameTabInHerdr_And_ShowNameAtOnce', async () => {
  const herdr = tabsHerdr();
  const view = await tabsView(herdr);
  await view.layout();

  const outcome = await view.renameTab('w2:t1', '  checkout\n  fix ');

  assert.deepEqual({ outcome, changes: herdr.changes, names: tabNames(await view.layout()) }, { outcome: { ok: true }, changes: ['tab rename w2:t1 checkout fix'], names: ['checkout fix', 'tests'] });
});

// A tab dragged on the page to another place among its workspace's tabs moves there in herdr — the place counted
// between the tabs as they stood, the last one's end after it — and the page sees the order at once
test('moveTab_Should_MoveTabInHerdr_And_ShowOrderAtOnce', async () => {
  const herdr = tabsHerdr();
  const view = await tabsView(herdr);
  await view.layout();

  const outcome = await view.moveTab('w2:t1', 2);

  assert.deepEqual({ outcome, changes: herdr.changes, names: tabNames(await view.layout()) }, { outcome: { ok: true }, changes: ['tab move w2:t1 2'], names: ['tests', '1'] });
});

// A tab closed from the page is closed in herdr — what runs in it stops — and is gone from the page at once
test('closeTab_Should_CloseTabInHerdr_And_LeaveItOutAtOnce', async () => {
  const herdr = tabsHerdr();
  const view = await tabsView(herdr);
  await view.layout();

  const outcome = await view.closeTab('w2:t2');

  assert.deepEqual({ outcome, changes: herdr.changes, names: tabNames(await view.layout()) }, { outcome: { ok: true }, changes: ['tab close w2:t2'], names: ['1'] });
});

// "Open in herdr" over a session takes herdr to its tab — the tab's workspace with it; what herdr refuses is told
test('focusTab_Should_TakeHerdrToTab_And_TellWhatWasNotDone', async () => {
  const herdr = tabsHerdr();
  const refusing = tabsHerdr({ fails: true });

  const outcomes = [await (await tabsView(herdr)).focusTab('w2:t2'), await (await tabsView(refusing)).focusTab('w2:t2')];

  assert.deepEqual({ outcomes, changes: herdr.changes }, { outcomes: [{ ok: true }, { ok: false, error: 'failed' }], changes: ['tab focus w2:t2'] });
});

// A name of nothing but spaces is not sent; what herdr refuses is told, and the page keeps the tabs as they are
test('renameTab_And_closeTab_Should_TellWhatWasNotDone', async () => {
  const quiet = tabsHerdr();
  const refusing = tabsHerdr({ fails: true });
  const refusingView = await tabsView(refusing);

  const outcomes = [await (await tabsView(quiet)).renameTab('w2:t1', ' \n '), await refusingView.renameTab('w2:t1', 'checkout'), await refusingView.closeTab('w2:t2')];

  assert.deepEqual({ outcomes, unsent: quiet.changes }, { outcomes: [{ ok: false, error: 'empty' }, { ok: false, error: 'failed' }, { ok: false, error: 'failed' }], unsent: [] });
});

// Claude Code started in a new tab asks whether to trust its folder — a dialog a phone cannot get through: the viewer
// takes the cursor to yes and answers for the user, who chose the folder
test('createTab_Should_AnswerYes_When_ClaudeStartedInItAsksToTrustFolder', async () => {
  const question = (/** @type {'no' | 'yes'} */ cursor) => ` Is this a project you created or one you trust?\n\n ${cursor === 'no' ? '❯' : ' '} No, exit\n ${cursor === 'yes' ? '❯' : ' '} Yes, I trust this folder\n`;
  const herdr = tabsHerdr({ screens: ['ann@box:~$ ', question('no'), question('yes')] });
  const view = await tabsView(herdr, 'claude-fast');

  await view.createTab('w2:t1', 'claude', undefined);
  for (let wait = 0; wait < 50 && !herdr.changes.includes('pane send-keys w2:p3 down'); wait++) await new Promise((done) => setTimeout(done, 5));
  await new Promise((done) => setTimeout(done, 20));

  assert.deepEqual(herdr.changes.filter((change) => change.startsWith('pane')), ['pane send-text w2:p3 claude-fast', 'pane send-keys w2:p3 enter', 'pane send-keys w2:p3 down', 'pane send-keys w2:p3 enter']);
});

// A workspace renamed from the page gets its name in herdr — on one line — and one closed is closed there; a name of
// nothing is not sent, and what herdr refuses is told
test('renameWorkspace_And_closeWorkspace_Should_ChangeWorkspaceInHerdr', async () => {
  const herdr = tabsHerdr();
  const refusing = tabsHerdr({ fails: true });
  const view = await tabsView(herdr);

  const outcomes = [await view.renameWorkspace('w2', '  shop\n  front '), await view.renameWorkspace('w2', ' \n '), await view.closeWorkspace('w2'), await (await tabsView(refusing)).closeWorkspace('w2')];

  assert.deepEqual({ outcomes, changes: herdr.changes }, { outcomes: [{ ok: true }, { ok: false, error: 'empty' }, { ok: true }, { ok: false, error: 'failed' }], changes: ['workspace rename w2 shop front', 'workspace close w2'] });
});

// A new tab opens beside the one it is asked from — its workspace, its folder — under the name it is given, and the page
// goes to it; for Claude Code the command the viewer was told to start it with is typed into it
test('createTab_Should_OpenTabBesideOne_And_StartClaudeWithItsCommand', async () => {
  const herdr = tabsHerdr();
  const view = await tabsView(herdr, 'claude-fast');
  await view.layout();

  const outcomes = [await view.createTab('w2:t1', 'shell', undefined), await view.createTab('w2:t1', 'claude', '  slow  tests ')];

  assert.deepEqual(
    { outcomes, changes: herdr.changes, tabs: tabNames(await view.layout()).length },
    {
      outcomes: [
        { ok: true, target: '#/pane/w2:p3' },
        { ok: true, target: '#/pane/w2:p4' },
      ],
      changes: ['tab create --workspace w2 --cwd D:/shop', 'tab create --workspace w2 --cwd D:/shop', 'tab rename w2:t4 slow tests', 'pane send-text w2:p4 claude-fast', 'pane send-keys w2:p4 enter'],
      tabs: 4,
    },
  );
});

// Every session seen in a herdr pane is kept with its tab; once its pane is gone — the viewer restarted meanwhile — it
// is closed, and still there to be found
test('history_Should_KeepSessionWithItsTab_AndCloseItOnceItsPaneIsGone', async (t) => {
  const dir = tempDir('ccw-workspaces-');
  const inTab = fakeHerdr({
    workspaces: tripPlans.workspaces,
    tabs: [{ tab_id: 'w2:t1', workspace_id: 'w2', number: 1, label: 'hotels', agent_status: 'idle' }],
    panes: [{ pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1', cwd: 'D:\trip_plans', agent: 'claude', pid: 101 }],
  });
  /** @param {import('../public/model/history.js').Place | undefined} place */
  const where = (place) => (place === undefined ? undefined : { workspace: place.workspace, tab: place.tab, folder: place.folder, open: place.open });

  const whileOpen = where((await (await workspacesOf(t, { herdr: inTab, records: [runningRecord], dir })).history())[running]);
  const afterClose = where((await (await workspacesOf(t, { herdr: fakeHerdr({ workspaces: tripPlans.workspaces }), records: [], dir })).history())[running]);

  assert.deepEqual([whileOpen, afterClose], [
    { workspace: 'trip_plans', tab: 'hotels', folder: 'D:\trip_plans', open: true },
    { workspace: 'trip_plans', tab: 'hotels', folder: 'D:\trip_plans', open: false },
  ]);
});

// /clear, /new, /resume: the process in a tab's pane goes on with another session — the two are the tab's conversations,
// one after the other, kept with its terminal
test('history_Should_KeepConversationsOfOneTab_WithItsTerminal_When_ItsProcessGoesOnWithAnotherSession', async (t) => {
  const cleared = '5b0e8d14-3333-4444-8555-a66677778888';
  const records = [runningRecord];
  const inTab = fakeHerdr({
    workspaces: tripPlans.workspaces,
    tabs: [{ tab_id: 'w2:t1', workspace_id: 'w2', number: 1, label: 'hotels', agent_status: 'idle' }],
    panes: [{ pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1', terminal_id: 'term_65cd672d541fe1d', cwd: 'D:\\trip_plans', agent: 'claude', pid: 101 }],
  });
  const view = await workspacesOf(t, { herdr: inTab, records });
  await view.history();
  records[0] = { ...runningRecord, sessionId: cleared, updatedAt: 2 };

  const history = await view.history();

  assert.deepEqual([history[running], history[cleared]].map((place) => (place === undefined ? undefined : { terminal: place.terminal, open: place.open })), [
    { terminal: 'term_65cd672d541fe1d', open: false },
    { terminal: 'term_65cd672d541fe1d', open: true },
  ]);
});

// The page asks for the history every few seconds and is told "not changed" while nothing has: an open session's place
// does not carry when it was last seen — it is seen now
test('history_Should_StayTheSame_WhileNothingChanges', async (t) => {
  const inTab = fakeHerdr({
    workspaces: tripPlans.workspaces,
    tabs: [{ tab_id: 'w2:t1', workspace_id: 'w2', number: 1, label: 'hotels', agent_status: 'idle' }],
    panes: [{ pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1', cwd: 'D:\trip_plans', agent: 'claude', pid: 101 }],
  });
  const view = await workspacesOf(t, { herdr: inTab, records: [runningRecord] });

  const first = JSON.stringify(await view.history());
  await new Promise((done) => setTimeout(done, 5));
  const later = JSON.stringify(await view.history());

  assert.equal(later, first);
});

/**
 * A herdr view whose history already holds these sessions, closed: Claude Code starts with claude-fast.
 * @param {ReturnType<typeof tabsHerdr>} herdr
 * @param {Record<string, Partial<import('../public/model/history.js').Place>>} closed
 */
async function viewWithHistory(herdr, closed) {
  const folder = tempDir('ccw-workspaces-');
  const kept = Object.fromEntries(Object.entries(closed).map(([session, place]) => [session, { earlierTabs: [], open: false, firstSeen: 1, lastSeen: 2, ...place }]));
  await writeFile(join(folder, 'workspaces.json'), JSON.stringify(kept));
  return createHerdrView({ herdr: herdr.run, readRecords: async () => [], codexThreads: async () => [], icons: noIcons, hidden: noHidden, hiddenWorkspaces: noHiddenWorkspaces, file: join(folder, 'workspaces.json'), refreshMs: 60_000, trust: { looks: 3, stepMs: 1 }, claudeCommand: 'claude-fast', codexCommand: 'codex-yolo' });
}

// A closed session opens where it was: a new tab of its workspace, named as before, in its folder, Claude Code resuming
// it; the page stays on its feed
test('reopen_Should_OpenSessionInItsWorkspace_InTabNamedAsBefore', async () => {
  const herdr = tabsHerdr();
  const view = await viewWithHistory(herdr, { s9: { workspace: 'web', tab: 'checkout fix', folder: 'D:/web' } });

  const outcome = await view.reopen('s9', 'D:/elsewhere', 'claude');

  assert.deepEqual({ outcome, changes: herdr.changes }, {
    outcome: { ok: true, target: '#/s9' },
    changes: ['tab create --workspace w2 --cwd D:/web', 'tab rename w2:t3 checkout fix', 'pane send-text w2:p3 claude-fast --resume s9', 'pane send-keys w2:p3 enter'],
  });
});

// A conversation whose tab is still open — another one going on in it — opens in a copy of the tab, not in a second
// tab of the same name
test('reopen_Should_NameNewTabAsCopy_When_TabItRanInIsStillOpen', async () => {
  const herdr = tabsHerdr();
  const view = await viewWithHistory(herdr, { s9: { workspace: 'web', tab: 'tests', folder: 'D:/web' } });

  await view.reopen('s9', 'D:/web', 'claude');

  assert.deepEqual(herdr.changes.filter((change) => change.startsWith('tab rename')), ['tab rename w2:t3 tests::1']);
});

// Codex as Claude Code: a new tab starts it with the command the viewer was told to start it with, and a closed Codex
// session opens where it ran, Codex resuming it
test('createTab_And_reopen_Should_StartCodexWithItsCommand_AndResumeCodexSession', async () => {
  const herdr = tabsHerdr();
  const view = await viewWithHistory(herdr, { t1: { workspace: 'web', tab: 'limits', folder: 'D:/web' } });
  await view.layout();

  const outcomes = [await view.createTab('w2:t1', 'codex', undefined), await view.reopen('t1', 'D:/web', 'codex')];

  assert.deepEqual(
    { outcomes, changes: herdr.changes },
    {
      outcomes: [
        { ok: true, target: '#/pane/w2:p3' },
        { ok: true, target: '#/t1' },
      ],
      changes: ['tab create --workspace w2 --cwd D:/shop', 'pane send-text w2:p3 codex-yolo', 'pane send-keys w2:p3 enter', 'tab create --workspace w2 --cwd D:/web', 'tab rename w2:t4 limits', 'pane send-text w2:p4 codex-yolo resume t1', 'pane send-keys w2:p4 enter'],
    },
  );
});

// Codex started in a new tab from the page shows its thread at once — its feed, before the first message — however many
// threads not written yet Codex holds open elsewhere: the first one made after it started
test('createTab_Should_ShowCodexStartedThere_ByTheFirstThreadMadeAfterItStarted', async () => {
  /** A thread Codex opened, nothing sent in it yet, made at this time: its id a UUID of version 7. @param {number} at @param {string} tail */
  const unwritten = (at, tail) => {
    const hex = at.toString(16).padStart(12, '0');
    return { id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7aaa-8bbb-${tail}`, cwd: undefined, name: undefined, activeAt: undefined };
  };
  const older = unwritten(Date.now() - 86_400_000, '000000000001');
  const other = unwritten(Date.now() - 3_600_000, '000000000002');
  const herdr = tabsHerdr({ panes: [{ pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1', cwd: 'D:/shop' }, { pane_id: 'w2:p3', workspace_id: 'w2', tab_id: 'w2:t3', cwd: 'D:/shop', agent: 'codex' }] });
  /** @type {import('../server/codex-live.js').LiveThread[]} */
  const threads = [older, other];
  const view = createHerdrView({ herdr: herdr.run, readRecords: async () => [], codexThreads: async () => threads, icons: noIcons, hidden: noHidden, hiddenWorkspaces: noHiddenWorkspaces, file: join(tempDir('ccw-codex-start-'), 'workspaces.json'), refreshMs: 0, trust: { looks: 3, stepMs: 1 }, claudeCommand: 'claude', codexCommand: 'codex' });
  const sessionOf = async () => (await view.layout()).workspaces.flatMap((workspace) => workspace.tabs.flatMap((tab) => tab.panes)).find((pane) => pane.id === 'w2:p3')?.session;

  const before = await sessionOf();
  await view.createTab('w2:t1', 'codex', undefined);
  const fresh = unwritten(Date.now() + 500, '000000000003');
  threads.push(fresh);
  const after = await sessionOf();

  assert.deepEqual({ before, after }, { before: undefined, after: fresh.id });
});

// A tab duplicated from the page: a new tab in its workspace and folder, named "<its name>::<the first number not
// taken>" — a copy of a copy counted on from the same name — the session in it forked: Claude Code resumes it as a new
// session, Codex forks its thread; a tab with no session gets a shell in its folder; the page goes to the new tab
test('duplicateTab_Should_OpenTabInItsFolder_ForkingItsSession', async () => {
  const copied = '1c2d3e4f-1111-4222-8333-944455556666';
  const thread = '01a13a06-5376-7481-9aa7-ec19297d2f7c';
  const tab = (/** @type {number} */ number, /** @type {string} */ label) => ({ tab_id: `w2:t${number}`, workspace_id: 'w2', number, label, agent_status: 'idle' });
  const herdr = tabsHerdr({
    opened: [tab(1, 'checkout fix'), tab(2, 'checkout fix::1'), tab(3, 'limits'), tab(4, '4')],
    panes: [
      { pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1', cwd: 'D:/shop', agent: 'claude', pid: 101 },
      { pane_id: 'w2:p2', workspace_id: 'w2', tab_id: 'w2:t2', cwd: 'D:/shop', agent: 'claude', pid: 202 },
      { pane_id: 'w2:p3', workspace_id: 'w2', tab_id: 'w2:t3', cwd: 'D:/web', agent: 'codex', terminal_title_stripped: 'Limits | web' },
      { pane_id: 'w2:p4', workspace_id: 'w2', tab_id: 'w2:t4', cwd: 'D:/notes' },
    ],
  });
  const folder = tempDir('ccw-workspaces-');
  const view = createHerdrView({
    herdr: herdr.run,
    readRecords: async () => [runningRecord, { ...runningRecord, pid: 202, sessionId: copied }],
    codexThreads: async () => [{ id: thread, cwd: 'D:/web', name: 'Limits', activeAt: 1 }],
    icons: noIcons,
    hidden: noHidden,
    hiddenWorkspaces: noHiddenWorkspaces,
    file: join(folder, 'workspaces.json'),
    refreshMs: 60_000,
    trust: { looks: 3, stepMs: 1 },
    claudeCommand: 'claude-fast',
    codexCommand: 'codex-yolo',
  });

  const outcomes = [await view.duplicateTab('w2:t1'), await view.duplicateTab('w2:t3'), await view.duplicateTab('w2:t4'), await view.duplicateTab('w2:t2')];

  assert.deepEqual(
    { outcomes, changes: herdr.changes },
    {
      outcomes: ['w2:p5', 'w2:p6', 'w2:p7', 'w2:p8'].map((pane) => ({ ok: true, target: `#/pane/${pane}` })),
      changes: [
        'tab create --workspace w2 --cwd D:/shop',
        'tab rename w2:t5 checkout fix::2',
        `pane send-text w2:p5 claude-fast --resume ${running} --fork-session`,
        'pane send-keys w2:p5 enter',
        'tab create --workspace w2 --cwd D:/web',
        'tab rename w2:t6 limits::1',
        `pane send-text w2:p6 codex-yolo fork ${thread}`,
        'pane send-keys w2:p6 enter',
        'tab create --workspace w2 --cwd D:/notes',
        'tab rename w2:t7 4::1',
        'tab create --workspace w2 --cwd D:/shop',
        'tab rename w2:t8 checkout fix::3',
        `pane send-text w2:p8 claude-fast --resume ${copied} --fork-session`,
        'pane send-keys w2:p8 enter',
      ],
    },
  );
});

// A session's id goes to a shell as typed: one that is no id — a record written over by hand — opens no copy at all
test('duplicateTab_Should_OpenNothing_When_SessionIdIsNoId', async () => {
  const herdr = tabsHerdr({
    opened: [{ tab_id: 'w2:t1', workspace_id: 'w2', number: 1, label: 'checkout fix', agent_status: 'idle' }],
    panes: [{ pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1', cwd: 'D:/shop', agent: 'claude', pid: 101 }],
  });
  const folder = tempDir('ccw-workspaces-');
  const view = createHerdrView({ herdr: herdr.run, readRecords: async () => [{ ...runningRecord, sessionId: `${running} & exit` }], codexThreads: async () => [], icons: noIcons, hidden: noHidden, hiddenWorkspaces: noHiddenWorkspaces, file: join(folder, 'workspaces.json'), refreshMs: 60_000, trust: { looks: 3, stepMs: 1 }, claudeCommand: 'claude-fast', codexCommand: 'codex-yolo' });

  assert.deepEqual({ outcome: await view.duplicateTab('w2:t1'), changes: herdr.changes }, { outcome: { ok: false, error: 'failed' }, changes: [] });
});

// Its workspace closed meanwhile — or the session never ran in herdr — it gets its workspace again, named as before or
// after its folder
test('reopen_Should_OpenWorkspaceAgain_When_ItIsGone', async () => {
  const herdr = tabsHerdr();
  const view = await viewWithHistory(herdr, { s8: { workspace: 'billing' } });

  const outcomes = [await view.reopen('s8', 'D:/dev/billing', 'claude'), await view.reopen('s7', 'D:/dev/reports', 'claude')];

  assert.deepEqual({ outcomes, changes: herdr.changes }, {
    outcomes: [{ ok: true, target: '#/s8' }, { ok: true, target: '#/s7' }],
    changes: [
      'workspace create --label billing --cwd D:/dev/billing',
      'pane send-text w5:p1 claude-fast --resume s8',
      'pane send-keys w5:p1 enter',
      'workspace create --label reports --cwd D:/dev/reports',
      'pane send-text w5:p1 claude-fast --resume s7',
      'pane send-keys w5:p1 enter',
    ],
  });
});

// A workspace opened from the page: its name on one line, in a folder that is there — with a shell, or Claude Code
// started in it — and the page goes to its first pane; a name of nothing or a folder that is not there opens nothing
test('createWorkspace_Should_OpenWorkspaceInFolder_And_StartClaudeOnRequest', async () => {
  const herdr = tabsHerdr();
  const view = await tabsView(herdr, 'claude-fast');
  const folder = tempDir('ccw-new-workspace-');

  const outcomes = [
    await view.createWorkspace('  billing\n api ', folder, 'claude', 'refuse'),
    await view.createWorkspace('notes', folder, 'shell', 'refuse'),
    await view.createWorkspace('gone', join(folder, 'missing'), 'shell', 'refuse'),
    await view.createWorkspace('  ', folder, 'shell', 'refuse'),
  ];

  assert.deepEqual(
    { outcomes, changes: herdr.changes },
    {
      outcomes: [{ ok: true, target: '#/pane/w5:p1' }, { ok: true, target: '#/pane/w5:p1' }, { ok: false, error: 'no-folder' }, { ok: false, error: 'empty' }],
      changes: [`workspace create --label billing api --cwd ${folder}`, 'pane send-text w5:p1 claude-fast', 'pane send-keys w5:p1 enter', `workspace create --label notes --cwd ${folder}`],
    },
  );
});

// A folder that is not there is made when asked — the folders above it too — and the workspace opens in it; one that
// cannot be made — a file is in its place — opens nothing
test('createWorkspace_Should_MakeFolderThatIsNotThere_WhenAsked', async () => {
  const herdr = tabsHerdr();
  const view = await tabsView(herdr, 'claude-fast');
  const root = tempDir('ccw-new-folder-');
  const fresh = join(root, 'agents', 'max');
  await writeFile(join(root, 'notes.txt'), 'x');

  const outcomes = [await view.createWorkspace('max', fresh, 'shell', 'create'), await view.createWorkspace('notes', join(root, 'notes.txt', 'inner'), 'shell', 'create')];

  assert.deepEqual(
    { outcomes, made: await stat(fresh).then((found) => found.isDirectory(), () => false), changes: herdr.changes },
    { outcomes: [{ ok: true, target: '#/pane/w5:p1' }, { ok: false, error: 'not-created' }], made: true, changes: [`workspace create --label max --cwd ${fresh}`] },
  );
});

// A pane with Codex runs the Codex thread open in its folder: herdr shows it as that session — its feed, not a
// terminal — the session goes into the pane's workspace, and the composer finds it there, at work or not; a thread
// Codex has open outside herdr is elsewhere, one it has not, nowhere
test('herdrView_Should_ShowCodexPaneAsItsThread_AndTellWhereCodexSessionRuns', async (t) => {
  const decompile = '01a13a06-5376-7481-9aa7-ec19297d2f7c';
  const outside = '01a13a0c-abb5-7b01-9fd2-27db36461cc1';
  const herdr = fakeHerdr({
    workspaces: [{ workspace_id: 'w4', label: 'maptool', active_tab_id: 'w4:t1' }],
    tabs: [{ tab_id: 'w4:t1', workspace_id: 'w4', number: 1, label: 'game', agent_status: 'working' }],
    panes: [{ pane_id: 'w4:p1', workspace_id: 'w4', tab_id: 'w4:t1', cwd: 'D:/gits/maptool', agent: 'codex', agent_status: 'working', terminal_title_stripped: 'Redraw the old map | maptool', state_change_seq: 9 }],
  });
  const codex = [
    { id: decompile, cwd: 'D:/gits/maptool', name: 'Redraw the old map', activeAt: 2 },
    { id: outside, cwd: 'D:/gits/other', name: undefined, activeAt: 1 },
  ];
  const view = await workspacesOf(t, { herdr, records: [], codex });

  const layout = await view.layout();
  assert.deepEqual(
    {
      session: layout.workspaces[0]?.tabs[0]?.panes[0]?.session,
      workspaces: await view.workspacesOf([{ id: decompile, cwd: 'D:/gits/maptool' }]),
      places: [await view.codexPlace(decompile), await view.codexPlace(outside), await view.codexPlace('01a13a19-7468-7bc1-ae3c-7dcdcbdb008d')],
    },
    {
      session: decompile,
      workspaces: { herdr: true, sessions: { [decompile]: 'maptool' }, icons: {} },
      places: [{ found: 'pane', pane: 'w4:p1', working: true }, { found: 'elsewhere' }, { found: 'none' }],
    },
  );
});

// An agy pane shows the conversation agy streams there — its run in the pane's folder — remembered in its workspace;
// before its first message, its run by the run's own id, which no tab's history keeps: agy makes the conversation the
// tab goes on with. agy tells where it runs a conversation: in that pane, elsewhere — a program's run — or nowhere. A
// Codex session is not looked for in agy's panes. With a command that starts agy, the page is told a new tab may start it
test('herdrView_Should_ShowAgyPaneAsItsConversation_AndTellWhereAgyRunsIt', async (t) => {
  const filter = 'c2da1db1-1271-4baa-aac2-0f4026b2453a';
  const printed = '9342f993-b892-4839-845d-ce2d261b092e';
  const herdr = fakeHerdr({
    workspaces: [{ workspace_id: 'w5', label: 'shop', active_tab_id: 'w5:t1' }],
    tabs: [
      { tab_id: 'w5:t1', workspace_id: 'w5', number: 1, label: 'filters', agent_status: 'working' },
      { tab_id: 'w5:t2', workspace_id: 'w5', number: 2, label: 'maps', agent_status: 'idle' },
    ],
    panes: [
      { pane_id: 'w5:p1', workspace_id: 'w5', tab_id: 'w5:t1', cwd: 'D:/dev/shop', agent: 'agy', agent_status: 'working', terminal_title_stripped: 'agy', state_change_seq: 4 },
      { pane_id: 'w5:p2', workspace_id: 'w5', tab_id: 'w5:t2', cwd: 'D:/dev/maps', agent: 'agy', agent_status: 'idle', terminal_title_stripped: 'agy', state_change_seq: 2 },
    ],
  });
  /** @type {import('../server/agy-live.js').AgyRun} */
  const fresh = { serverPid: 103, folder: 'D:\\dev\\maps', conversation: undefined, print: false, ended: false, startedAt: 3000 };
  const agy = [
    { serverPid: 101, folder: 'D:\\dev\\shop', conversation: filter, print: false, ended: false, startedAt: 1000 },
    { serverPid: 102, folder: 'D:\\dev\\notes', conversation: printed, print: true, ended: false, startedAt: 2000 },
    fresh,
  ];
  const view = await workspacesOf(t, { herdr, records: [], agy, agyCommand: 'agy' });

  const layout = await view.layout();
  assert.deepEqual(
    {
      agy: layout.agy,
      sessions: layout.workspaces[0]?.tabs.map((tab) => tab.panes[0]?.session),
      workspaces: await view.workspacesOf([{ id: filter, cwd: 'D:/dev/shop' }]),
      kept: Object.keys(await view.history()),
      places: [await view.agyPlace(filter), await view.agyPlace(agyStartedId(fresh)), await view.agyPlace(printed), await view.agyPlace('0569c158-6d1a-409e-9a15-6e92eaf4c4a1'), await view.codexPlace(filter)],
    },
    {
      agy: true,
      sessions: [filter, agyStartedId(fresh)],
      workspaces: { herdr: true, sessions: { [filter]: 'shop' }, icons: {} },
      kept: [filter],
      places: [{ found: 'pane', pane: 'w5:p1', working: true }, { found: 'pane', pane: 'w5:p2', working: false }, { found: 'elsewhere' }, { found: 'none' }, { found: 'none' }],
    },
  );
});

/**
 * herdr with trip_plans, its one pane's agent done at this count of its changes; a view of it keeping its hidden panes
 * in the folder.
 * @param {string} folder
 * @param {FakePane} pane
 */
function hidingView(folder, pane) {
  const herdr = fakeHerdr({ workspaces: tripPlans.workspaces, tabs: [{ tab_id: 'w2:t1', workspace_id: 'w2', number: 1, label: 'search', agent_status: 'done' }], panes: [pane] });
  return createHerdrView({ herdr, readRecords: async () => [], codexThreads: async () => [], icons: noIcons, hidden: createHiddenPanes(join(folder, 'hidden-panes.json')), hiddenWorkspaces: noHiddenWorkspaces, file: join(folder, 'workspaces.json'), refreshMs: 0, trust: { looks: 3, stepMs: 1 }, claudeCommand: 'claude', codexCommand: 'codex' });
}

/**
 * herdr with web and web-review — both their tabs in D:\web — and notes, in D:\notes; a view of it keeping its hidden
 * workspaces in the folder.
 * @param {string} folder
 */
function workspacesView(folder) {
  const herdr = fakeHerdr({
    workspaces: [
      { workspace_id: 'w2', label: 'web' },
      { workspace_id: 'w3', label: 'notes' },
      { workspace_id: 'w4', label: 'web-review' },
    ],
    tabs: [
      { tab_id: 'w2:t1', workspace_id: 'w2', number: 1, label: 'checkout', agent_status: 'idle' },
      { tab_id: 'w3:t1', workspace_id: 'w3', number: 1, label: '1', agent_status: 'idle' },
      { tab_id: 'w4:t1', workspace_id: 'w4', number: 1, label: 'review', agent_status: 'idle' },
    ],
    panes: [
      { pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1', cwd: 'D:\\web' },
      { pane_id: 'w3:p1', workspace_id: 'w3', tab_id: 'w3:t1', cwd: 'D:\\notes' },
      { pane_id: 'w4:p1', workspace_id: 'w4', tab_id: 'w4:t1', cwd: 'D:\\web' },
    ],
  });
  return createHerdrView({ herdr, readRecords: async () => [], codexThreads: async () => [], icons: noIcons, hidden: noHidden, hiddenWorkspaces: createHiddenWorkspaces(join(folder, 'hidden-workspaces.json')), file: join(folder, 'workspaces.json'), refreshMs: 0, trust: { looks: 3, stepMs: 1 }, claudeCommand: 'claude', codexCommand: 'codex' });
}

/** @param {import('../public/model/herdr.js').HerdrLayout} layout */
const hiddenWorkspaces = (layout) => layout.workspaces.filter((workspace) => workspace.hidden === true).map((workspace) => workspace.label);

// A workspace hidden from the page's list is hidden alone — another open in its folder stays listed — and stays hidden,
// for the viewer started again too: it is kept by its id, which herdr keeps over its restarts — until it is shown again;
// a workspace herdr does not have is not hidden
test('hideWorkspace_Should_HideThatWorkspaceAlone_UntilShownAgain', async () => {
  const folder = tempDir('ccw-hidden-workspaces-');
  const view = workspacesView(folder);

  const outcomes = [await view.hideWorkspace('w2'), await view.hideWorkspace('w9')];
  const hidden = hiddenWorkspaces(await view.layout());
  const again = workspacesView(folder);
  const afterRestart = hiddenWorkspaces(await again.layout());
  const showing = await again.showWorkspace('w2');
  const shown = hiddenWorkspaces(await again.layout());

  assert.deepEqual({ outcomes, hidden, afterRestart, showing, shown }, { outcomes: [{ ok: true }, { ok: false, error: 'failed' }], hidden: ['web'], afterRestart: ['web'], showing: { ok: true }, shown: [] });
});

/** @param {import('../public/model/herdr.js').HerdrLayout} layout */
const hiddenPanes = (layout) => layout.workspaces.flatMap((workspace) => workspace.tabs.flatMap((tab) => tab.panes.filter((pane) => pane.hidden === true).map((pane) => pane.id)));

// A session idle in its pane, hidden from the page, stays hidden — for the viewer started again too — until its agent
// changes state: once it works, it shows again, and stays shown once it is done; a pane herdr does not have is not hidden
test('hidePane_Should_HidePaneUntilItsAgentChangesState', async () => {
  const folder = tempDir('ccw-hidden-');
  /** @type {FakePane} */
  const pane = { pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1', cwd: 'D:\trip_plans', agent: 'claude', agent_status: 'done', state_change_seq: 50 };
  const view = hidingView(folder, pane);

  const outcomes = [await view.hidePane('w2:p1'), await view.hidePane('w9:p1')];
  const hidden = hiddenPanes(await view.layout());
  const afterRestart = hiddenPanes(await hidingView(folder, pane).layout());
  Object.assign(pane, { agent_status: 'working', state_change_seq: 51 });
  const working = hiddenPanes(await view.layout());
  Object.assign(pane, { agent_status: 'done', state_change_seq: 52 });
  const doneAgain = hiddenPanes(await view.layout());

  assert.deepEqual(
    { outcomes, hidden, afterRestart, working, doneAgain },
    { outcomes: [{ ok: true }, { ok: false, error: 'failed' }], hidden: ['w2:p1'], afterRestart: ['w2:p1'], working: [], doneAgain: [] },
  );
});

// The sessions hidden are shown again at the page's asking, before their agents change state
test('showHidden_Should_ShowEveryHiddenPaneAgain', async () => {
  const folder = tempDir('ccw-hidden-');
  const view = hidingView(folder, { pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1', cwd: 'D:\trip_plans', agent: 'claude', agent_status: 'idle', state_change_seq: 7 });
  await view.hidePane('w2:p1');

  const outcome = await view.showHidden();

  assert.deepEqual({ outcome, hidden: hiddenPanes(await view.layout()) }, { outcome: { ok: true }, hidden: [] });
});

// herdr that tells no count of an agent's changes: its pane hidden while idle shows again once its agent works
test('hidePane_Should_ShowPaneAgainOnceItsAgentWorks_When_HerdrTellsNoCount', async () => {
  const folder = tempDir('ccw-hidden-');
  /** @type {FakePane} */
  const pane = { pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1', cwd: 'D:\trip_plans', agent: 'claude', agent_status: 'idle' };
  const view = hidingView(folder, pane);
  await view.hidePane('w2:p1');

  const idle = hiddenPanes(await view.layout());
  pane.agent_status = 'working';
  const working = hiddenPanes(await view.layout());

  assert.deepEqual({ idle, working }, { idle: ['w2:p1'], working: [] });
});

// A session restarted plainly resumes in its tab with no variables set ahead of it, those given or not
test('restart_Should_ResumeSessionWithNoVariables_When_RestartedPlainly', async () => {
  const herdr = tabsHerdr({ panes: [{ pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1', cwd: 'D:/shop', agent: 'claude', pid: 101 }] });
  const env = [{ name: 'CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP', value: '1' }];
  const view = createHerdrView({ herdr: herdr.run, readRecords: async () => [runningRecord], codexThreads: async () => [], icons: noIcons, hidden: noHidden, hiddenWorkspaces: noHiddenWorkspaces, file: join(tempDir('ccw-restart-'), 'workspaces.json'), refreshMs: 0, trust: { looks: 3, stepMs: 1 }, claudeCommand: 'my-claude', codexCommand: 'codex', restart: { env, shell: 'powershell', endProcess: async () => true } });

  const outcome = await view.restart(running, 'none', 'as-it-ran');

  assert.deepEqual({ outcome, typed: herdr.changes.filter((change) => change.startsWith('pane send-text')) }, { outcome: { ok: true }, typed: [`pane send-text w2:p1 my-claude --resume ${running}`] });
});

// A session restarted in the other launcher than it ran in — through GPT from ordinary Claude Code, in ordinary Claude
// Code from GPT, asked for no GPT model there — runs in it from then on: the history tells so at once, while its last
// answer is still the other one's; a restart as it ran starts it there; the history goes on telling so once the session
// has answered there
test('restart_Should_ResumeSessionInLauncherAsked_AndKeepItThere_BeforeAndAfterItAnswers', async () => {
  /** @type {readonly (readonly [string, 'claude' | 'claude-gpt', string])[]} — the model it answered with, the launcher asked, the model it answers with there */
  const switches = [
    ['gpt-6-sol', 'claude', 'claude-opus-5-5'],
    ['claude-opus-5-5', 'claude-gpt', 'gpt-6-sol'],
  ];
  const seen = [];
  for (const [before, launcher, after] of switches) {
    const herdr = tabsHerdr({ panes: [{ pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1', cwd: 'D:/shop', agent: 'claude', pid: 101 }] });
    let answer = { model: before, at: Date.now() - 60_000 };
    const view = createHerdrView({ herdr: herdr.run, readRecords: async () => [runningRecord], codexThreads: async () => [], icons: noIcons, hidden: noHidden, hiddenWorkspaces: noHiddenWorkspaces, file: join(tempDir('ccw-restart-'), 'workspaces.json'), refreshMs: 0, trust: { looks: 3, stepMs: 1 }, claudeCommand: 'claude-normal', claudeGptCommand: 'claude-via-gpt', claudeModelOf: async () => answer, codexCommand: 'codex', restart: { env: [], shell: 'posix', endProcess: async () => true } });
    const throughGpt = async () => (await view.history())[running]?.claudeGpt === true;

    const ranThroughGpt = await throughGpt();
    await view.restart(running, 'none', launcher);
    const atOnce = await throughGpt();
    await view.restart(running, 'none', 'as-it-ran');
    answer = { model: after, at: Date.now() + 60_000 };
    seen.push({ ranThroughGpt, atOnce, typed: herdr.changes.filter((change) => change.startsWith('pane send-text')), answered: await throughGpt() });
  }

  assert.deepEqual(seen, [
    { ranThroughGpt: true, atOnce: false, typed: [`pane send-text w2:p1 claude-normal --resume ${running}`, `pane send-text w2:p1 claude-normal --resume ${running}`], answered: false },
    { ranThroughGpt: false, atOnce: true, typed: [`pane send-text w2:p1 claude-via-gpt --resume ${running}`, `pane send-text w2:p1 claude-via-gpt --resume ${running}`], answered: true },
  ]);
});

// A tab with nothing running in it — its shell at its prompt, as herdr brings tabs back after a restart of the computer
// — goes on with the conversation that ran last in it: Claude Code resumes it there — through GPT when it ran so —
// or Codex; a tab the history does not know goes on with its folder's latest Claude Code conversation, as
// claude --continue would. Nothing is typed into a tab where something runs, nor is a conversation Claude Code runs now
// — in another tab, in another terminal — started twice
test('continueTab_Should_ResumeTabsLatestConversationInItsShell_NeverOverWhatRuns', async () => {
  const id = (/** @type {string} */ n) => `a1b2c3d4-1111-4222-8333-9444555566${n}`;
  const [checkout, mail, limits, deploy, editor, notesLatest, notesEarlier, shop] = [id('01'), id('02'), id('03'), id('04'), id('05'), id('06'), id('07'), id('08')];
  const names = ['checkout', 'mail', 'limits', 'notes', 'deploy', 'editor'];
  const herdr = tabsHerdr({
    opened: names.map((label, at) => ({ tab_id: `w2:t${at + 1}`, workspace_id: 'w2', number: at + 1, label, agent_status: 'unknown' })),
    panes: names.map((label, at) => ({ pane_id: `w2:p${at + 1}`, workspace_id: 'w2', tab_id: `w2:t${at + 1}`, cwd: 'D:/web', pid: 300 + at, shell_pid: label === 'editor' ? 400 : 300 + at })),
  });
  const folder = tempDir('ccw-continue-');
  const ran = (/** @type {string} */ tab, /** @type {Partial<import('../public/model/history.js').Place>} */ more = {}) => ({ workspace: 'web', tab, folder: 'D:/web', earlierTabs: [], firstSeen: 1, lastSeen: 2, open: false, ...more });
  await writeFile(join(folder, 'workspaces.json'), JSON.stringify({ [checkout]: ran('checkout'), [mail]: ran('mail', { claudeGpt: true }), [limits]: ran('limits'), [deploy]: ran('deploy'), [editor]: ran('editor') }));
  // the deploy tab's conversation runs now in a terminal of its own
  const records = [{ pid: 900, sessionId: deploy, kind: 'interactive', status: 'idle', updatedAt: 1 }];
  const view = createHerdrView({ herdr: herdr.run, readRecords: async () => records, codexThreads: async () => [], icons: noIcons, hidden: noHidden, hiddenWorkspaces: noHiddenWorkspaces, file: join(folder, 'workspaces.json'), refreshMs: 60_000, trust: { looks: 3, stepMs: 1 }, claudeCommand: 'claude-fast', claudeGptCommand: 'claude-via-gpt', codexCommand: 'codex-yolo' });
  /** @param {string} id @param {Partial<import('../server/sessions.js').SessionInfo>} [more] */
  const listed = (id, more = {}) => ({ id, agent: /** @type {import('../server/sessions.js').Agent} */ ('claude'), cwd: 'D:\\web', kind: /** @type {import('../server/sessions.js').SessionKind} */ ('interactive'), modifiedAt: 1, ...more });
  const sessions = [listed(limits, { agent: 'codex', modifiedAt: 20 }), listed(notesEarlier, { modifiedAt: 5 }), listed(notesLatest, { modifiedAt: 9 }), listed(shop, { cwd: 'D:\\shop', modifiedAt: 30 })];

  /** @type {import('../public/model/herdr.js').TabChange[]} */
  const outcomes = [];
  for (let at = 1; at <= names.length; at++) outcomes.push(await view.continueTab(`w2:t${at}`, sessions));

  assert.deepEqual({ outcomes, typed: herdr.changes.filter((change) => change.startsWith('pane send-text')) }, {
    outcomes: [{ ok: true }, { ok: true }, { ok: true }, { ok: true }, { ok: false, error: 'failed' }, { ok: false, error: 'failed' }],
    typed: [`pane send-text w2:p1 claude-fast --resume ${checkout}`, `pane send-text w2:p2 claude-via-gpt --resume ${mail}`, `pane send-text w2:p3 codex-yolo resume ${limits}`, `pane send-text w2:p4 claude-fast --resume ${notesLatest}`],
  });
});

// A tab whose last conversation was agy's goes on with it in agy; one agy holds open now — a program's run writing it,
// another terminal — is not started twice
test('continueTab_Should_ResumeAgysConversationInAgy_UnlessAgyHoldsItNow', async () => {
  const [filters, search] = ['c2da1db1-1271-4baa-aac2-0f4026b2453a', '9342f993-b892-4839-845d-ce2d261b092e'];
  const names = ['filters', 'search'];
  const herdr = tabsHerdr({
    opened: names.map((label, at) => ({ tab_id: `w2:t${at + 1}`, workspace_id: 'w2', number: at + 1, label, agent_status: 'unknown' })),
    panes: names.map((label, at) => ({ pane_id: `w2:p${at + 1}`, workspace_id: 'w2', tab_id: `w2:t${at + 1}`, cwd: 'D:/shop', pid: 300 + at, shell_pid: 300 + at })),
  });
  const folder = tempDir('ccw-continue-agy-');
  const ran = (/** @type {string} */ tab) => ({ workspace: 'web', tab, folder: 'D:/shop', earlierTabs: [], firstSeen: 1, lastSeen: 2, open: false });
  await writeFile(join(folder, 'workspaces.json'), JSON.stringify({ [filters]: ran('filters'), [search]: ran('search') }));
  const view = createHerdrView({ herdr: herdr.run, readRecords: async () => [], codexThreads: async () => [], agyRuns: async () => [{ serverPid: 51520, folder: 'D:\\shop', conversation: search, print: true, ended: false, startedAt: 1000 }], icons: noIcons, hidden: noHidden, hiddenWorkspaces: noHiddenWorkspaces, file: join(folder, 'workspaces.json'), refreshMs: 60_000, trust: { looks: 3, stepMs: 1 }, claudeCommand: 'claude', codexCommand: 'codex', agyCommand: 'agy' });
  const listed = (/** @type {string} */ id) => ({ id, agent: /** @type {import('../server/sessions.js').Agent} */ ('agy'), cwd: 'D:\\shop', kind: /** @type {import('../server/sessions.js').SessionKind} */ ('interactive'), modifiedAt: 1 });

  const outcomes = [await view.continueTab('w2:t1', [listed(filters), listed(search)]), await view.continueTab('w2:t2', [listed(filters), listed(search)])];

  assert.deepEqual({ outcomes, typed: herdr.changes.filter((change) => change.startsWith('pane send-text')) }, { outcomes: [{ ok: true }, { ok: false, error: 'failed' }], typed: [`pane send-text w2:p1 agy --conversation ${filters}`] });
});

// Exit in a session's details: what runs over its tab's shell — Claude Code, or Codex — ends, its turn and background
// commands with it, the tab left at its shell's prompt, nothing typed there; a session in no herdr tab, or a pane whose
// shell herdr does not tell — what to end and what to leave unknown — is not touched
test('exit_Should_EndWhatRunsOverTabsShell_ForClaudeAndCodex_LeavingTheShell', async () => {
  const thread = '01a13a06-5376-7481-9aa7-ec19297d2f7c';
  const unknownShell = '9a1c2a10-1111-4222-8333-000000000301';
  const herdr = fakeHerdr({
    workspaces: [{ workspace_id: 'w2', label: 'web' }],
    tabs: ['shop', 'maps', 'notes'].map((label, at) => ({ tab_id: `w2:t${at + 1}`, workspace_id: 'w2', number: at + 1, label, agent_status: 'idle' })),
    panes: [
      { pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1', cwd: 'D:/shop', agent: 'claude', pid: 101, shell_pid: 100 },
      { pane_id: 'w2:p2', workspace_id: 'w2', tab_id: 'w2:t2', cwd: 'D:/maps', agent: 'codex', terminal_title_stripped: 'Draw the old map | maps', pid: 201, shell_pid: 200 },
      { pane_id: 'w2:p3', workspace_id: 'w2', tab_id: 'w2:t3', cwd: 'D:/notes', agent: 'claude', pid: 301 },
    ],
  });
  /** @type {number[]} */
  const ended = [];
  const records = [runningRecord, { pid: 301, sessionId: unknownShell, kind: 'interactive', status: 'idle', updatedAt: 1 }];
  const view = createHerdrView({ herdr, readRecords: async () => records, codexThreads: async () => [{ id: thread, cwd: 'D:/maps', name: 'Draw the old map', activeAt: 2 }], icons: noIcons, hidden: noHidden, hiddenWorkspaces: noHiddenWorkspaces, file: join(tempDir('ccw-exit-'), 'workspaces.json'), refreshMs: 0, trust: { looks: 3, stepMs: 1 }, claudeCommand: 'claude', codexCommand: 'codex', restart: { env: [], shell: 'posix', endProcess: async (pid) => (ended.push(pid), true) } });

  const outcomes = [await view.exit(running), await view.exit(thread), await view.exit(unknownShell), await view.exit('9a1c2a10-1111-4222-8333-000000000999')];

  assert.deepEqual({ outcomes, ended }, { outcomes: [{ ok: true }, { ok: true }, { ok: false, error: 'failed' }, { ok: false, error: 'failed' }], ended: [101, 201] });
});
