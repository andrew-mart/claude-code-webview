import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedToKeep, sessionsToSave } from '../public/model/offline.js';

const hour = 3600_000;
const now = Date.parse('2026-10-11T12:00:00Z');

test('sessionsToSave_Should_PickLatestWorkedOnSessionsWhoseSavedCopyIsBehind', () => {
  /** @type {{ id: string, kind: 'interactive' | 'sdk', activeAt: number }[]} */
  const sessions = [
    { id: 'fresh', kind: 'interactive', activeAt: now - 1 * hour },
    { id: 'behind', kind: 'interactive', activeAt: now - 2 * hour },
    { id: 'program', kind: 'sdk', activeAt: now - 2 * hour },
    { id: 'unsaved', kind: 'interactive', activeAt: now - 3 * hour },
    { id: 'beyond-limit', kind: 'interactive', activeAt: now - 4 * hour },
    { id: 'old', kind: 'interactive', activeAt: now - 100 * hour },
  ];
  const saved = new Map([
    ['fresh', { lastActivity: now - 1 * hour }],
    ['behind', { lastActivity: now - 5 * hour }],
  ]);

  assert.deepEqual(sessionsToSave(sessions, saved, { now, limit: 3, withinMs: 72 * hour }), ['behind', 'unsaved']);
});

test('feedToKeep_Should_KeepLatestEntriesCountDroppedAsEarlierAndTellLastMessageTime', () => {
  const entries = [
    { type: 'user', timestamp: '2026-10-11T10:00:00Z' },
    { type: 'assistant', timestamp: '2026-10-11T10:01:00Z' },
    { type: 'user', timestamp: '2026-10-11T10:02:00Z' },
    { type: 'system', timestamp: '2026-10-11T11:00:00Z' },
  ];

  assert.deepEqual(feedToKeep({ entries, earlier: 5 }, 3), { entries: entries.slice(1), earlier: 6, lastActivity: Date.parse('2026-10-11T10:02:00Z') });
});
