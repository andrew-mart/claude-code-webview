// @ts-check
// A desk: the notes and the files pinned for a piece of work, in a file of its own — <folder>/.desks/<name>.json — that
// lives with the work: every herdr workspace, session and device that takes the desk up sees the same notes and files.
// The pinned files' paths are kept relative to the desk's folder, so the desk goes on naming them when the folder moves;
// here, read, they are whole. The file: { name, notes, pins, history } — the notes' changes, to undo them.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { isRecord, text } from '../public/model/narrow.js';
import { parseSteps } from '../public/model/notes-history.js';
import { parseNotes } from '../public/model/notes.js';
import { parsePins } from '../public/model/pins.js';

/**
 * @typedef {import('../public/model/notes.js').Note} Note
 * @typedef {import('../public/model/pins.js').Pin} Pin
 * @typedef {import('../public/model/notes-history.js').NoteStep} NoteStep
 * @typedef {{ name: string, notes: readonly Note[], pins: readonly Pin[], history: readonly NoteStep[] }} Desk — the
 *   pins' paths whole
 * @typedef {{ ok: true, path: string } | { ok: false, error: 'exists' }} DeskMoved
 * @typedef {{ read: (path: string) => Promise<Desk | undefined>, change: (path: string, change: (desk: Desk) => Desk, name: string) => Promise<Desk>, inFolder: (folder: string) => Promise<readonly string[]>, move: (path: string, folder: string) => Promise<DeskMoved> }} DeskFiles
 *   — read: none for no file there; change: the desk changed — a new one, under this name, where there is none yet;
 *   inFolder: the desks in a folder's .desks, by their file names; move: the desk put in another folder's .desks, gone
 *   from its own — refused where that folder has a desk of its file's name
 */

/** The folder within a folder that holds its desks. */
const desksFolder = '.desks';

/**
 * The folder a desk is of: the one whose .desks holds it.
 * @param {string} path — the desk's file
 * @returns {string}
 */
export function deskFolder(path) {
  return dirname(dirname(path));
}

/**
 * Where a folder keeps a desk of this name: its file named by it, less what a file name cannot hold.
 * @param {string} folder
 * @param {string} name
 * @returns {string}
 */
export function deskPathIn(folder, name) {
  return join(folder, desksFolder, `${fileNameOf(name)}.json`);
}

/** @param {string} name @returns {string} */
function fileNameOf(name) {
  const fit = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '');
  // a name with nothing left that a file can be named by
  return fit === '' ? 'desk' : fit;
}

/** @returns {DeskFiles} */
export function createDeskFiles() {
  // A desk's changes one after another, each on the file the one before wrote: two devices cannot lose each other's.
  /** @type {Map<string, Promise<unknown>>} */
  const queues = new Map();
  /**
   * @template T
   * @param {string} path
   * @param {() => Promise<T>} work
   * @returns {Promise<T>}
   */
  const inTurn = (path, work) => {
    const done = (queues.get(path) ?? Promise.resolve()).then(work);
    queues.set(path, done.catch(() => undefined));
    return done;
  };
  return {
    read: readDesk,
    change: (path, change, name) =>
      inTurn(path, async () => {
        const changed = change((await readDesk(path)) ?? { name, notes: [], pins: [], history: [] });
        await writeAtomically(path, stored(changed, deskFolder(path)));
        return changed;
      }),
    async inFolder(folder) {
      const names = await readdir(join(folder, desksFolder)).catch((error) => {
        if (isRecord(error) && error.code === 'ENOENT') return [];
        throw new Error(`Cannot list the desks in ${folder}`, { cause: error });
      });
      return names
        .filter((name) => name.endsWith('.json'))
        .sort()
        .map((name) => join(folder, desksFolder, name));
    },
    move: (path, folder) =>
      inTurn(path, async () => {
        const desk = await readDesk(path);
        if (desk === undefined) throw new Error(`No desk to move at ${path}`);
        const target = join(folder, desksFolder, basename(path));
        if (await stat(target).then(() => true, () => false)) return { ok: false, error: 'exists' };
        await writeAtomically(target, stored(desk, folder));
        await rm(path);
        return { ok: true, path: target };
      }),
  };
}

/**
 * @param {string} path
 * @returns {Promise<Desk | undefined>} — none for no file there; a file that is not a desk is an error, so that the next
 *   change does not write over what is in it
 */
async function readDesk(path) {
  /** @type {string} */
  let source;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return undefined;
    throw new Error(`Cannot read the desk ${path}`, { cause: error });
  }
  /** @type {unknown} */
  let json;
  try {
    json = JSON.parse(source);
  } catch (error) {
    throw new Error(`The desk ${path} is not valid JSON; fix or remove it`, { cause: error });
  }
  if (!isRecord(json)) throw new Error(`The desk ${path} is not a JSON object; fix or remove it`);
  const folder = deskFolder(path);
  return {
    name: text(json.name) ?? basename(path, '.json'),
    notes: parseNotes(json.notes),
    pins: parsePins(json.pins).map((pin) => ({ ...pin, path: resolve(folder, pin.path) })),
    history: parseSteps(json.history),
  };
}

/**
 * The desk as its file holds it: the pins' paths relative to its folder, with forward slashes, so that the file reads
 * alike on any computer — a file on another drive kept whole.
 * @param {Desk} desk
 * @param {string} folder
 */
function stored(desk, folder) {
  return { ...desk, pins: desk.pins.map((pin) => ({ ...pin, path: relative(folder, pin.path).split(sep).join('/') })) };
}

/**
 * A reader never sees a half-written desk: the new content is written beside it and then renamed over it.
 * @param {string} path
 * @param {unknown} value
 */
async function writeAtomically(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}
