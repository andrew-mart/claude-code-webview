import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tempDir } from '../test-support/temp-dir.js';
import { createLaterFile } from '../server/later.js';

const session = '3f2c9a50-1111-4222-8333-944455556666';
const other = '7d1e0b42-2222-4333-8444-a55566667777';
/** @type {import('../public/model/later.js').LaterPrompt} */
const next = { id: 'l1', text: 'Then add tests for the parser', at: '2026-10-22T09:00:00.000Z' };

// A prompt set aside on the phone is there on the computer, and after the viewer restarts: the viewer keeps it
test('laterFile_Should_KeepPromptsPerSessionAcrossRestarts', async () => {
  const file = join(tempDir('ccw-later-'), 'later.json');

  await createLaterFile(file).change(session, { action: 'add', prompt: next });
  const restarted = createLaterFile(file);

  assert.deepEqual([await restarted.list(session), await restarted.list(other)], [[next], []]);
});
