import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTextFile } from '../server/files.js';

const limits = { maxBytes: 1000, home: tmpdir() };

test('readTextFile_Should_ReadPathFromHomeDirectory', async () => {
  const home = await mkdtemp(join(tmpdir(), 'csv-home-'));
  await writeFile(join(home, 'notes.md'), '# notes\n');

  const outcome = await readTextFile('~/notes.md', { maxBytes: 1000, home });

  assert.equal(outcome.ok && outcome.content, '# notes\n');
});

test('readTextFile_Should_ReturnTextOfAbsolutePath', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'csv-'));
  const path = join(dir, 'a.cs');
  await writeFile(path, 'class A\n{\n}\n');

  const outcome = await readTextFile(path, limits);

  assert.equal(outcome.ok, true);
  assert.equal(outcome.ok && outcome.content, 'class A\n{\n}\n');
});

test('readTextFile_Should_ExplainWhyFileIsNotShown', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'csv-'));
  await writeFile(join(dir, 'big.txt'), 'x'.repeat(1001));
  await writeFile(join(dir, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));

  const outcomes = await Promise.all(
    ['relative/a.cs', join(dir, 'missing.cs'), dir, join(dir, 'big.txt'), join(dir, 'image.png')].map((path) => readTextFile(path, limits)),
  );

  assert.deepEqual(outcomes, [
    { ok: false, error: 'not-absolute' },
    { ok: false, error: 'not-found' },
    { ok: false, error: 'not-a-file' },
    { ok: false, error: 'too-large' },
    { ok: false, error: 'binary' },
  ]);
});
