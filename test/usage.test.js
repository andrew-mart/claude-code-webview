import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseUsage, usageView } from '../public/model/usage.js';
import { readUsage, usageOf } from '../server/usage.js';

const now = Date.UTC(2026, 9, 12, 9, 32);
/** ~/.claude.json as Claude Code leaves it: its last reading of the account's usage, three minutes old. */
const claudeState = {
  numStartups: 912,
  cachedUsageUtilization: {
    fetchedAtMs: now - 3 * 60_000,
    accountUuid: '00000000-0000-4000-8000-000000000000',
    utilization: {
      five_hour: { utilization: 22, resets_at: '2026-10-12T11:10:00.000+00:00', limit_dollars: null },
      seven_day: { utilization: 91, resets_at: '2026-10-15T01:00:00.000+00:00', limit_dollars: null },
      seven_day_opus: null,
    },
  },
};
const usage = { fiveHour: { percent: 22, resetsAt: Date.UTC(2026, 9, 12, 11, 10) }, sevenDay: { percent: 91, resetsAt: Date.UTC(2026, 9, 15, 1, 0) }, readAt: now - 3 * 60_000 };

// Claude Code keeps the account's usage in ~/.claude.json: the 5-hour window and the week, each how much is used and
// when it resets; a state without a reading has no usage
test('usageOf_Should_ReadFiveHourAndWeeklyWindows_FromClaudeCodeState', () => {
  assert.deepEqual([usageOf(claudeState), usageOf({ numStartups: 3 })], [usage, undefined]);
});

// Claude Code reads the usage only now and then; a statusline is given it with every reply (rate_limits) and may drop
// it into a file. Of the two, the fresher reading is the one shown: the file's time is when it was given
test('readUsage_Should_TakeFresherReading_OfClaudeCodeAndStatusline', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'usage-'));
  const files = { claudeState: join(folder, '.claude.json'), rateLimits: join(folder, 'rate-limits.json') };
  await writeFile(files.claudeState, JSON.stringify(claudeState));
  const cachedOnly = await readUsage(files);
  const dropped = { five_hour: { used_percentage: 35, resets_at: Date.UTC(2026, 9, 12, 11, 10) / 1000 }, seven_day: { used_percentage: 93, resets_at: Date.UTC(2026, 9, 15, 1, 0) / 1000 } };
  await writeFile(files.rateLimits, JSON.stringify(dropped));
  await utimes(files.rateLimits, new Date(now - 10 * 60_000), new Date(now - 10 * 60_000));
  const droppedEarlier = await readUsage(files);
  await utimes(files.rateLimits, new Date(now - 60_000), new Date(now - 60_000));
  const droppedLater = await readUsage(files);
  assert.deepEqual([cachedOnly, droppedEarlier, droppedLater], [
    usage,
    usage,
    { fiveHour: { percent: 35, resetsAt: Date.UTC(2026, 9, 12, 11, 10) }, sevenDay: { percent: 93, resetsAt: Date.UTC(2026, 9, 15, 1, 0) }, readAt: now - 60_000 },
  ]);
});

// As the statusline shows it: a meter for each window — how much is used, coloured by how full it is, and a mark for
// how much of the window has gone by; on hover, when each resets and how old the reading is. A window that reset after
// the reading has nothing to show
test('usageView_Should_MeterEachWindow_AndTellWhenItResets', () => {
  assert.deepEqual([usageView(usage, now), usageView(usage, now + 2 * 3_600_000).meters[0]], [
    {
      meters: [
        { name: '5h', percent: 22, level: 'calm', elapsed: 67 },
        { name: '7d', percent: 91, level: 'hot', elapsed: 62 },
      ],
      title: '5-hour window: 22% used, resets in 1h 38m\nWeek: 91% used, resets in 2d 15h\nRead 3m ago',
    },
    { name: '5h', percent: undefined, level: 'calm', elapsed: undefined },
  ]);
});

// The page takes the viewer's reply as it is, or nothing — a reply it cannot read hides the usage
test('parseUsage_Should_TakeUsageReply_Or_Nothing', () => {
  assert.deepEqual([parseUsage(usage), parseUsage({}), parseUsage({ fiveHour: { percent: '22' } })], [usage, undefined, undefined]);
});
