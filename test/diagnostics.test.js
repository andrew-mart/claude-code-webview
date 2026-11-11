import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDelays, summarizeLateness, summarizeRequests } from '../public/model/diagnostics.js';

// How busy the page was while diagnostics ran, told by a clock it keeps — not by frames it would have to draw for
// that, which made a page with lamps lit draw all of itself at every frame: how late each of the clock's ticks came,
// how many came late — past 50 ms the page stood still, past 100 ms a key typed visibly waits — the time it stood
// still in them, and the worst
test('summarizeLateness_Should_TellLateTicksAndTimeThePageStoodStill', () => {
  assert.deepEqual(
    [summarizeLateness([0.4, 3.1, 60.2, 0, 140.4, 12.3]), summarizeLateness([])],
    [
      { ticks: 6, over50: 2, over100: 1, stoodStillMs: 201, worstMs: 140 },
      { ticks: 0, over50: 0, over100: 0, stoodStillMs: 0, worstMs: 0 },
    ],
  );
});

// A key's wait — from the key to the page's handling it, or to the frame that shows it — told by how many keys, the
// middle wait and the worst; no keys, no waits
test('summarizeDelays_Should_TellMiddleAndWorstWait', () => {
  assert.deepEqual([summarizeDelays([5.2, 80.6, 12.4]), summarizeDelays([])], [{ count: 3, medianMs: 12, worstMs: 81 }, { count: 0 }]);
});

// The requests the page made, by path — the query left out, so a poll counts as one — the most made first, with the time
// they took together; at most so many paths
test('summarizeRequests_Should_CountRequestsByPath_MostFirst', () => {
  const entries = [
    { name: 'https://viewer.example/api/live?session=a', duration: 12.3 },
    { name: 'https://viewer.example/api/live?session=b', duration: 8.1 },
    { name: 'https://viewer.example/api/entry?session=a&at=5', duration: 240.4 },
    { name: 'https://viewer.example/api/seen', duration: 3.2 },
    { name: 'https://viewer.example/api/live?session=a', duration: 10 },
  ];

  assert.deepEqual(summarizeRequests(entries, 2), [
    { path: '/api/live', count: 3, totalMs: 30 },
    { path: '/api/entry', count: 1, totalMs: 240 },
  ]);
});
