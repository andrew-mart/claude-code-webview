import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaces } from '../server/workspaces.js';

const running = '7d4e1b20-2222-4333-8444-955566667777';

/**
 * @typedef {{ pane_id: string, workspace_id: string, cwd: string, agent?: string, pid?: number }} FakePane
 */

/**
 * A fake herdr: workspaces by id and label, and panes; a pane's pid is what process-info tells about it.
 * missing — herdr is not installed at all; fail — installed, but no server answers.
 * @param {{ workspaces?: readonly { workspace_id: string, label: string }[], panes?: readonly FakePane[], missing?: boolean, fail?: boolean }} [layout]
 */
function fakeHerdr({ workspaces = [], panes = [], missing = false, fail = false } = {}) {
  /** @param {readonly string[]} args @returns {Promise<import('../server/composer.js').HerdrReply>} */
  return async (args) => {
    if (missing) return { ok: false, error: 'spawn herdr ENOENT', missing: true };
    if (fail) return { ok: false, error: 'no herdr server is running', missing: false };
    const [subject, command, , pane] = args;
    if (subject === 'workspace' && command === 'list') return { ok: true, json: { result: { type: 'workspace_list', workspaces } }, text: '' };
    if (subject === 'pane' && command === 'list') return { ok: true, json: { result: { panes: panes.map(({ pid, ...shown }) => shown) } }, text: '' };
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
  return createWorkspaces({ herdr, readRecords: async () => records, file: join(folder, 'workspaces.json'), refreshMs: 0 });
}

test('workspaces_Should_PutRunningSessionIntoWorkspaceOfItsPane', async (t) => {
  const workspaces = await workspacesOf(t, { herdr: fakeHerdr(jobSearch), records: [runningRecord] });

  assert.deepEqual(await workspaces.of([{ id: running, cwd: 'D:\\elsewhere' }]), { herdr: true, sessions: { [running]: 'job_search' } });
});

// Once seen running, a session stays in its workspace after it ends — the pane closed, the viewer restarted
test('workspaces_Should_KeepWorkspaceOfSessionSeenRunning_AfterItEnds', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ccw-workspaces-'));
  await (await workspacesOf(t, { herdr: fakeHerdr(jobSearch), records: [runningRecord], dir })).of([{ id: running, cwd: 'D:\\elsewhere' }]);

  const afterRestart = await workspacesOf(t, { herdr: fakeHerdr({ workspaces: jobSearch.workspaces }), records: [], dir });

  assert.deepEqual(await afterRestart.of([{ id: running, cwd: 'D:\\elsewhere' }]), { herdr: true, sessions: { [running]: 'job_search' } });
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

  const found = await workspaces.of([
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
    [fakeHerdr({ ...jobSearch, missing: true }), fakeHerdr({ ...jobSearch, fail: true })].map(async (herdr) => (await workspacesOf(t, { herdr, records: [runningRecord] })).of(sessions)),
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
  const workspaces = createWorkspaces({ herdr: counting, readRecords: async () => [runningRecord], file: join(folder, 'workspaces.json'), refreshMs: 60_000 });

  await Promise.all([workspaces.of([]), workspaces.of([])]);
  await workspaces.of([{ id: running, cwd: undefined }]);

  assert.equal(asked.filter((call) => call === 'workspace list').length, 1);
});
