import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usageOfRollout } from '../server/codex-usage.js';

/** @param {unknown} rateLimits @param {string} timestamp */
const tokenCount = (rateLimits, timestamp) => JSON.stringify({ timestamp, type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: rateLimits } });

// Codex's usage of the account — its windows, the week of 10080 minutes and the 5 hours of 300, how much of each is used
// and when it resets — as the latest token count in its transcript tells it; none before one
test('usageOfRollout_Should_ReadCodexsWindows_FromLatestTokenCount', () => {
  const week = { used_percent: 39, window_minutes: 10080, resets_at: 1792491476 };
  const fiveHours = { used_percent: 12.5, window_minutes: 300, resets_at: 1791990000 };
  const text = [
    tokenCount({ limit_id: 'codex', primary: { ...week, used_percent: 30 }, secondary: null }, '2026-10-14T10:00:00.000Z'),
    JSON.stringify({ timestamp: '2026-10-14T10:01:00.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [] } }),
    tokenCount({ limit_id: 'codex', primary: fiveHours, secondary: week }, '2026-10-14T10:02:00.000Z'),
    '{"timestamp":"2026-10-14T10:03:00.000Z","type":"event_msg","payload":{"type":"token_cou',
  ].join('\n');

  assert.deepEqual([usageOfRollout(text), usageOfRollout('')], [
    { fiveHour: { percent: 12.5, resetsAt: 1791990000000 }, sevenDay: { percent: 39, resetsAt: 1792491476000 }, readAt: Date.parse('2026-10-14T10:02:00.000Z') },
    undefined,
  ]);
});
