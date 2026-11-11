import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../test-support/temp-dir.js';
import { createClaudeModels } from '../server/claude-model.js';

// The session's last answer: the model it came from and when — service records after it left out — read anew once the
// transcript grows
test('claudeModels_Should_KeepLatestRealModel_WhenServiceRecordsFollow_AndRefreshWhenItChanges', async () => {
  const path = join(tempDir('ccw-model-'), 'session.jsonl');
  await writeFile(path, '{"type":"assistant","timestamp":"2026-10-31T10:00:00.000Z","message":{"model":"gpt-6-sol"}}\n{"type":"assistant","timestamp":"2026-10-31T10:00:01.000Z","message":{"model":"<synthetic>"}}\n{"type":"system"}\n');
  const modelOf = createClaudeModels(async () => path);
  const first = await modelOf('session');
  await appendFile(path, '{"type":"assistant","timestamp":"2026-10-31T10:05:00.000Z","message":{"model":"gpt-6.1-sol"}}\n{"type":');

  assert.deepEqual([first, await modelOf('session')], [
    { model: 'gpt-6-sol', at: Date.parse('2026-10-31T10:00:00.000Z') },
    { model: 'gpt-6.1-sol', at: Date.parse('2026-10-31T10:05:00.000Z') },
  ]);
});
