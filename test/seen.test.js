import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tempDir } from '../test-support/temp-dir.js';
import { createSeenFile } from '../server/seen.js';

// The answers seen are kept by the viewer for every device — over a restart too — the latest count of each agent's,
// as many as it keeps at most, the earliest seen let go first
test('seenFile_Should_KeepAnswersSeenAcrossRestart_LatestOfEach_UpToLimit', async () => {
  const file = join(tempDir('ccw-seen-'), 'seen.json');
  const seen = createSeenFile(file, { limit: 3 });

  await seen.mark('w1:p1', 5);
  await seen.mark('w1:p2', 3);
  await seen.mark('w1:p1', 7);
  await seen.mark('w2:p1', 1);
  await seen.mark('w3:p1', 2);
  const again = createSeenFile(file, { limit: 3 });

  assert.deepEqual(await again.all(), { 'w1:p1': 7, 'w2:p1': 1, 'w3:p1': 2 });
});
