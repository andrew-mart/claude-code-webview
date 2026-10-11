import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHerdrView } from '../server/herdr-view.js';

const running = '7d4e1b20-2222-4333-8444-955566667777';

/**
 * @typedef {{ workspace_id: string, label: string, number?: number, agent_status?: string, active_tab_id?: string }} FakeWorkspace
 * @typedef {{ tab_id: string, workspace_id: string, number: number, label: string, agent_status: string }} FakeTab
 * @typedef {{ pane_id: string, workspace_id: string, cwd: string, tab_id?: string, agent?: string, agent_status?: string, terminal_title_stripped?: string, pid?: number }} FakePane
 * @typedef {{ tab_id: string, workspace_id: string, panes: { pane_id: string, rect: { x: number, y: number, width: number, height: number } }[] }} FakeLayout
 */

/**
 * A fake herdr: workspaces (numbered in order unless told), tabs and panes; a pane's pid is what process-info tells
 * about it. missing — herdr is not installed at all; fail — installed, but no server answers.
 * @param {{ workspaces?: readonly FakeWorkspace[], tabs?: readonly FakeTab[], panes?: readonly FakePane[], layouts?: readonly FakeLayout[], missing?: boolean, fail?: boolean }} [layout]
 */
function fakeHerdr({ workspaces = [], tabs = [], panes = [], layouts = [], missing = false, fail = false } = {}) {
  /** @param {readonly string[]} args @returns {Promise<import('../server/composer.js').HerdrReply>} */
  return async (args) => {
    if (missing) return { ok: false, error: 'spawn herdr ENOENT', missing: true };
    if (fail) return { ok: false, error: 'no herdr server is running', missing: false };
    const [subject, command, , pane] = args;
    if (subject === 'api' && command === 'snapshot') {
      const shown = { workspaces: workspaces.map((workspace, at) => ({ number: at + 1, ...workspace })), tabs, panes: panes.map(({ pid, ...pane }) => pane), layouts };
      return { ok: true, json: { result: { type: 'session_snapshot', snapshot: shown } }, text: '' };
    }
    if (subject === 'pane' && command === 'process-info') {
      const pid = panes.find((known) => known.pane_id === pane)?.pid;
      return { ok: true, json: { result: { process_info: { foreground_processes: pid === undefined ? [] : [{ pid }] } } }, text: '' };
    }
    return { ok: false, error: `the fake herdr does not know ${args.join(' ')}`, missing: false };
  };
}

/** herdr with job_search, where Claude runs the session in a pane opened in D:\job_search, and expenses. */
const jobSearch = {
  workspaces: [
    { workspace_id: 'w2', label: 'job_search' },
    { workspace_id: 'w3', label: 'expenses' },
  ],
  panes: [{ pane_id: 'w2:p1', workspace_id: 'w2', cwd: 'D:\\job_search', agent: 'claude', pid: 101 }],
};
const runningRecord = { pid: 101, sessionId: running, kind: 'interactive', status: 'idle', updatedAt: 1 };

/**
 * @param {import('node:test').TestContext} t
 * @param {{ herdr: ReturnType<typeof fakeHerdr>, records: readonly unknown[], dir?: string }} setup — dir: where the
 *   remembered workspaces are kept, to share it between two viewer runs
 */
async function workspacesOf(t, { herdr, records, dir }) {
  const folder = dir ?? (await mkdtemp(join(tmpdir(), 'ccw-workspaces-')));
  return createHerdrView({ herdr, readRecords: async () => records, file: join(folder, 'workspaces.json'), refreshMs: 0 });
}

test('workspaces_Should_PutRunningSessionIntoWorkspaceOfItsPane', async (t) => {
  const workspaces = await workspacesOf(t, { herdr: fakeHerdr(jobSearch), records: [runningRecord] });

  assert.deepEqual(await workspaces.workspacesOf([{ id: running, cwd: 'D:\\elsewhere' }]), { herdr: true, sessions: { [running]: 'job_search' } });
});

// Once seen running, a session stays in its workspace after it ends — the pane closed, the viewer restarted
test('workspaces_Should_KeepWorkspaceOfSessionSeenRunning_AfterItEnds', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ccw-workspaces-'));
  await (await workspacesOf(t, { herdr: fakeHerdr(jobSearch), records: [runningRecord], dir })).workspacesOf([{ id: running, cwd: 'D:\\elsewhere' }]);

  const afterRestart = await workspacesOf(t, { herdr: fakeHerdr({ workspaces: jobSearch.workspaces }), records: [], dir });

  assert.deepEqual(await afterRestart.workspacesOf([{ id: running, cwd: 'D:\\elsewhere' }]), { herdr: true, sessions: { [running]: 'job_search' } });
});

// A session never seen running belongs to the workspace whose panes are open in its folder — when there is just one
test('workspaces_Should_PutOldSessionIntoTheOnlyWorkspaceWithPaneInItsFolder', async (t) => {
  const herdr = fakeHerdr({
    workspaces: [
      { workspace_id: 'w2', label: 'job_search' },
      { workspace_id: 'w3', label: 'expenses' },
      { workspace_id: 'w4', label: 'web' },
    ],
    panes: [
      { pane_id: 'w2:p1', workspace_id: 'w2', cwd: 'D:\\job_search', agent: 'claude', pid: 101 },
      { pane_id: 'w2:p2', workspace_id: 'w2', cwd: 'D:\\dev' },
      { pane_id: 'w3:p1', workspace_id: 'w3', cwd: 'D:\\expenses' },
      { pane_id: 'w4:p1', workspace_id: 'w4', cwd: 'D:\\dev' },
    ],
  });
  const workspaces = await workspacesOf(t, { herdr, records: [runningRecord] });

  const found = await workspaces.workspacesOf([
    { id: running, cwd: 'D:\\expenses' },
    { id: 'old', cwd: 'd:\\Expenses\\' },
    { id: 'shared', cwd: 'D:\\dev' },
    { id: 'nowhere', cwd: undefined },
  ]);

  assert.deepEqual(found, { herdr: true, sessions: { [running]: 'job_search', old: 'expenses' } });
});

// Without herdr the page shows no workspaces at all
test('workspaces_Should_TellThereIsNoHerdr_When_ItIsNotInstalledOrDoesNotAnswer', async (t) => {
  const sessions = [{ id: running, cwd: 'D:\\job_search' }];

  const replies = await Promise.all(
    [fakeHerdr({ ...jobSearch, missing: true }), fakeHerdr({ ...jobSearch, fail: true })].map(async (herdr) => (await workspacesOf(t, { herdr, records: [runningRecord] })).workspacesOf(sessions)),
  );

  assert.deepEqual(replies, [
    { herdr: false, sessions: {} },
    { herdr: false, sessions: {} },
  ]);
});

// The page asks every few seconds, and every herdr call starts a process
test('workspaces_Should_AskHerdrAtMostOncePerRefreshPeriod', async (t) => {
  /** @type {string[]} */
  const asked = [];
  const herdr = fakeHerdr(jobSearch);
  /** @param {readonly string[]} args */
  const counting = (args) => {
    asked.push(args.slice(0, 2).join(' '));
    return herdr(args);
  };
  const folder = await mkdtemp(join(tmpdir(), 'ccw-workspaces-'));
  const workspaces = createHerdrView({ herdr: counting, readRecords: async () => [runningRecord], file: join(folder, 'workspaces.json'), refreshMs: 60_000 });

  await Promise.all([workspaces.workspacesOf([]), workspaces.workspacesOf([])]);
  await workspaces.workspacesOf([{ id: running, cwd: undefined }]);

  assert.equal(asked.filter((call) => call === 'api snapshot').length, 1);
});

// The sidebar and the session header show herdr as it is: workspaces and tabs in herdr's order, the panes in each tab,
// and which session runs in a pane with Claude Code
test('herdrView_Should_LayOutWorkspacesTabsAndPanes_WithSessionOfClaudePane', async (t) => {
  const herdr = fakeHerdr({
    workspaces: [
      { workspace_id: 'w3', label: 'expenses', number: 2, agent_status: 'idle', active_tab_id: 'w3:t1' },
      { workspace_id: 'w2', label: 'job_search', number: 1, agent_status: 'working', active_tab_id: 'w2:t3' },
    ],
    tabs: [
      { tab_id: 'w2:t3', workspace_id: 'w2', number: 3, label: 'search', agent_status: 'working' },
      { tab_id: 'w3:t1', workspace_id: 'w3', number: 1, label: '1', agent_status: 'unknown' },
      { tab_id: 'w2:t1', workspace_id: 'w2', number: 1, label: 'resume', agent_status: 'done' },
    ],
    panes: [
      { pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1', cwd: 'D:/job_search', agent: 'claude', agent_status: 'done', terminal_title_stripped: 'Resume', pid: 101 },
      { pane_id: 'w2:p3', workspace_id: 'w2', tab_id: 'w2:t3', cwd: 'D:/job_search', agent: 'claude', agent_status: 'working', terminal_title_stripped: 'Search', pid: 303 },
      { pane_id: 'w3:p1', workspace_id: 'w3', tab_id: 'w3:t1', cwd: 'D:/expenses', agent_status: 'unknown', terminal_title_stripped: 'nvim' },
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
        label: 'job_search',
        status: 'working',
        activeTab: 'w2:t3',
        tabs: [
          { id: 'w2:t1', number: 1, label: 'resume', status: 'done', panes: [{ id: 'w2:p1', agent: 'claude', status: 'done', title: 'Resume', session: running, size: { cols: 154, rows: 44 } }] },
          { id: 'w2:t3', number: 3, label: 'search', status: 'working', panes: [{ id: 'w2:p3', agent: 'claude', status: 'working', title: 'Search', session: undefined, size: undefined }] },
        ],
      },
      {
        id: 'w3',
        number: 2,
        label: 'expenses',
        status: 'idle',
        activeTab: 'w3:t1',
        tabs: [{ id: 'w3:t1', number: 1, label: '1', status: 'unknown', panes: [{ id: 'w3:p1', agent: undefined, status: 'unknown', title: 'nvim', session: undefined, size: { cols: 100, rows: 30 } }] }],
      },
    ],
  });
});
