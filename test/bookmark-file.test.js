import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBookmarkFile } from '../server/bookmarks.js';

const session = '3f2c9a50-1111-4222-8333-944455556666';
const other = '7d1e0b42-2222-4333-8444-a55566667777';
/** @type {import('../public/model/bookmarks.js').Bookmark} */
const question = { id: 'u1', kind: 'prompt', label: 'Build a viewer', at: '2026-10-09T10:00:00.000Z' };
/** @type {import('../public/model/bookmarks.js').Bookmark} */
const report = { id: 'a1:0', kind: 'answer', label: 'Test results', at: '2026-10-09T10:05:00.000Z' };

async function tempFile() {
  return join(await mkdtemp(join(tmpdir(), 'ccw-bookmarks-')), 'bookmarks.json');
}

test('bookmarkFile_Should_KeepBookmarksPerSessionAcrossRestarts', async () => {
  const file = await tempFile();

  await createBookmarkFile(file).change(session, { action: 'add', bookmark: question });
  const restarted = createBookmarkFile(file);

  assert.deepEqual(await restarted.list(session), [question]);
  assert.deepEqual(await restarted.list(other), []);
});

test('bookmarkFile_Should_KeepBothOfSimultaneousChanges', async () => {
  const bookmarks = createBookmarkFile(await tempFile());

  await Promise.all([bookmarks.change(session, { action: 'add', bookmark: report }), bookmarks.change(session, { action: 'add', bookmark: question })]);

  assert.deepEqual(await bookmarks.list(session), [question, report]);
});

test('bookmarkFile_Should_RefuseToOverwriteBrokenFile', async () => {
  const file = await tempFile();
  await writeFile(file, '{ "3f2c9a50-1111-4222-8333-944455556666": [ broken');

  await assert.rejects(createBookmarkFile(file).change(session, { action: 'add', bookmark: question }));
  assert.equal(await readFile(file, 'utf8'), '{ "3f2c9a50-1111-4222-8333-944455556666": [ broken');
});
