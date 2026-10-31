import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { crc32, inflateRawSync } from 'node:zlib';
import { tempDir } from '../test-support/temp-dir.js';
import { attachment, fileToDownload, folderToZip, uploadFile, writeZip } from '../server/transfer.js';

/**
 * The files a zip holds, read as unzip reads them: through its central directory to each file's own header and data,
 * its data inflated and its checksum checked.
 * @param {Buffer} zip
 * @returns {Record<string, string>} — each file's text, by its name in the zip
 */
function unzipped(zip) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  /** @type {Record<string, string>} */
  const files = {};
  for (let entry = 0; entry < count; entry++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50, 'a central directory entry');
    const crc = zip.readUInt32LE(at + 16);
    const compressed = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    assert.equal(zip.readUInt32LE(local), 0x04034b50, `${name}: a local header`);
    const dataAt = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = inflateRawSync(zip.subarray(dataAt, dataAt + compressed));
    assert.equal(crc32(data), crc, `${name}: its checksum`);
    files[name] = data.toString('utf8');
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

// A folder downloads as a zip under its own name: every file under it, its folders as paths, git's own folder left out —
// as the file panel lists them; the zip is read back whole by an unzip, each file's checksum right
test('folderToZip_And_writeZip_Should_ZipFolderUnderItsName_LeavingGitOut', async () => {
  const shop = join(tempDir('transfer-zip-'), 'shop');
  await mkdir(join(shop, 'src', 'api'), { recursive: true });
  await mkdir(join(shop, '.git'), { recursive: true });
  await writeFile(join(shop, 'README.md'), '# Shop\n');
  await writeFile(join(shop, 'src', 'api', 'orders.ts'), 'export const orders = [];\n'.repeat(200));
  await writeFile(join(shop, 'src', 'тест.txt'), 'кириллица в имени\n');
  await writeFile(join(shop, '.git', 'HEAD'), 'ref: refs/heads/main\n');

  const found = await folderToZip(shop, { home: 'C:/Users/ann', maxBytes: 1_000_000, maxEntries: 100 });
  assert.ok(found.ok);
  const out = new PassThrough();
  /** @type {Buffer[]} */
  const chunks = [];
  out.on('data', (chunk) => chunks.push(chunk));
  await writeZip(found.entries, out);
  out.end();

  assert.deepEqual(
    { name: found.name, files: unzipped(Buffer.concat(chunks)) },
    { name: 'shop.zip', files: { 'shop/README.md': '# Shop\n', 'shop/src/api/orders.ts': 'export const orders = [];\n'.repeat(200), 'shop/src/тест.txt': 'кириллица в имени\n' } },
  );
});

// A folder too big for one download — by its size or by how many files it holds — is refused before anything is sent;
// a path that is no folder is told as such
test('folderToZip_Should_RefuseFolderTooBig_AndWhatIsNoFolder', async () => {
  const shop = join(tempDir('transfer-big-'), 'shop');
  await mkdir(shop, { recursive: true });
  await writeFile(join(shop, 'a.txt'), 'x'.repeat(600));
  await writeFile(join(shop, 'b.txt'), 'y'.repeat(600));

  assert.deepEqual(
    [
      await folderToZip(shop, { home: 'C:/Users/ann', maxBytes: 1000, maxEntries: 100 }),
      await folderToZip(shop, { home: 'C:/Users/ann', maxBytes: 1_000_000, maxEntries: 1 }),
      await folderToZip(join(shop, 'a.txt'), { home: 'C:/Users/ann', maxBytes: 1_000_000, maxEntries: 100 }),
    ],
    [{ ok: false, error: 'too-large' }, { ok: false, error: 'too-large' }, { ok: false, error: 'not-a-folder' }],
  );
});

// A file downloads under its own name — the browser told so, a name in any letters kept; a folder is no file
test('fileToDownload_And_attachment_Should_GiveFileUnderItsName', async () => {
  const folder = tempDir('transfer-file-');
  await writeFile(join(folder, 'отчёт 1.pdf'), 'pdf');

  assert.deepEqual(
    { file: await fileToDownload(join(folder, 'отчёт 1.pdf'), 'C:/Users/ann'), folder: await fileToDownload(folder, 'C:/Users/ann'), header: attachment('отчёт 1.pdf') },
    {
      file: { ok: true, path: join(folder, 'отчёт 1.pdf'), name: 'отчёт 1.pdf', size: 3 },
      folder: { ok: false, error: 'not-a-file' },
      header: "attachment; filename=\"_____ 1.pdf\"; filename*=UTF-8''%D0%BE%D1%82%D1%87%D1%91%D1%82%201.pdf",
    },
  );
});

// A file uploaded lands in the folder under its name; one by that name already there stays unless it is to be replaced;
// a name that would leave the folder or that a file system cannot hold is refused, as is a file too big — and nothing
// of a refused upload is left behind
test('uploadFile_Should_WriteFileIntoFolder_ReplacingOnlyWhenAsked_AndRefuseBadNamesAndTooBig', async () => {
  const folder = tempDir('transfer-upload-');
  await writeFile(join(folder, 'notes.md'), 'old');
  /** @param {string} text */
  const body = (text) => Readable.from([Buffer.from(text)]);
  const options = { existing: /** @type {const} */ ('keep'), maxBytes: 10, home: 'C:/Users/ann' };

  const outcomes = [
    await uploadFile(folder, 'photo.jpg', body('jpeg bytes'), options),
    await uploadFile(folder, 'notes.md', body('new'), options),
    await uploadFile(folder, 'notes.md', body('new'), { ...options, existing: 'replace' }),
    await uploadFile(folder, '../escape.txt', body('x'), options),
    await uploadFile(folder, 'a:b.txt', body('x'), options),
    await uploadFile(folder, '..', body('x'), options),
    await uploadFile(folder, 'big.bin', body('more than ten bytes'), options),
  ];

  assert.deepEqual(
    { outcomes, files: (await readdir(folder)).sort(), photo: await readFile(join(folder, 'photo.jpg'), 'utf8'), notes: await readFile(join(folder, 'notes.md'), 'utf8') },
    {
      outcomes: [
        { ok: true, path: join(folder, 'photo.jpg') },
        { ok: false, error: 'exists', name: 'notes.md' },
        { ok: true, path: join(folder, 'notes.md') },
        { ok: false, error: 'bad-name' },
        { ok: false, error: 'bad-name' },
        { ok: false, error: 'bad-name' },
        { ok: false, error: 'too-large' },
      ],
      files: ['notes.md', 'photo.jpg'],
      photo: 'jpeg bytes',
      notes: 'new',
    },
  );
});

// On a file system blind to case — Windows', macOS's — a name told from one already there only by its case is that
// file: the refusal names it as the folder holds it, and a replace leaves the file under the name it came by, the new
// one or the old
test('uploadFile_Should_NameFileThereAsFolderHoldsIt_AndReplaceItUnderNameGiven_When_NamesDifferOnlyInCase', async (t) => {
  const folder = tempDir('transfer-case-');
  await writeFile(join(folder, 'README.md'), 'old');
  if (!(await lstat(join(folder, 'readme.md')).then(() => true, () => false))) return t.skip('this file system tells names apart by their case');
  /** @param {string} text */
  const body = (text) => Readable.from([Buffer.from(text)]);
  const options = { existing: /** @type {const} */ ('keep'), maxBytes: 10, home: 'C:/Users/ann' };

  const refused = await uploadFile(folder, 'readme.md', body('new'), options);
  await uploadFile(folder, 'readme.md', body('new'), { ...options, existing: 'replace' });
  const renamed = await readdir(folder);
  await uploadFile(folder, 'README.md', body('newer'), { ...options, existing: 'replace' });

  assert.deepEqual(
    { refused, renamed, back: await readdir(folder), text: await readFile(join(folder, 'README.md'), 'utf8') },
    { refused: { ok: false, error: 'exists', name: 'README.md' }, renamed: ['readme.md'], back: ['README.md'], text: 'newer' },
  );
});
