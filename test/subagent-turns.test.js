import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSubagentWatch, withSubagentsAtWork } from '../server/subagent-turns.js';

/**
 * @param {string} id
 * @param {import('../public/model/herdr.js').AgentStatus} status
 * @param {string} [session]
 * @returns {import('../public/model/herdr.js').HerdrPane}
 */
const pane = (id, status, session) => ({ id, agent: 'claude', status, title: undefined, session, size: undefined, activity: 3 });

// An agent that ended a turn while its subagents work on — told one's report, it says it waits for the others — has not
// finished: its pane, its tab and its workspace show it at work, no lamp lit green, no chime; one whose subagents are
// done, or one asking, shows as herdr tells it
test('withSubagentsAtWork_Should_ShowAgentAtWork_WhileItsSubagentsWork', () => {
  const layout = {
    herdr: true,
    workspaces: [
      {
        id: 'w1',
        number: 1,
        label: 'shop',
        status: /** @type {const} */ ('done'),
        activeTab: 'w1:t1',
        tabs: [
          { id: 'w1:t1', number: 1, label: 'cart', status: /** @type {const} */ ('done'), panes: [pane('w1:p1', 'done', 's-waiting'), pane('w1:p2', 'idle', 's-alone')] },
          { id: 'w1:t2', number: 2, label: 'docs', status: /** @type {const} */ ('blocked'), panes: [pane('w1:p3', 'blocked', 's-waiting-asks'), pane('w1:p4', 'idle', 's-waiting-seen')] },
        ],
      },
    ],
  };

  const shown = withSubagentsAtWork(layout, new Set(['s-waiting', 's-waiting-asks', 's-waiting-seen']));

  assert.deepEqual(
    shown.workspaces.map((workspace) => [workspace.status, workspace.tabs.map((tab) => [tab.status, tab.panes.map((one) => one.status)])]),
    [['working', [['working', ['working', 'idle']], ['blocked', ['blocked', 'working']]]]],
  );
});

// Whether a session's subagents work on: one its transcript's tasks take for running — not a command in the background,
// a server left running — whose own transcript wrote lately; one gone quiet, or whose transcript is nowhere — left
// running in a branch rewound, or by a restart — does not. The session's transcript is read again only once it has
// changed; the subagents' are looked at each time
test('subagentWatch_Should_TellSubagentsAtWork_WhileTheyWriteLately', async () => {
  /** @type {string[]} */
  const read = [];
  let stamp = '1';
  let now = 1_000_000_000;
  /** @type {{ kind: 'agent' | 'shell', state: 'running' | 'completed', taskId: string }[]} */
  let tasks = [{ kind: 'shell', state: 'running', taskId: 'b1' }];
  /** When each subagent's own transcript wrote last, ms. @type {Map<string, number>} */
  const wrote = new Map([['a1', now - 2 * 60_000]]);
  const working = createSubagentWatch({
    find: async (session) => (session === 's1' ? 'D:/shop/s1.jsonl' : undefined),
    stampOf: async () => stamp,
    tasksOf: async (path) => {
      read.push(path);
      return tasks;
    },
    activeAt: async (session, taskId) => (session === 's1' ? wrote.get(taskId) : undefined),
    now: () => now,
  });

  const serverOnly = await working('s1');
  tasks = [{ kind: 'shell', state: 'running', taskId: 'b1' }, { kind: 'agent', state: 'running', taskId: 'a1' }, { kind: 'agent', state: 'running', taskId: 'a-lost' }];
  const unchanged = await working('s1');
  stamp = '2';
  const writing = await working('s1');
  now += 20 * 60_000;
  const quiet = await working('s1');

  assert.deepEqual({ serverOnly, unchanged, writing, quiet, unknown: await working('s9'), read }, { serverOnly: false, unchanged: false, writing: true, quiet: false, unknown: false, read: ['D:/shop/s1.jsonl', 'D:/shop/s1.jsonl'] });
});
