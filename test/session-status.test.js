import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../test-support/temp-dir.js';
import { readSessionStatus } from '../server/session-status.js';

test('sessionStatus_Should_ReadOnlyModelAndContext_ForTheRequestedSession', async () => {
  const directory = tempDir('ccw-status-');
  const session = '7d4e1b20-2222-4333-8444-955566667777';
  await writeFile(join(directory, `${session}.json`), JSON.stringify({ at: 1000, model: 'gpt-6-sol', contextTokens: 0, contextWindow: 1_050_000, effort: 'high', api_key: 'private', cwd: '/private/project' }));
  await writeFile(join(directory, '..', 'outside.json'), JSON.stringify({ at: 1000, model: 'private' }));

  assert.deepEqual(await readSessionStatus(directory, session), { at: 1000, model: 'gpt-6-sol', contextTokens: 0, contextWindow: 1_050_000, effort: 'high' });
  assert.equal(await readSessionStatus(directory, '../outside'), undefined);
});
