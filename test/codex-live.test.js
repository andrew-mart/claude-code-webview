import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../test-support/temp-dir.js';
import { codexPanes, createCodexThreads } from '../server/codex-live.js';

/**
 * @param {string} paneId
 * @param {string} cwd
 * @param {string} [title]
 * @returns {import('../server/herdr.js').Pane}
 */
const codexPane = (paneId, cwd, title) => ({ paneId, workspaceId: paneId.split(':')[0] ?? '', tabId: undefined, terminal: undefined, cwd, agent: 'codex', status: 'working', title, size: undefined, activity: 1 });

// Codex opened in a tab writes its session's file only with the thread's first message: before it the thread is open —
// its folder unknown — and the one Codex pane left with no thread runs it, when there is only one of each; with more,
// they cannot be told apart and are left alone
test('codexPanes_Should_GiveThePaneLeftTheOneThreadNotWrittenYet', () => {
  const fresh = { id: 'fresh', cwd: undefined, name: undefined, activeAt: undefined };
  const shop = { id: 'thread-shop', cwd: 'D:\\dev\\shop', name: undefined, activeAt: 2 };
  const panes = [codexPane('w1:p1', 'D:\\dev\\shop'), codexPane('w2:p1', 'D:\\dev\\blog')];

  assert.deepEqual(
    {
      one: [...codexPanes(panes, [shop, fresh])],
      twoThreads: [...codexPanes(panes, [shop, fresh, { ...fresh, id: 'fresh-too' }])],
      twoPanes: [...codexPanes([...panes, codexPane('w3:p1', 'D:\\dev\\docs')], [shop, fresh])],
    },
    {
      one: [
        ['w1:p1', 'thread-shop'],
        ['w2:p1', 'fresh'],
      ],
      twoThreads: [['w1:p1', 'thread-shop']],
      twoPanes: [['w1:p1', 'thread-shop']],
    },
  );
});

// A Codex pane runs the thread open in its folder: the one Codex holds open there — a folder's case and slashes aside
test('codexPanes_Should_GiveCodexPaneTheThreadOpenInItsFolder', () => {
  const threads = [
    { id: 'thread-shop', cwd: 'D:\\dev\\shop', name: undefined, activeAt: 2 },
    { id: 'thread-blog', cwd: 'D:\\dev\\blog', name: undefined, activeAt: 3 },
  ];

  assert.deepEqual([...codexPanes([codexPane('w1:p1', 'd:/dev/shop/')], threads)], [['w1:p1', 'thread-shop']]);
});

// Several Codex panes in one folder: each runs the thread its title names — Codex titles its terminal by the thread's
// name — and the one left the thread left; panes and threads that cannot be told apart are left alone
test('codexPanes_Should_TellThreadsOfOneFolderByPaneTitles_AndLeaveTheOnesItCannotTell', () => {
  const threads = [
    { id: 'rate', cwd: 'D:\\dev\\shop', name: 'Add a rate limit', activeAt: 1 },
    { id: 'login', cwd: 'D:\\dev\\shop', name: 'Fix the login', activeAt: 2 },
    { id: 'fresh', cwd: 'D:\\dev\\shop', name: undefined, activeAt: 3 },
    { id: 'blog-a', cwd: 'D:\\dev\\blog', name: undefined, activeAt: 4 },
    { id: 'blog-b', cwd: 'D:\\dev\\blog', name: undefined, activeAt: 5 },
  ];
  const panes = [
    codexPane('w1:p1', 'D:\\dev\\shop', 'Fix the login | shop'),
    codexPane('w1:p2', 'D:\\dev\\shop', 'shop'),
    codexPane('w1:p3', 'D:\\dev\\shop', 'Add a rate limit | shop'),
    codexPane('w2:p1', 'D:\\dev\\blog', 'blog'),
    codexPane('w2:p2', 'D:\\dev\\blog', 'blog'),
  ];

  assert.deepEqual([...codexPanes(panes, threads)].sort(), [['w1:p1', 'login'], ['w1:p2', 'fresh'], ['w1:p3', 'rate']]);
});

// A pane whose title names no thread is given the one left in its folder only when that one has no name: a named thread
// would show its name in its pane's title — it runs elsewhere, the pane's own thread not listed yet
test('codexPanes_Should_LeavePaneAlone_When_TheThreadLeftInItsFolderHasANameItsTitleDoesNotShow', () => {
  const threads = [{ id: 'elsewhere', cwd: 'D:\\dev\\shop', name: 'Fix the login', activeAt: 1 }];

  assert.deepEqual([...codexPanes([codexPane('w1:p1', 'D:\\dev\\shop', 'shop')], threads)], []);
});

// The threads Codex holds open — a lock it holds on each — that a person runs, with their folders and the names Codex
// gave them last; a subagent's thread, and one no longer open — its lock file left, held by no one — are not among them
test('codexThreads_Should_ListThreadsCodexHoldsOpen_ThatAPersonRuns_WithTheirLatestNames', async () => {
  const home = tempDir('ccw-codex-home-');
  await mkdir(join(home, 'thread-writer-locks'));
  for (const name of ['.coordination.lock', 'shop.lock', 'helper.lock', 'closed.lock', 'fresh.lock']) await writeFile(join(home, 'thread-writer-locks', name), '');
  const names = [
    { id: 'shop', thread_name: 'Add a limit', updated_at: '2026-10-14T10:00:00Z' },
    { id: 'gone', thread_name: 'Old work', updated_at: '2026-10-14T10:01:00Z' },
    { id: 'shop', thread_name: 'Add a rate limit', updated_at: '2026-10-14T10:02:00Z' },
  ];
  await writeFile(join(home, 'session_index.jsonl'), `${names.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  /** @type {Record<string, { cwd: string, kind: 'interactive' | 'sdk', activeAt: number }>} */
  const sessions = { shop: { cwd: 'D:\\dev\\shop', kind: 'interactive', activeAt: 7 }, helper: { cwd: 'D:\\dev\\shop', kind: 'sdk', activeAt: 8 }, gone: { cwd: 'D:\\dev\\shop', kind: 'interactive', activeAt: 1 }, closed: { cwd: 'D:\\dev\\shop', kind: 'interactive', activeAt: 2 } };
  const threads = createCodexThreads({ home, summaryOf: async (id) => sessions[id], held: async (lock) => !lock.endsWith('closed.lock') });

  assert.deepEqual(
    [...(await threads.open())].sort((one, other) => one.id.localeCompare(other.id)),
    [
      { id: 'fresh', cwd: undefined, name: undefined, activeAt: undefined },
      { id: 'shop', cwd: 'D:\\dev\\shop', name: 'Add a rate limit', activeAt: 7 },
    ],
  );
});

// A thread Codex holds open now — its lock held, its session's file written yet or not — is one Codex runs; one whose
// lock is left, held by no one, and one with no lock at all are not
test('codexThreads_Should_TellWhetherCodexHoldsThreadOpen', async () => {
  const home = tempDir('ccw-codex-home-');
  await mkdir(join(home, 'thread-writer-locks'));
  for (const name of ['fresh.lock', 'closed.lock']) await writeFile(join(home, 'thread-writer-locks', name), '');
  const threads = createCodexThreads({ home, summaryOf: async () => undefined, held: async (lock) => !lock.endsWith('closed.lock') });

  assert.deepEqual([await threads.holds('fresh'), await threads.holds('closed'), await threads.holds('nowhere')], [true, false, false]);
});
