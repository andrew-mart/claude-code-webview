import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../test-support/temp-dir.js';
import { isRecord } from '../public/model/narrow.js';
import { createTranscriptCache } from '../server/transcript-cache.js';

const at = '2026-10-10T07:02:11.686Z';
/** @param {string} uuid @param {string} text */
const promptLine = (uuid, text) => `${JSON.stringify({ type: 'user', uuid, timestamp: at, cwd: 'D:\\dev\\x', message: { role: 'user', content: text } })}\n`;
/** @param {number} lineStart @param {number} n */
const imageUrl = (lineStart, n) => `/api/image?at=${lineStart}&n=${n}`;

async function transcript() {
  const dir = tempDir('ccw-cache-');
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

// A Codex session's file is read as Claude Code's records — a line of it may be none, or one — in turn: a line appended
// later reads on from where the reading of the file stopped, its folder and model carried
test('read_Should_ReadCodexFileAsClaudeCodesRecords_LinesAppendedOnInTurn', async () => {
  const dir = tempDir('ccw-cache-');
  const path = join(dir, 'rollout-2026-10-13T21-59-41-01a13634-a2b7-7c90-ae35-9f11f984db97.jsonl');
  const codexLine = (/** @type {unknown} */ record) => `${JSON.stringify(record)}\n`;
  await writeFile(
    path,
    codexLine({ timestamp: at, ordinal: 0, type: 'session_meta', payload: { id: '01a13634-a2b7-7c90-ae35-9f11f984db97', cwd: 'D:\dev\shop', source: 'cli' } }) +
      codexLine({ timestamp: at, ordinal: 1, type: 'turn_context', payload: { cwd: 'D:\dev\shop', model: 'gpt-6-astra' } }) +
      codexLine({ timestamp: at, ordinal: 2, type: 'response_item', payload: { type: 'message', id: 'msg_2', role: 'user', content: [{ type: 'input_text', text: 'Add a limit' }] } }),
  );
  const cache = createTranscriptCache({ maxFiles: 4, agentOf: (file) => (file === path ? 'codex' : 'claude') });
  await cache.read(path, { scope: 'main', imageUrl });
  await appendFile(path, codexLine({ timestamp: at, ordinal: 3, type: 'response_item', payload: { type: 'message', id: 'msg_3', role: 'assistant', content: [{ type: 'output_text', text: 'Added.' }] } }));

  const read = await cache.read(path, { scope: 'main', imageUrl });

  assert.deepEqual(
    read.entries.map((entry) => ({ uuid: entry.link.uuid, type: entry.slim?.type, model: isRecord(entry.slim?.message) ? entry.slim.message.model : undefined })),
    [
      { uuid: 'codex-2', type: 'user', model: undefined },
      { uuid: 'codex-3', type: 'assistant', model: 'gpt-6-astra' },
    ],
  );
});

// A Codex session that goes on in another file — its user edited a prompt and sent it again — is read as its files in
// turn: what the file before has past the point it goes on from is no longer the session, so the session read before
// is read again under a new generation
test('read_Should_ReadCodexSessionGoingOnInAnotherFile_FromWhereItGoesOn_UnderNewGeneration', async () => {
  const dir = tempDir('ccw-cache-');
  const id = '01a0d69a-fc7e-7fe1-9d40-9392029cb8a5';
  const first = join(dir, `rollout-2026-10-13T21-59-41-${id}.jsonl`);
  const next = join(dir, `rollout-2026-10-14T07-59-00-${id}_01a0d6a1-6035-7851-ac0d-fba569172c88.jsonl`);
  const codexLine = (/** @type {unknown} */ record) => `${JSON.stringify(record)}\n`;
  /** @param {number} ordinal @param {string} text */
  const prompted = (ordinal, text) => codexLine({ timestamp: at, ordinal, type: 'response_item', payload: { type: 'message', id: `msg_${ordinal}`, role: 'user', content: [{ type: 'input_text', text }] } });
  const kept = codexLine({ timestamp: at, ordinal: 0, type: 'session_meta', payload: { id, cwd: 'D:\dev\shop', source: 'cli' } }) + prompted(1, 'Add a limit');
  await writeFile(first, kept + prompted(2, 'Make it 10 a second'));
  /** @type {import('../server/joined.js').Part[]} */
  let parts = [{ path: first, end: undefined }];
  const cache = createTranscriptCache({ maxFiles: 4, agentOf: () => 'codex', partsOf: async () => parts });
  const before = await cache.read(first, { scope: 'main', imageUrl });
  await writeFile(next, codexLine({ timestamp: at, ordinal: 2, type: 'session_meta', payload: { id, cwd: 'D:\dev\shop', source: 'cli', history_base: { thread_id: id, end_ordinal_exclusive: 2, end_byte_offset: Buffer.byteLength(kept) } } }) + prompted(3, 'Make it 20 a second'));
  parts = [
    { path: first, end: Buffer.byteLength(kept) },
    { path: next, end: undefined },
  ];

  const after = await cache.read(first, { scope: 'main', imageUrl });

  assert.deepEqual(
    { uuids: after.entries.map((entry) => entry.link.uuid), generationChanged: after.generation !== before.generation },
    { uuids: ['codex-1', 'codex-3'], generationChanged: true },
  );
});

// Two pages follow one session: the one that leaves first does not let it go from under the other — once both have,
// reading other files pushes it out
test('keep_Should_KeepFileRead_WhileAnyPageKeepingItHasNotLetItGo', async () => {
  const path = await transcript();
  const other = await transcript();
  const cache = createTranscriptCache({ maxFiles: 1 });
  const letGoFirst = cache.keep(path, 'main');
  const letGoSecond = cache.keep(path, 'main');
  const first = await cache.read(path, { scope: 'main', imageUrl });

  letGoFirst();
  letGoFirst();
  await cache.read(other, { scope: 'main', imageUrl });
  const keptBySecond = await cache.read(path, { scope: 'main', imageUrl });
  letGoSecond();
  await cache.read(other, { scope: 'main', imageUrl });
  const letGoByBoth = await cache.read(path, { scope: 'main', imageUrl });

  assert.deepEqual(
    { keptBySecond: keptBySecond.generation === first.generation, letGoByBoth: letGoByBoth.generation === first.generation },
    { keptBySecond: true, letGoByBoth: false },
  );
});

// A file rewritten no shorter than it was — its last lines changed for longer ones — is read again under a new
// generation all the same: what was read of it before is no longer there
test('read_Should_ReadFileRewrittenNoShorterAgain_UnderNewGeneration', async () => {
  const path = await transcript();
  const cache = createTranscriptCache({ maxFiles: 4 });
  const before = await cache.read(path, { scope: 'main', imageUrl });
  await writeFile(path, promptLine('u1', 'First question') + promptLine('n2', 'A second question, put in place of the one before, and a good deal longer than it was'));

  const after = await cache.read(path, { scope: 'main', imageUrl });

  assert.deepEqual({ uuids: after.entries.map((entry) => entry.link.uuid), generationChanged: after.generation !== before.generation }, { uuids: ['u1', 'n2'], generationChanged: true });
});
