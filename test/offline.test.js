import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepingDue, lastActivityOf, sessionsToSave } from '../public/model/offline.js';

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

// A copy tells how fresh it is by its last prompt or answer: other records — a system note — do not count
test('lastActivityOf_Should_TellTimeOfLastPromptOrAnswer', () => {
  const entries = [
    { type: 'user', timestamp: '2026-10-11T10:00:00Z' },
    { type: 'assistant', timestamp: '2026-10-11T10:01:00Z' },
    { type: 'user', timestamp: '2026-10-11T10:02:00Z' },
    { type: 'system', timestamp: '2026-10-11T11:00:00Z' },
  ];

  assert.deepEqual([lastActivityOf(entries), lastActivityOf([{ type: 'system', timestamp: '2026-10-11T11:00:00Z' }])], [Date.parse('2026-10-11T10:02:00Z'), undefined]);
});

// The copies are brought up to date only a while after the page started — at first the session opened has the link to
// itself, over a slow one most of all — then once in a while
test('keepingDue_Should_WaitAWhileAfterTheStart_ThenComeOnceInAWhile', () => {
  /** @param {number} at @param {number | undefined} keptAt */
  const due = (at, keptAt) => keepingDue(at, { startedAt: 1000, keptAt }, { everyMs: 60_000, afterStartMs: 30_000 });

  assert.deepEqual([due(1000, undefined), due(30_999, undefined), due(31_000, undefined), due(90_999, 31_000), due(91_000, 31_000)], [false, false, true, false, true]);
});
