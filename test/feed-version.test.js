import { test } from 'node:test';
import assert from 'node:assert/strict';
import { utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../test-support/temp-dir.js';
import { feedVersion } from '../server/feed-version.js';

// A page's copy of a feed outlives an update of the viewer that leaves the files reading a transcript into entries as
// they were — written anew, or other files changed — and not one that changes them, or what they import
test('feedVersion_Should_Change_OnlyWithWhatTheFilesReadingEntriesHold', async () => {
  const folder = tempDir('feed-version-');
  const file = (/** @type {string} */ name) => join(folder, name);
  await writeFile(file('reading.js'), "import { shape } from './shape.js';\nexport const read = (line) => shape(JSON.parse(line));\n");
  await writeFile(file('shape.js'), 'export const shape = (entry) => ({ type: entry.type });\n');
  await writeFile(file('page.js'), "export const title = 'Orders';\n");
  const version = () => feedVersion([file('reading.js')]);

  const first = await version();
  await writeFile(file('shape.js'), 'export const shape = (entry) => ({ type: entry.type });\n');
  await utimes(file('shape.js'), new Date('2026-11-02T09:00:00Z'), new Date('2026-11-02T09:00:00Z'));
  const writtenAnew = await version();
  await writeFile(file('page.js'), "export const title = 'Invoices';\n");
  const otherChanged = await version();
  await writeFile(file('shape.js'), 'export const shape = (entry) => ({ type: entry.type, at: entry.timestamp });\n');
  const shapeChanged = await version();

  assert.deepEqual({ writtenAnew: writtenAnew === first, otherChanged: otherChanged === first, shapeChanged: shapeChanged === first }, { writtenAnew: true, otherChanged: true, shapeChanged: false });
});
