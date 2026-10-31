// @ts-check
// Files downloaded from the file panel and uploaded into it, from any absolute path as the panel reads and saves them
// (files.js). A file downloads as it is; a folder as a zip under its own name — every file under it, git's own folder
// left out as the panel lists them — written as it is read: each file deflated, its checksum and sizes after its data.
// An upload streams into a file of its own beside where it goes and takes its place once whole: a file by that name
// already there stays unless it is to be replaced.
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { createDeflateRaw, crc32 } from 'node:zlib';
import { folderAt } from './project.js';

/**
 * @typedef {{ path: string, name: string, size: number, modified: Date }} ZipEntry — name: its path in the zip
 * @typedef {{ ok: true, path: string, name: string, size: number } | { ok: false, error: 'not-absolute' | 'not-found' | 'not-a-file' }} Download
 * @typedef {{ ok: true, name: string, entries: readonly ZipEntry[] } | { ok: false, error: import('./project.js').FolderRefusal | 'too-large' }} FolderZip
 * @typedef {{ ok: true, path: string } | { ok: false, error: 'exists', name: string } | { ok: false, error: import('./project.js').FolderRefusal | 'bad-name' | 'not-a-file' | 'too-large' }} Upload
 *   — exists: name — the file's there, under which the folder holds it
 */

/**
 * The Content-Disposition of a file to save under its name: plain letters for an old browser, the name itself for the rest.
 * @param {string} name
 * @returns {string}
 */
export function attachment(name) {
  const plain = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * A file to download: an absolute path, or one from the home folder (~/…).
 * @param {string} requested
 * @param {string} home
 * @returns {Promise<Download>}
 */
export async function fileToDownload(requested, home) {
  const path = /^~[\\/]/.test(requested) ? join(home, requested.slice(2)) : requested;
  if (!isAbsolute(path)) return { ok: false, error: 'not-absolute' };
  const info = await stat(path).catch(() => undefined);
  if (info === undefined) return { ok: false, error: 'not-found' };
  if (!info.isFile()) return { ok: false, error: 'not-a-file' };
  return { ok: true, path, name: basename(path), size: info.size };
}

/**
 * A folder's files to zip, its own name the zip's first folder; refused before anything is sent when there is more than
 * one download should hold — a zip of them could not hold it either past 4 GB or 65535 files. A link to a file is the
 * file; a link to a folder is left out, as it may lead back up.
 * @param {string} requested
 * @param {{ home: string, maxBytes: number, maxEntries: number }} options
 * @returns {Promise<FolderZip>}
 */
export async function folderToZip(requested, { home, maxBytes, maxEntries }) {
  const folder = await folderAt(requested, home);
  if (!folder.ok) return folder;
  const top = basename(folder.path);
  /** @type {ZipEntry[]} */
  const entries = [];
  let total = 0;
  /** @param {string} at @param {string} named @returns {Promise<boolean>} — whether it all fits */
  const gather = async (at, named) => {
    for (const dirent of await readdir(at, { withFileTypes: true })) {
      if (dirent.name === '.git') continue;
      const path = join(at, dirent.name);
      const name = `${named}/${dirent.name}`;
      if (dirent.isDirectory()) {
        if (!(await gather(path, name))) return false;
        continue;
      }
      const info = dirent.isFile() || dirent.isSymbolicLink() ? await stat(path).catch(() => undefined) : undefined;
      if (info === undefined || !info.isFile()) continue;
      entries.push({ path, name, size: info.size, modified: info.mtime });
      total += info.size;
      if (entries.length > maxEntries || total > maxBytes) return false;
    }
    return true;
  };
  if (!(await gather(folder.path, top))) return { ok: false, error: 'too-large' };
  return { ok: true, name: `${top}.zip`, entries };
}

/**
 * The zip of the entries, written into output as each file is read: its header, its data deflated, then its checksum
 * and sizes (bit 3), names in UTF-8 (bit 11); the central directory and its end after the last.
 * @param {readonly ZipEntry[]} entries
 * @param {import('node:stream').Writable} output
 */
export async function writeZip(entries, output) {
  let offset = 0;
  /** @param {Buffer} chunk */
  const send = async (chunk) => {
    offset += chunk.length;
    if (!output.write(chunk)) await once(output, 'drain');
  };
  /** @type {Buffer[]} */
  const central = [];
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const { time, date } = dosTime(entry.modified);
    const at = offset;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0808, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt16LE(name.length, 26);
    await send(Buffer.concat([local, name]));
    const { crc, size, compressed } = await sendDeflated(entry.path, send);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(compressed, 8);
    descriptor.writeUInt32LE(size, 12);
    await send(descriptor);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0808, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(time, 12);
    record.writeUInt16LE(date, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(compressed, 20);
    record.writeUInt32LE(size, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(at, 42);
    central.push(record, name);
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  await send(directory);
  await send(end);
}

/**
 * A file's data deflated into the zip as it is read, its checksum and sizes counted on the way.
 * @param {string} path
 * @param {(chunk: Buffer) => Promise<void>} send
 * @returns {Promise<{ crc: number, size: number, compressed: number }>}
 */
async function sendDeflated(path, send) {
  let crc = 0;
  let size = 0;
  let compressed = 0;
  const deflate = createDeflateRaw();
  const reading = (async () => {
    for await (const chunk of createReadStream(path)) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      crc = crc32(bytes, crc);
      size += bytes.length;
      if (!deflate.write(bytes)) await once(deflate, 'drain');
    }
    deflate.end();
  })().catch((/** @type {unknown} */ error) => {
    deflate.destroy(error instanceof Error ? error : new Error(`Cannot read ${path}`, { cause: error }));
  });
  for await (const chunk of deflate) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    compressed += bytes.length;
    await send(bytes);
  }
  await reading;
  return { crc, size, compressed };
}

/**
 * A time as a zip holds it, in local time: two seconds at a time, from 1980.
 * @param {Date} at
 * @returns {{ time: number, date: number }}
 */
function dosTime(at) {
  const year = Math.max(at.getFullYear(), 1980);
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

/** What a file's name cannot hold on any of the file systems the viewer runs on, or what would lead out of its folder. */
const badName = /[\\/<>:"|?*\u0000-\u001f]/;

/**
 * A file uploaded into a folder under its name, streamed into a file beside it and put in its place once whole.
 * @param {string} requested — the folder: an absolute path, or one from the home folder (~/…)
 * @param {string} name — the file's
 * @param {AsyncIterable<Buffer | Uint8Array | string>} body — its bytes
 * @param {{ existing: 'keep' | 'replace', maxBytes: number, home: string }} options — existing: a file by that name
 *   already there kept — the upload refused — or replaced; maxBytes: the most an upload may hold
 * @returns {Promise<Upload>}
 */
export async function uploadFile(requested, name, body, { existing, maxBytes, home }) {
  if (name === '' || name === '.' || name === '..' || name.length > 255 || badName.test(name)) return { ok: false, error: 'bad-name' };
  const folder = await folderAt(requested, home);
  if (!folder.ok) return folder;
  const target = join(folder.path, name);
  const there = await lstat(target).catch(() => undefined);
  if (there !== undefined && !there.isFile()) return { ok: false, error: 'not-a-file' };
  if (there !== undefined && existing === 'keep') return { ok: false, error: 'exists', name: await nameThere(folder.path, name) };
  const part = `${target}.${randomUUID()}.part`;
  let written = 0;
  let tooLarge = false;
  try {
    await pipeline(
      body,
      async function* (source) {
        for await (const chunk of source) {
          written += chunk.length;
          if (written > maxBytes) {
            tooLarge = true;
            throw new Error(`An upload of ${name} holds more than ${maxBytes} bytes`);
          }
          yield chunk;
        }
      },
      createWriteStream(part, { flags: 'wx' }),
    );
    await rename(part, target);
    return { ok: true, path: target };
  } catch (error) {
    await rm(part, { force: true });
    if (tooLarge) return { ok: false, error: 'too-large' };
    throw new Error(`Cannot upload ${name} into ${folder.path}`, { cause: error });
  }
}

/**
 * The name a folder holds a file by that its file system takes for this one: the same, or — where case is not told
 * apart — one that differs from it only in case; a file system that folds names further than that, by the name asked.
 * @param {string} folder
 * @param {string} name — of a file there
 * @returns {Promise<string>}
 */
async function nameThere(folder, name) {
  const folded = (/** @type {string} */ one) => one.normalize().toLowerCase();
  const names = await readdir(folder);
  return names.includes(name) ? name : (names.find((one) => folded(one) === folded(name)) ?? name);
}
