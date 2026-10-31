import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempDir } from '../test-support/temp-dir.js';
import { createTextFile, readImageFile, readTextFile, saveTextFile } from '../server/files.js';

const limits = { maxBytes: 1000, home: tmpdir() };
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

// A picture linked from the feed opens in the panel: its bytes, with the type the browser shows it by
test('readImageFile_Should_GiveBytesWithMediaTypeOfRasterImage', async () => {
  const dir = tempDir('csv-');
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
  const dir = tempDir('csv-');
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
  const home = tempDir('csv-home-');
  await writeFile(join(home, 'notes.md'), '# notes\n');

  const outcome = await readTextFile('~/notes.md', { maxBytes: 1000, home });

  assert.equal(outcome.ok && outcome.content, '# notes\n');
});

test('readTextFile_Should_ReturnTextOfAbsolutePath', async () => {
  const dir = tempDir('csv-');
  const path = join(dir, 'a.cs');
  await writeFile(path, 'class A\n{\n}\n');

  const outcome = await readTextFile(path, limits);

  assert.equal(outcome.ok, true);
  assert.equal(outcome.ok && outcome.content, 'class A\n{\n}\n');
});

// Old Russian text files are in Windows-1251, not UTF-8: read as such, they show their words; a UTF-8 mark at the head
// is no part of the text
test('readTextFile_Should_ReadWindows1251_When_TextIsNotUtf8_And_DropUtf8Mark', async () => {
  const dir = tempDir('csv-');
  await writeFile(join(dir, 'old.txt'), Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x0a]));
  await writeFile(join(dir, 'marked.md'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# Привет\n')]));

  const outcomes = await Promise.all(['old.txt', 'marked.md'].map((name) => readTextFile(join(dir, name), limits)));

  assert.deepEqual(outcomes.map((outcome) => outcome.ok && outcome.content), ['Привет\n', '# Привет\n']);
});

test('readTextFile_Should_ExplainWhyFileIsNotShown', async () => {
  const dir = tempDir('csv-');
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


// A file edited in the panel is saved over the one read, as UTF-8 — with the mark at its head when it had one — and
// what is saved is the version read next
test('saveTextFile_Should_SaveOverFileAsRead_KeepingUtf8Mark', async () => {
  const dir = tempDir('csv-');
  const path = join(dir, 'a.cs');
  await writeFile(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('class A\r\n{\r\n}\r\n')]));
  const read = await readTextFile(path, limits);
  assert.ok(read.ok);

  const saved = await saveTextFile(path, { content: 'class Б\r\n{\r\n}\r\n', version: read.version }, limits);
  const again = await readTextFile(path, limits);

  assert.deepEqual(
    { bytes: [...(await readFile(path))], sameVersion: saved.ok && again.ok && saved.version === again.version },
    { bytes: [...Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('class Б\r\n{\r\n}\r\n')])], sameVersion: true },
  );
});

// A file written meanwhile — by the session, by another editor — is not saved over: it stays as it is, and the page
// gets what it holds now and its version, to choose between the two
test('saveTextFile_Should_LeaveFileChangedSinceRead_AndTellWhatItHoldsNow', async () => {
  const dir = tempDir('csv-');
  const path = join(dir, 'a.ts');
  await writeFile(path, 'const a = 1;\n');
  const read = await readTextFile(path, limits);
  assert.ok(read.ok);
  await writeFile(path, 'const a = 2;\n');
  const now = await readTextFile(path, limits);

  const saved = await saveTextFile(path, { content: 'const a = 3;\n', version: read.version }, limits);

  assert.deepEqual(
    { saved, file: await readFile(path, 'utf8') },
    { saved: { ok: false, error: 'changed', content: 'const a = 2;\n', version: now.ok ? now.version : '' }, file: 'const a = 2;\n' },
  );
});

// What a save would spoil is not saved: a file in another encoding — UTF-8 would change its every letter but Latin
// ones — a text over the limit, a file the viewer may not write
test('saveTextFile_Should_RefuseSaveThatWouldSpoilFile', async () => {
  const dir = tempDir('csv-');
  const files = { old: join(dir, 'old.txt'), big: join(dir, 'big.txt'), locked: join(dir, 'locked.txt') };
  await writeFile(files.old, Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x0a]));
  await writeFile(files.big, 'small\n');
  await writeFile(files.locked, 'locked\n');
  await chmod(files.locked, 0o444);
  /** @param {string} path @param {string} content */
  const save = async (path, content) => {
    const read = await readTextFile(path, limits);
    assert.ok(read.ok);
    return saveTextFile(path, { content, version: read.version }, limits);
  };

  const outcomes = [await save(files.old, 'Пока\n'), await save(files.big, 'x'.repeat(1001)), await save(files.locked, 'open\n')];

  assert.deepEqual(
    { outcomes, big: await readFile(files.big, 'utf8') },
    {
      outcomes: [
        { ok: false, error: 'not-utf8' },
        { ok: false, error: 'too-large' },
        { ok: false, error: 'read-only' },
      ],
      big: 'small\n',
    },
  );
});

// A note saved to a file: a new file written in a folder that is there; a file there already is not written over unless
// told to replace it; no folder there, a path not whole, a folder where the file would go — each refused, saying which
test('createTextFile_Should_WriteNewFile_AndReplaceOneThereOnlyWhenTold', async () => {
  const dir = tempDir('note-file-');
  const plan = join(dir, 'Plan.md');

  const made = await createTextFile(plan, { content: '# Plan\n- one\n', replace: false }, limits);
  const there = await createTextFile(plan, { content: '# Plan, again\n', replace: false }, limits);
  const kept = await readFile(plan, 'utf8');
  const replaced = await createTextFile(plan, { content: '# Plan, again\n', replace: true }, limits);
  const refused = await Promise.all([
    createTextFile(join(dir, 'no-such-folder', 'Plan.md'), { content: 'x', replace: false }, limits),
    createTextFile('notes/Plan.md', { content: 'x', replace: false }, limits),
    createTextFile(dir, { content: 'x', replace: true }, limits),
  ]);

  assert.deepEqual(
    { made, there, kept, replaced, now: await readFile(plan, 'utf8'), refused: refused.map((one) => (one.ok ? 'written' : one.error)) },
    { made: { ok: true, path: plan }, there: { ok: false, error: 'exists' }, kept: '# Plan\n- one\n', replaced: { ok: true, path: plan }, now: '# Plan, again\n', refused: ['no-folder', 'not-absolute', 'not-a-file'] },
  );
});
