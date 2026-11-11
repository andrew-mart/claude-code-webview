import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closedTabs, tabConversations, tabNeighbours, tabToContinue } from '../public/model/history.js';

/**
 * Where a session ran in herdr: in the web workspace, closed at this time unless open — as the viewer tells it, an open
 * one with no last sighting.
 * @param {string | undefined} terminal
 * @param {number | 'open'} lastSeen
 * @param {Partial<import('../public/model/history.js').Place>} [more]
 * @returns {import('../public/model/history.js').Place}
 */
const ranIn = (terminal, lastSeen, more = {}) => ({ workspace: 'web', tab: 'checkout', earlierTabs: [], terminal, folder: 'D:/web', firstSeen: 1, lastSeen: lastSeen === 'open' ? undefined : lastSeen, open: lastSeen === 'open', note: undefined, ...more });

// A tab's conversations: the one it runs now first, then those it went on from, the latest left first; one kept by an
// older viewer, with no terminal to tell its tab, is alone in it
test('tabConversations_Should_ListTabsConversations_RunningOneFirst_ThenLatestLeftFirst', () => {
  const history = { first: ranIn('term_x', 5), now: ranIn('term_x', 'open'), second: ranIn('term_x', 8), elsewhere: ranIn('term_y', 9), older: ranIn(undefined, 7) };
  /** @param {string} session */
  const ids = (session) => tabConversations(history, session).map((conversation) => conversation.id);

  assert.deepEqual([ids('first'), ids('older'), ids('unknown')], [['now', 'second', 'first'], ['older'], []]);
});

// The tabs no conversation runs in now, the latest closed first, each named as when it was left, with its conversations,
// the latest left first; one kept by an older viewer is a tab of its own — unless it was kept with its workspace alone,
// no tab to open it in again
test('closedTabs_Should_ListTabsNothingRunsIn_LatestClosedFirst_WithTheirConversations', () => {
  const history = {
    x1: ranIn('term_x', 5),
    x2: ranIn('term_x', 'open'),
    y1: ranIn('term_y', 3, { tab: 'docs draft' }),
    y2: ranIn('term_y', 6, { tab: 'docs' }),
    z1: ranIn('term_z', 9, { tab: 'deploy' }),
    older: ranIn(undefined, 4, { tab: 'notes' }),
    workspaceOnly: ranIn(undefined, 8, { tab: undefined }),
  };

  assert.deepEqual(
    closedTabs(history).map((tab) => ({ workspace: tab.workspace, tab: tab.tab, conversations: tab.conversations.map((conversation) => conversation.id) })),
    [
      { workspace: 'web', tab: 'deploy', conversations: ['z1'] },
      { workspace: 'web', tab: 'docs', conversations: ['y2', 'y1'] },
      { workspace: 'web', tab: 'notes', conversations: ['older'] },
    ],
  );
});

// Where a conversation stands in its tab: the one it went on from — past one the viewer has nothing of to show — and
// the one its tab runs now, unless that is this one or nothing runs in it
test('tabNeighbours_Should_TellConversationWentOnFrom_AndOneTabRunsNow', () => {
  const history = { a: ranIn('term_x', 3), b: ranIn('term_x', 5), c: ranIn('term_x', 8), d: ranIn('term_x', 'open'), e: ranIn('term_y', 9) };
  /** @param {string} session */
  const ids = (session) => {
    const { earlier, runningNow } = tabNeighbours(history, session, (id) => id !== 'b');
    return [earlier?.id, runningNow?.id];
  };

  assert.deepEqual([ids('c'), ids('d'), ids('a'), ids('e')], [['a', 'd'], ['c', undefined], [undefined, 'd'], [undefined, undefined]]);
});

/**
 * A session as the list tells it: Claude Code's, someone worked in it, in the web folder — as Windows writes it — at
 * this time unless told otherwise.
 * @param {string} id
 * @param {Partial<import('../public/model/history.js').ListedSession>} [more]
 * @returns {import('../public/model/history.js').ListedSession}
 */
const listed = (id, more = {}) => ({ id, agent: 'claude', cwd: 'D:\\web', kind: 'interactive', modifiedAt: 1, ...more });

// A tab with nothing running in it goes on with the conversation that ran last in a tab of its name in its workspace —
// herdr brings tabs back with terminals of their own, their names kept; not with one that runs in another tab now
test('tabToContinue_Should_PickLatestConversationOfTabByItsName_UnlessItRunsNow', () => {
  const history = {
    earlier: ranIn('term_old', 3),
    latest: ranIn('term_x', 8),
    otherTab: ranIn('term_y', 9, { tab: 'docs' }),
    otherWorkspace: ranIn('term_z', 10, { workspace: 'shop' }),
    deployNow: ranIn('term_r', 'open', { tab: 'deploy' }),
    deployBefore: ranIn('term_d', 5, { tab: 'deploy' }),
  };
  const sessions = [listed('inFolder', { modifiedAt: 20 })];

  assert.deepEqual(
    [tabToContinue(history, sessions, { workspace: 'web', tab: 'checkout', folder: 'D:/web' }), tabToContinue(history, sessions, { workspace: 'web', tab: 'deploy', folder: 'D:/web' })],
    [{ kind: 'conversation', session: 'latest' }, { kind: 'running' }],
  );
});

// A tab the history does not know goes on with its folder's latest Claude Code conversation someone worked in, as
// claude --continue would — however the folder's slashes lean, in any case; none there — nor a folder herdr tells —
// nothing to go on with
test('tabToContinue_Should_GoOnWithFoldersLatestClaudeConversation_NothingWhenThereIsNone', () => {
  const history = { checkout: ranIn('term_x', 8) };
  const sessions = [
    listed('notesEarlier', { modifiedAt: 5 }),
    listed('notesLatest', { modifiedAt: 9 }),
    listed('codexLater', { agent: 'codex', modifiedAt: 20 }),
    listed('scriptedLater', { kind: 'sdk', modifiedAt: 21 }),
    listed('shop', { cwd: 'D:\\shop', modifiedAt: 30 }),
  ];
  /** @param {string | undefined} folder */
  const notesIn = (folder) => tabToContinue(history, sessions, { workspace: 'web', tab: 'notes', folder });

  assert.deepEqual([notesIn('d:/web/'), notesIn('D:/empty'), notesIn(undefined)], [{ kind: 'latest-in-folder', session: 'notesLatest' }, { kind: 'none' }, { kind: 'none' }]);
});
