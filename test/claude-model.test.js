import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../test-support/temp-dir.js';
import { createClaudeModels } from '../server/claude-model.js';

test('claudeModels_Should_KeepLatestRealModel_WhenServiceRecordsFollow_AndRefreshWhenItChanges', async () => {
  const path = join(tempDir('ccw-model-'), 'session.jsonl');
  await writeFile(path, '{"type":"assistant","message":{"model":"gpt-6-sol"}}\n{"type":"assistant","message":{"model":"<synthetic>"}}\n{"type":"system"}\n');
  const modelOf = createClaudeModels(async () => path);
  const first = await modelOf('session');
  await appendFile(path, '{"type":"assistant","message":{"model":"gpt-6.1-sol"}}\n{"type":');

  assert.deepEqual([first, await modelOf('session')], ['gpt-6-sol', 'gpt-6.1-sol']);
});
