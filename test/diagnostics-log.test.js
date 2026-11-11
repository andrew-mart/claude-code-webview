import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../test-support/temp-dir.js';
import { createDiagnosticsLog } from '../server/diagnostics.js';

// A page's diagnostics, written down a line each — when, from which browser, what it told; the log grown past its size
// goes to its .1, the one there before let go, and a new one is begun
test('diagnosticsLog_Should_WriteLineEach_AndBeginAnew_WhenGrownPastSize', async () => {
  const file = join(tempDir('ccw-diagnostics-'), 'diagnostics.jsonl');
  const log = createDiagnosticsLog(file, { maxBytes: 100 });
  const at = Date.parse('2026-11-02T10:00:00.000Z');

  await log.record({ frames: 60 }, { at, agent: 'iPad' });
  await log.record({ frames: 58 }, { at: at + 15_000, agent: 'iPad' });
  await log.record({ frames: 61 }, { at: at + 30_000, agent: 'iPhone' });
  /** A log's lines; none of a log not there. @param {string} path */
  const lines = async (path) => (await readFile(path, 'utf8').catch(() => '')).split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));

  assert.deepEqual(
    { before: await lines(`${file}.1`), now: await lines(file) },
    {
      before: [
        { at: '2026-11-02T10:00:00.000Z', agent: 'iPad', report: { frames: 60 } },
        { at: '2026-11-02T10:00:15.000Z', agent: 'iPad', report: { frames: 58 } },
      ],
      now: [{ at: '2026-11-02T10:00:30.000Z', agent: 'iPhone', report: { frames: 61 } }],
    },
  );
});
