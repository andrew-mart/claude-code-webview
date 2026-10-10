import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTranscriptCache } from '../server/transcript-cache.js';

const at = '2026-10-10T07:02:11.686Z';
/** @param {string} uuid @param {string} text */
const promptLine = (uuid, text) => `${JSON.stringify({ type: 'user', uuid, timestamp: at, cwd: 'D:\\dev\\x', message: { role: 'user', content: text } })}\n`;
/** @param {number} lineStart @param {number} n */
const imageUrl = (lineStart, n) => `/api/image?at=${lineStart}&n=${n}`;

async function transcript() {
  const dir = await mkdtemp(join(tmpdir(), 'ccw-cache-'));
  const path = join(dir, 'session.jsonl');
  await writeFile(path, promptLine('u1', 'First question') + promptLine('u2', 'Second question'));
  return path;
}

test('read_Should_KeepEntriesReadBeforeAndReadOnlyLinesAppendedSince', async () => {
  const path = await transcript();
  const cache = createTranscriptCache({ maxFiles: 4 });

  const first = await cache.read(path, { scope: 'main', imageUrl });
  await appendFile(path, promptLine('u3', 'Third question'));
  const second = await cache.read(path, { scope: 'main', imageUrl });

  assert.deepEqual(second.entries.map((entry) => entry.link.uuid), ['u1', 'u2', 'u3']);
  // the entries read the first time are the same objects: the file was not parsed again
  assert.equal(second.entries[0], first.entries[0]);
  assert.equal(second.generation, first.generation);
});

test('read_Should_ReadRewrittenFileAgainUnderNewGeneration', async () => {
  const path = await transcript();
  const cache = createTranscriptCache({ maxFiles: 4 });
  const before = await cache.read(path, { scope: 'main', imageUrl });

  await writeFile(path, promptLine('n1', 'Fresh start'));
  const after = await cache.read(path, { scope: 'main', imageUrl });

  assert.deepEqual(after.entries.map((entry) => entry.link.uuid), ['n1']);
  assert.notEqual(after.generation, before.generation);
});
