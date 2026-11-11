// @ts-check
// The desks sessions work at (desk-files.js): which one is a session's, made and chosen from the page, moved, and what is
// on it. A herdr workspace has the desk chosen for it: all its sessions are at it, wherever each started. A session with
// none chosen for its workspace — or with no workspace — is at the desk chosen for the folder it started in or a folder
// above, else at a desk found in the .desks of that folder or one above, the nearest. The first note or file pinned
// where there is none makes one: in the folder the session started in, named after its workspace, else after the folder.
// Which desk is chosen for what is kept on this computer: { workspaces: { <label>: <desk> }, folders: { <folder>: <desk> },
// recent: [<desk>, …] }.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, parse } from 'node:path';
import { isRecord } from '../public/model/narrow.js';
import { recordStep, stepOf } from '../public/model/notes-history.js';
import { changeNotes } from '../public/model/notes.js';
import { changePins } from '../public/model/pins.js';
import { deskFolder, deskPathIn } from './desk-files.js';
import { folderKey } from './folders.js';

/**
 * @typedef {import('../public/model/notes.js').Note} Note
 * @typedef {import('../public/model/notes.js').NoteChange} NoteChange
 * @typedef {import('../public/model/pins.js').Pin} Pin
 * @typedef {import('../public/model/pins.js').PinChange} PinChange
 * @typedef {import('../public/model/notes-history.js').NoteStep} NoteStep
 * @typedef {import('./desk-files.js').Desk} Desk
 * @typedef {import('./desk-files.js').DeskFiles} DeskFiles
 * @typedef {{ startedIn: string | undefined, workspace: string | undefined }} SessionPlace — the folder a session started
 *   in, and the herdr workspace it runs or ran in: none of each when it is not known
 * @typedef {{ path: string, name: string, folder: string }} DeskRef — a desk's file, its name, the folder it is of
 * @typedef {{ ok: true, path: string } | { ok: false, error: 'exists' | 'no-desk' }} DeskMove
 * @typedef {{ workspaces: Readonly<Record<string, string>>, folders: Readonly<Record<string, string>>, recent: readonly string[] }} Chosen
 * @typedef {ReturnType<typeof createDesks>} Desks
 */

/** How many desks taken up lately are offered among the others. */
const keptRecent = 20;

/**
 * @param {{ registry: string, files: DeskFiles, limit: number, place: (sessionId: string) => Promise<SessionPlace | undefined> }} deps
 *   — registry: the file of which desk is chosen for what; limit: how many changes of its notes a desk keeps; place: a
 *   session's, none for a session not known
 */
export function createDesks({ registry, files, limit, place }) {
  // The choices changed one after another, each on what the one before wrote.
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();
  /** @param {(chosen: Chosen) => Chosen} change @returns {Promise<Chosen>} */
  const choose = (change) => {
    const done = queue.then(async () => {
      const next = change(await readChosen(registry));
      await writeAtomically(registry, next);
      return next;
    });
    queue = done.catch(() => undefined);
    return done;
  };
  /** @param {string} path @returns {Promise<DeskRef | undefined>} — none where there is no desk */
  const refOf = async (path) => {
    const desk = await files.read(path);
    return desk === undefined ? undefined : { path, name: desk.name, folder: deskFolder(path) };
  };

  /**
   * The desk a session is at: its workspace's, else its folder's or one above it — chosen, else found there.
   * @param {SessionPlace} where
   * @returns {Promise<string | undefined>}
   */
  const deskAt = async ({ startedIn, workspace }) => {
    const chosen = await readChosen(registry);
    const forWorkspace = workspace === undefined ? undefined : chosen.workspaces[workspace];
    if (forWorkspace !== undefined && (await files.read(forWorkspace)) !== undefined) return forWorkspace;
    if (startedIn === undefined) return undefined;
    for (const folder of upward(startedIn)) {
      const forFolder = chosen.folders[folderKey(folder)];
      if (forFolder !== undefined && (await files.read(forFolder)) !== undefined) return forFolder;
      const [nearest] = await files.inFolder(folder);
      if (nearest !== undefined) return nearest;
    }
    return undefined;
  };
  /** @param {string} sessionId @returns {Promise<string | undefined>} */
  const currentPath = async (sessionId) => {
    const where = await place(sessionId);
    return where === undefined ? undefined : deskAt(where);
  };
  /**
   * The desk is the session's — its workspace's, else its folder's — and among those taken up lately, the latest.
   * @param {SessionPlace} where
   * @param {string} path
   */
  const takeUp = (where, path) =>
    choose((chosen) => ({
      workspaces: where.workspace === undefined ? chosen.workspaces : { ...chosen.workspaces, [where.workspace]: path },
      folders: where.workspace !== undefined || where.startedIn === undefined ? chosen.folders : { ...chosen.folders, [folderKey(where.startedIn)]: path },
      recent: [path, ...chosen.recent.filter((one) => one !== path)].slice(0, keptRecent),
    }));
  /**
   * The session's desk to change: the one it is at, else a new one in the folder it started in — named after its
   * workspace, else after the folder — taken up by it; none where that folder is not known, or is gone from the disk.
   * @param {string} sessionId
   * @returns {Promise<{ path: string, name: string } | undefined>}
   */
  const deskToChange = async (sessionId) => {
    const where = await place(sessionId);
    if (where === undefined) return undefined;
    const at = await deskAt(where);
    if (at !== undefined) return { path: at, name: basename(at, '.json') };
    if (where.startedIn === undefined || !(await isFolder(where.startedIn))) return undefined;
    const name = where.workspace ?? basename(where.startedIn);
    const path = deskPathIn(where.startedIn, name);
    await takeUp(where, path);
    return { path, name };
  };
  /** @param {string} sessionId @returns {Promise<Desk | undefined>} */
  const deskOf = async (sessionId) => {
    const path = await currentPath(sessionId);
    return path === undefined ? undefined : files.read(path);
  };
  /**
   * The notes changed on a desk, the change among its steps.
   * @param {string} path @param {string} name @param {NoteChange} change
   */
  const changeNotesOn = async (path, name, change) =>
    (
      await files.change(
        path,
        (desk) => {
          const notes = changeNotes(desk.notes, change);
          const step = stepOf(desk.notes, notes, change, { id: randomUUID(), at: new Date().toISOString() });
          return { ...desk, notes, history: step === undefined ? desk.history : recordStep(desk.history, step, limit) };
        },
        name,
      )
    ).notes;

  return {
    /**
     * Desks chosen elsewhere — by the notes moved onto desks — taken up where nothing is chosen yet: a choice made here
     * stays as it is.
     * @param {Chosen} more
     */
    adopt: (more) =>
      choose((chosen) => ({
        workspaces: { ...more.workspaces, ...chosen.workspaces },
        folders: { ...more.folders, ...chosen.folders },
        recent: [...new Set([...chosen.recent, ...more.recent])],
      })),
    /** @param {string} sessionId @returns {Promise<DeskRef | undefined>} */
    async current(sessionId) {
      const path = await currentPath(sessionId);
      return path === undefined ? undefined : refOf(path);
    },
    /**
     * The desks a session can take up: its own first, then its workspace's, those in the folder it started in and the
     * folders above, and those taken up lately.
     * @param {string} sessionId
     * @returns {Promise<readonly DeskRef[]>}
     */
    async offered(sessionId) {
      const where = await place(sessionId);
      if (where === undefined) return [];
      const chosen = await readChosen(registry);
      const current = await deskAt(where);
      const around = where.startedIn === undefined ? [] : (await Promise.all(upward(where.startedIn).map((folder) => files.inFolder(folder)))).flat();
      const forWorkspace = where.workspace === undefined ? undefined : chosen.workspaces[where.workspace];
      const paths = [...new Set([current, forWorkspace, ...around, ...chosen.recent].filter((path) => path !== undefined))];
      return (await Promise.all(paths.map(refOf))).filter((ref) => ref !== undefined);
    },
    /** @param {string} sessionId @returns {Promise<readonly Note[]>} */
    notes: async (sessionId) => (await deskOf(sessionId))?.notes ?? [],
    /** @param {string} sessionId @returns {Promise<readonly NoteStep[]>} */
    history: async (sessionId) => (await deskOf(sessionId))?.history ?? [],
    /** @param {string} sessionId @returns {Promise<readonly Pin[]>} */
    pins: async (sessionId) => (await deskOf(sessionId))?.pins ?? [],
    /**
     * @param {string} sessionId @param {NoteChange} change
     * @returns {Promise<readonly Note[] | undefined>} — none where the session has no desk and no folder to make one in
     */
    async changeNotes(sessionId, change) {
      const desk = await deskToChange(sessionId);
      return desk === undefined ? undefined : changeNotesOn(desk.path, desk.name, change);
    },
    /**
     * @param {string} sessionId @param {PinChange} change
     * @returns {Promise<readonly Pin[] | undefined>} — none where the session has no desk and no folder to make one in
     */
    async changePins(sessionId, change) {
      const desk = await deskToChange(sessionId);
      return desk === undefined ? undefined : (await files.change(desk.path, (kept) => ({ ...kept, pins: changePins(kept.pins, change) }), desk.name)).pins;
    },
    /**
     * A desk taken up by the session — its workspace, else its folder.
     * @param {string} sessionId @param {string} path
     * @returns {Promise<DeskRef | undefined>} — none where there is no such desk
     */
    async choose(sessionId, path) {
      const where = await place(sessionId);
      const ref = await refOf(path);
      if (where === undefined || ref === undefined) return undefined;
      await takeUp(where, path);
      return ref;
    },
    /**
     * A new desk of this name in the folder the session started in — one of the name there already taken up instead —
     * taken up by the session.
     * @param {string} sessionId @param {string} name
     * @returns {Promise<DeskRef | undefined>} — none where the session's folder is not known, or is gone from the disk
     */
    async create(sessionId, name) {
      const where = await place(sessionId);
      if (where?.startedIn === undefined || !(await isFolder(where.startedIn))) return undefined;
      const path = deskPathIn(where.startedIn, name);
      await files.change(path, (desk) => desk, name);
      await takeUp(where, path);
      return refOf(path);
    },
    /**
     * The session's desk put in another folder, still taken up where it was.
     * @param {string} sessionId @param {string} folder
     * @returns {Promise<DeskMove>}
     */
    async move(sessionId, folder) {
      const from = await currentPath(sessionId);
      if (from === undefined) return { ok: false, error: 'no-desk' };
      const moved = await files.move(from, folder);
      if (!moved.ok) return moved;
      /** @param {string} path */
      const renamed = (path) => (path === from ? moved.path : path);
      await choose((chosen) => ({
        workspaces: Object.fromEntries(Object.entries(chosen.workspaces).map(([label, path]) => [label, renamed(path)])),
        folders: Object.fromEntries(Object.entries(chosen.folders).map(([key, path]) => [key, renamed(path)])),
        recent: chosen.recent.map(renamed),
      }));
      return moved;
    },
    /**
     * A note of the session's desk put on another — there first — and gone from this one: put there before it goes
     * from here, so that nothing is lost on the way.
     * @param {string} sessionId @param {string} noteId @param {string} to — the other desk's file
     * @returns {Promise<readonly Note[] | undefined>} — the notes left; none where there is no such note or desk
     */
    async moveNote(sessionId, noteId, to) {
      const from = await currentPath(sessionId);
      const desk = from === undefined ? undefined : await files.read(from);
      const moving = desk?.notes.find((one) => one.id === noteId);
      const target = await refOf(to);
      if (from === undefined || desk === undefined || moving === undefined || target === undefined || to === from) return undefined;
      await changeNotesOn(to, target.name, { action: 'add', note: moving });
      return changeNotesOn(from, desk.name, { action: 'remove', id: noteId });
    },
  };
}

/**
 * Whether a folder is there on the disk: a desk is not made where one is gone, to make the folder again.
 * @param {string} folder
 */
function isFolder(folder) {
  return stat(folder).then(
    (info) => info.isDirectory(),
    () => false,
  );
}

/**
 * A folder and the folders above it, up to its root.
 * @param {string} folder
 * @returns {string[]}
 */
function upward(folder) {
  const { root } = parse(folder);
  /** @type {string[]} */
  const folders = [];
  for (let at = folder; ; at = dirname(at)) {
    folders.push(at);
    if (at === root || dirname(at) === at) return folders;
  }
}

/**
 * No file — nothing chosen yet; a file of another shape is an error rather than nothing chosen: the next choice would
 * write over it.
 * @param {string} file
 * @returns {Promise<Chosen>}
 */
async function readChosen(file) {
  /** @type {string} */
  let source;
  try {
    source = await readFile(file, 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return { workspaces: {}, folders: {}, recent: [] };
    throw new Error(`Cannot read the desks chosen in ${file}`, { cause: error });
  }
  /** @type {unknown} */
  let json;
  try {
    json = JSON.parse(source);
  } catch (error) {
    throw new Error(`The desks chosen in ${file} are not valid JSON; fix or remove the file`, { cause: error });
  }
  if (!isRecord(json)) throw new Error(`The desks chosen in ${file} are not a JSON object; fix or remove the file`);
  return { workspaces: texts(json.workspaces), folders: texts(json.folders), recent: Array.isArray(json.recent) ? json.recent.filter((path) => typeof path === 'string') : [] };
}

/** @param {unknown} value @returns {Record<string, string>} */
function texts(value) {
  return isRecord(value) ? Object.fromEntries(Object.entries(value).flatMap(([key, path]) => (typeof path === 'string' ? [/** @type {const} */ ([key, path])] : []))) : {};
}

/**
 * @param {string} file
 * @param {unknown} value
 */
async function writeAtomically(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}
