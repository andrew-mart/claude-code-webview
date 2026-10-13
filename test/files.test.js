import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readImageFile, readTextFile } from '../server/files.js';

const limits = { maxBytes: 1000, home: tmpdir() };
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

// A picture linked from the feed opens in the panel: its bytes, with the type the browser shows it by
test('readImageFile_Should_GiveBytesWithMediaTypeOfRasterImage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'csv-'));
  const names = ['a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.webp'];
  await Promise.all(names.map((name) => writeFile(join(dir, name), pngBytes)));

  const outcomes = await Promise.all(names.map((name) => readImageFile(join(dir, name), limits)));

  assert.deepEqual(
    outcomes.map((outcome) => outcome.ok && outcome.mediaType),
    ['image/png', 'image/jpeg', 'image/jpeg', 'image/gif', 'image/webp'],
  );
  assert.deepEqual(outcomes[0]?.ok && outcomes[0].bytes, pngBytes);
});

// An SVG from the viewer's own address could run a script in its page, and other files are no pictures at all
test('readImageFile_Should_RefuseWhatIsNotRasterImage_And_ImageOverLimit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'csv-'));
  await writeFile(join(dir, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  await writeFile(join(dir, 'notes.txt'), 'text');
  await writeFile(join(dir, 'odd.constructor'), 'text');
  await writeFile(join(dir, 'big.png'), Buffer.alloc(1001));

  const outcomes = await Promise.all(['logo.svg', 'notes.txt', 'odd.constructor', 'big.png'].map((name) => readImageFile(join(dir, name), limits)));

  assert.deepEqual(outcomes, [
    { ok: false, error: 'not-image' },
    { ok: false, error: 'not-image' },
    { ok: false, error: 'not-image' },
    { ok: false, error: 'too-large' },
  ]);
});

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

// Old Russian text files are in Windows-1251, not UTF-8: read as such, they show their words; a UTF-8 mark at the head
// is no part of the text
test('readTextFile_Should_ReadWindows1251_When_TextIsNotUtf8_And_DropUtf8Mark', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'csv-'));
  await writeFile(join(dir, 'old.txt'), Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x0a]));
  await writeFile(join(dir, 'marked.md'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# Привет\n')]));

  const outcomes = await Promise.all(['old.txt', 'marked.md'].map((name) => readTextFile(join(dir, name), limits)));

  assert.deepEqual(outcomes.map((outcome) => outcome.ok && outcome.content), ['Привет\n', '# Привет\n']);
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

