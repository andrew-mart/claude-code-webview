import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listedSessions, mergeSessions } from '../public/model/session-list.js';

/** @type {readonly { id: string, title: string | undefined, cwd: string | undefined, kind: 'interactive' | 'sdk' }[]} */
const sessions = [
  { id: 'naming', title: 'Name this document', cwd: 'D:\\dev\\notes', kind: 'sdk' },
  { id: 'viewer', title: 'Build a viewer', cwd: 'D:\\dev\\viewer', kind: 'interactive' },
  { id: 'blank', title: undefined, cwd: undefined, kind: 'interactive' },
];

/** @param {readonly { id: string }[]} listed */
const ids = (listed) => listed.map((session) => session.id);

test('listedSessions_Should_HideSdkSessionsUnlessShown', () => {
  assert.deepEqual(ids(listedSessions(sessions, { sdk: 'hidden', search: '' })), ['viewer', 'blank']);
  assert.deepEqual(ids(listedSessions(sessions, { sdk: 'shown', search: '' })), ['naming', 'viewer', 'blank']);
});

test('listedSessions_Should_MatchSearchInTitleOrFolderIgnoringCase', () => {
  assert.deepEqual(ids(listedSessions(sessions, { sdk: 'shown', search: 'NOTES' })), ['naming']);
  assert.deepEqual(ids(listedSessions(sessions, { sdk: 'shown', search: '  viewer ' })), ['viewer']);
  assert.deepEqual(ids(listedSessions(sessions, { sdk: 'hidden', search: 'document' })), []);
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
