// @ts-check
// The notes and pinned files kept before desks — in the viewer's own files, per project folder — moved onto desks
// (desk-files.js), each folder's onto one in that very folder: its notes, their history, the files pinned to it. A folder
// no session tells any more, or one gone from the disk, has its desk kept by the viewer under the old key, to be moved
// where it belongs. Each folder is taken up by its desk, and a herdr workspace by the desk of its sessions with most on
// it. The old files are left as they are; the report of what went where is written beside them, and while it is there
// the move does not run again. Cut short and run again, the move adds to a desk only what is not on it yet.
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { isRecord } from '../public/model/narrow.js';
import { parseSteps } from '../public/model/notes-history.js';
import { notesFolderOf, parseNotes } from '../public/model/notes.js';
import { parsePins, pinKey } from '../public/model/pins.js';
import { deskPathIn } from './desk-files.js';
import { folderKey } from './folders.js';

/**
 * @typedef {{ id: string, agent: 'claude' | 'codex' | 'agy', project: string, cwd: string | undefined, startedIn: string | undefined }} KnownSession
 * @typedef {{ key: string, folder: string, path: string, notes: number, pins: number, steps: number, orphaned: boolean }} MovedDesk
 *   — key: the folder's under the old files; notes, pins, steps: how many of each it had there
 * @typedef {{ moved: false } | { moved: true, desks: readonly MovedDesk[], workspaces: Readonly<Record<string, string>> }} DeskMoveReport
 *   — moved: false when the move ran before
 */

/**
 * @param {{ notes: string, history: string, pins: string, report: string, orphans: string, files: import('./desk-files.js').DeskFiles, desks: { adopt: (chosen: import('./desks.js').Chosen) => Promise<unknown> }, sessions: readonly KnownSession[], workspaceOf: (sessionId: string) => string | undefined }} sources
 *   — notes, history, pins: the old files; report: where what went is written; orphans: the folder that keeps the desks of
 *   folders not known; workspaceOf: the herdr workspace a session runs or ran in
 * @returns {Promise<DeskMoveReport>}
 */
export async function moveToDesks({ notes, history, pins, report, orphans, files, desks, sessions, workspaceOf }) {
  if (await stat(report).then(() => true, () => false)) return { moved: false };
  const kept = { notes: await readKept(notes), history: await readKept(history), pins: await readKept(pins) };
  const pinnedFolders = Object.keys(kept.pins).flatMap((key) => (key.startsWith('folder:') ? [key.slice('folder:'.length)] : []));
  /** @type {MovedDesk[]} */
  const moved = [];
  for (const key of new Set([...Object.keys(kept.notes), ...Object.keys(kept.history), ...pinnedFolders])) {
    const found = await folderOf(key, sessions);
    const folder = found ?? join(orphans, key);
    const name = found === undefined ? key : basename(found);
    const path = deskPathIn(folder, name);
    const notesThere = parseNotes(kept.notes[key]);
    const pinsThere = parsePins(kept.pins[`folder:${key}`]);
    const stepsThere = parseSteps(kept.history[key]);
    await files.change(
      path,
      (desk) => ({
        ...desk,
        notes: [...desk.notes, ...notesThere.filter((one) => !desk.notes.some((on) => on.id === one.id))],
        pins: [...desk.pins, ...pinsThere.filter((one) => !desk.pins.some((on) => pinKey(on.path) === pinKey(one.path)))],
        history: [...desk.history, ...stepsThere.filter((one) => !desk.history.some((on) => on.id === one.id))],
      }),
      name,
    );
    moved.push({ key, folder, path, notes: notesThere.length, pins: pinsThere.length, steps: stepsThere.length, orphaned: found === undefined });
  }
  const workspaces = workspaceDesks(moved, sessions, workspaceOf);
  await desks.adopt({
    workspaces,
    folders: Object.fromEntries(moved.flatMap((desk) => (desk.orphaned ? [] : [/** @type {const} */ ([folderKey(desk.folder), desk.path])]))),
    // the desks kept by the viewer offered as if taken up lately, to be found and moved: the others are in their folders
    recent: moved.filter((desk) => desk.orphaned).map((desk) => desk.path),
  });
  await writeFile(report, `${JSON.stringify({ at: new Date().toISOString(), desks: moved, workspaces }, null, 2)}\n`);
  return { moved: true, desks: moved, workspaces };
}

/**
 * The folder a key of the old files names: the one its sessions started in — Codex's, the one it ran in — the one most of
 * them did; none where no session tells it, or it is gone from the disk.
 * @param {string} key
 * @param {readonly KnownSession[]} sessions
 * @returns {Promise<string | undefined>}
 */
async function folderOf(key, sessions) {
  /** @type {Map<string, number>} */
  const counted = new Map();
  for (const session of sessions) {
    const folder = session.agent === 'codex' ? session.cwd : session.startedIn;
    if (folder !== undefined && notesFolderOf(session) === key) counted.set(folder, (counted.get(folder) ?? 0) + 1);
  }
  const [most] = [...counted].sort((one, other) => other[1] - one[1]);
  if (most === undefined) return undefined;
  return (await stat(most[0]).then((info) => info.isDirectory(), () => false)) ? most[0] : undefined;
}

/**
 * Each herdr workspace's desk: of the desks its sessions' folders went onto, the one with most on it.
 * @param {readonly MovedDesk[]} moved
 * @param {readonly KnownSession[]} sessions
 * @param {(sessionId: string) => string | undefined} workspaceOf
 * @returns {Record<string, string>}
 */
function workspaceDesks(moved, sessions, workspaceOf) {
  const byKey = new Map(moved.map((desk) => [desk.key, desk]));
  /** @type {Map<string, MovedDesk[]>} */
  const byWorkspace = new Map();
  for (const session of sessions) {
    const label = workspaceOf(session.id);
    const key = notesFolderOf(session);
    const desk = key === undefined ? undefined : byKey.get(key);
    if (label !== undefined && desk !== undefined) byWorkspace.set(label, [...(byWorkspace.get(label) ?? []), desk]);
  }
  const weight = (/** @type {MovedDesk} */ desk) => desk.notes + desk.pins;
  return Object.fromEntries([...byWorkspace].flatMap(([label, found]) => {
    const [most] = [...found].sort((one, other) => weight(other) - weight(one));
    return most === undefined ? [] : [/** @type {const} */ ([label, most.path])];
  }));
}

/**
 * One of the old files: no file — nothing in it; a file of another shape is an error, so that nothing is taken for
 * moved that was not.
 * @param {string} file
 * @returns {Promise<Record<string, unknown>>}
 */
async function readKept(file) {
  /** @type {string} */
  let source;
  try {
    source = await readFile(file, 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return {};
    throw new Error(`Cannot read ${file} to move it onto desks`, { cause: error });
  }
  /** @type {unknown} */
  const json = JSON.parse(source);
  if (!isRecord(json)) throw new Error(`${file} is not a JSON object: nothing in it is moved onto desks`);
  return json;
}
