import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const tempDirModule = pathToFileURL(join(import.meta.dirname, '..', 'test-support', 'temp-dir.js')).href;

// A test's temp folder is there while its process runs and gone once the process is over, a file left in it too —
// nothing piles up in the system's temp folder run after run
test('tempDir_Should_RemoveItsFolders_WhenProcessExits', () => {
  const script = `
    import { writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { tempDir } from ${JSON.stringify(tempDirModule)};
    const folders = [tempDir('ccw-one-'), tempDir('ccw-two-')];
    writeFileSync(join(folders[0], 'left.txt'), 'left');
    console.log(JSON.stringify(folders));
  `;

  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  /** @type {string[]} */
  const folders = JSON.parse(run.stdout);

  assert.equal(run.status, 0, run.stderr);
  assert.equal(folders.length, 2);
  assert.deepEqual(folders.filter((folder) => existsSync(folder)), []);
});

// Tests make their temp folders by tempDir only: a folder made by hand stays in the system's temp folder for good, and
// the tests had left tens of thousands there. This file is left out: it names what it looks for
test('tests_Should_MakeTempFoldersByTempDirOnly', async () => {
  const names = (await readdir(import.meta.dirname)).filter((name) => name.endsWith('.js') && name !== basename(import.meta.filename));
  const files = await Promise.all(names.map(async (name) => ({ name, text: await readFile(join(import.meta.dirname, name), 'utf8') })));

  assert.deepEqual(files.filter(({ text }) => /\bmkdtemp/.test(text)).map(({ name }) => name), []);
});
