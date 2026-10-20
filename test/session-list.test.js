import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupedSessions, listedSessions, mergeSessions } from '../public/model/session-list.js';

/** @type {readonly { id: string, title: string | undefined, cwd: string | undefined, kind: 'interactive' | 'sdk' }[]} */
const sessions = [
  { id: 'naming', title: 'Name this document', cwd: 'D:\\dev\\notes', kind: 'sdk' },
  { id: 'viewer', title: 'Build a viewer', cwd: 'D:\\dev\\viewer', kind: 'interactive' },
  { id: 'blank', title: undefined, cwd: undefined, kind: 'interactive' },
];

/** @param {readonly { id: string }[]} listed */
const ids = (listed) => listed.map((session) => session.id);

test('listedSessions_Should_HideSdkSessionsUnlessShown', () => {
  assert.deepEqual(ids(listedSessions(sessions, { sdk: 'hidden', search: '', workspaces: new Map(), history: {}, closed: 'all' })), ['viewer', 'blank']);
  assert.deepEqual(ids(listedSessions(sessions, { sdk: 'shown', search: '', workspaces: new Map(), history: {}, closed: 'all' })), ['naming', 'viewer', 'blank']);
});

test('listedSessions_Should_MatchSearchInTitleOrFolderIgnoringCase', () => {
  assert.deepEqual(ids(listedSessions(sessions, { sdk: 'shown', search: 'NOTES', workspaces: new Map(), history: {}, closed: 'all' })), ['naming']);
  assert.deepEqual(ids(listedSessions(sessions, { sdk: 'shown', search: '  viewer ', workspaces: new Map(), history: {}, closed: 'all' })), ['viewer']);
  assert.deepEqual(ids(listedSessions(sessions, { sdk: 'hidden', search: 'document', workspaces: new Map(), history: {}, closed: 'all' })), []);
});

test('mergeSessions_Should_PutChangedSessionsInPlaceOfOldOnesLatestActivityFirst', () => {
  const known = [
    { id: 'b', title: 'Busiest', activeAt: 400 },
    { id: 'a', title: 'First', activeAt: 100 },
  ];

  const merged = mergeSessions(known, [
    { id: 'a', title: 'First, renamed', activeAt: 300 },
    { id: 'c', title: 'Brand new', activeAt: 250 },
  ]);

  assert.deepEqual(merged, [
    { id: 'b', title: 'Busiest', activeAt: 400 },
    { id: 'a', title: 'First, renamed', activeAt: 300 },
    { id: 'c', title: 'Brand new', activeAt: 250 },
  ]);
});

/** The herdr workspace of each session, by its id (server/workspaces.js); empty without herdr. */
const workspaces = new Map([
  ['viewer', 'claude-webview'],
  ['naming', 'notes'],
]);

test('listedSessions_Should_MatchSearchInHerdrWorkspaceToo', () => {
  assert.deepEqual(ids(listedSessions(sessions, { sdk: 'shown', search: 'WEBVIEW', workspaces, history: {}, closed: 'all' })), ['viewer']);
});

// A workspace stands where its latest session would in the plain list; the sessions outside herdr's workspaces — most of
// the old ones — come after all workspaces, so as not to push the workspaces behind them far down
test('groupedSessions_Should_GatherSessionsOfEachWorkspace_LatestActivityFirst_TheRestLast', () => {
  const listed = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
  const of = new Map([
    ['a', 'web'],
    ['c', 'api'],
    ['d', 'web'],
  ]);

  assert.deepEqual(
    groupedSessions(listed, of).map((group) => ({ workspace: group.workspace, ids: ids(group.sessions) })),
    [
      { workspace: 'web', ids: ['a', 'd'] },
      { workspace: 'api', ids: ['c'] },
      { workspace: undefined, ids: ['b', 'e'] },
    ],
  );
});

/**
 * Where a session ran in herdr.
 * @param {string} tab
 * @param {Partial<import('../public/model/history.js').Place>} [more]
 * @returns {import('../public/model/history.js').Place}
 */
const ranIn = (tab, more = {}) => ({ workspace: 'claude-webview', tab, earlierTabs: [], terminal: undefined, folder: undefined, firstSeen: 1, lastSeen: 2, open: false, note: undefined, ...more });

/** naming ran in the tab "drafts", once called "notes-tab", with a note; viewer still runs in "ui"; blank never ran in herdr. */
const history = { naming: ranIn('drafts', { earlierTabs: ['notes-tab'], note: 'wording of the README' }), viewer: ranIn('ui', { open: true }) };

// A session is found by the tab it ran in — its name now or before — and by the note it has
test('listedSessions_Should_FindSessionByItsTabOrNote', () => {
  assert.deepEqual(
    ['DRAFTS', 'notes-tab', 'readme', ' ui '].map((search) => ids(listedSessions(sessions, { sdk: 'shown', search, workspaces: new Map(), history, closed: 'all' }))),
    [['naming'], ['naming'], ['naming'], ['viewer']],
  );
});

// Only the closed ones: the sessions that ran in a herdr tab and do not any more — to find one and open it again
test('listedSessions_Should_ListOnlySessionsClosedInHerdr_WhenAsked', () => {
  assert.deepEqual(ids(listedSessions(sessions, { sdk: 'shown', search: '', workspaces: new Map(), history, closed: 'only' })), ['naming']);
});
