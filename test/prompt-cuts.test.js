import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCutWatch } from '../server/prompt-cuts.js';

const notes = ' Keep the notes short and clear.'.repeat(12);
const [first, second, third] = ['1. Check the totals of last month.', '2. Round the taxes to cents.', '3. Send the report to the team.'].map((line) => `${line}${notes}`);
/** A prompt longer than Claude Code's read of its terminal, 1,024 bytes: it comes in several reads. */
const sent = [first, second, third].join('\n');
const cut = [first, third].join('\n');

// After a prompt goes into Claude Code's terminal, what Claude Code writes down is read till the prompt comes: written
// whole, it is left be; written with a piece gone — Claude Code lost a read of a long one — Claude is stopped once and
// the prompt is held whole for a page to take; a prompt typed in the terminal before it is passed over; none coming
// within the watch, nothing is held. A prompt that comes in one read is not watched: it comes whole or not at all
test('cutWatch_Should_StopClaudeAndHoldThePromptWhole_OnlyWhenItIsWrittenDownCutShort', async () => {
  /** What each session's transcript has written down since a mark, read after read. @type {Map<string, string[][]>} */
  const reads = new Map([
    ['s-whole', [[], [sent]]],
    ['s-cut', [[], ['Fix the build first'], [cut]]],
    ['s-silent', []],
    ['s-short', [['1. Check the totals.']]],
  ]);
  /** @type {string[]} */
  const stopped = [];
  let clock = 0;
  const watch = createCutWatch({
    written: async (session, mark) => ({ prompts: reads.get(session)?.[mark] ?? [], mark: mark + 1 }),
    stop: async (session) => void stopped.push(session),
    wait: async (ms) => void (clock += ms),
    now: () => clock,
    pollMs: 100,
    giveUpMs: 1000,
  });

  await Promise.all([...['s-whole', 's-cut', 's-silent'].map((session) => watch.watch(session, sent, 0)), watch.watch('s-short', '1. Check the totals.\n2. Round the taxes.', 0)]);
  const held = { whole: watch.held('s-whole'), cut: watch.held('s-cut'), silent: watch.held('s-silent'), short: watch.held('s-short') };
  watch.take('s-cut');

  assert.deepEqual(
    { held, stopped, taken: watch.held('s-cut') },
    { held: { whole: undefined, cut: { text: sent, cut: { lost: 413, after: 'notes short and clear.' } }, silent: undefined, short: undefined }, stopped: ['s-cut'], taken: undefined },
  );
});
