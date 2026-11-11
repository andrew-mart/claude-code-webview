// @ts-check
// A session's desk as the viewer tells it (server/desks.js): the notes and files pinned for a piece of work, in a file in
// a folder worked in — the one the session is at, and the others it can take up.
import { isRecord, text } from './narrow.js';

/**
 * @typedef {{ path: string, name: string, folder: string }} DeskRef — a desk's file, its name, the folder it is of
 * @typedef {{ current: DeskRef | undefined, offered: readonly DeskRef[] }} DeskState — current: none before the first
 *   note or file pinned makes one
 * @typedef {'no-desk' | 'no-folder' | 'exists' | 'not-found' | 'not-a-folder' | 'not-absolute' | 'failed'} DeskRefusal
 * @typedef {{ ok: true, desk: DeskState } | { ok: false, error: DeskRefusal }} DeskChanged
 * @typedef {{ action: 'choose', path: string } | { action: 'create', name: string } | { action: 'move', folder: string }} DeskChange
 */

/** Why a desk was not taken up, made or moved, as the page tells it. */
/** @type {Readonly<Record<DeskRefusal, string>>} */
export const deskRefusals = {
  'no-desk': 'That desk is gone.',
  'no-folder': 'The folder this session started in is not known: no desk can be made for it.',
  exists: 'That folder has a desk of this name already.',
  'not-found': 'There is no such folder.',
  'not-a-folder': 'That is a file, not a folder.',
  'not-absolute': 'Give the whole path of the folder, from its drive or from ~.',
  failed: 'The viewer did not answer.',
};

/**
 * The /api/desk reply; a desk of another shape is none, and left out of those offered.
 * @param {unknown} json
 * @returns {DeskState}
 */
export function parseDeskState(json) {
  if (!isRecord(json)) return { current: undefined, offered: [] };
  return { current: refOf(json.current), offered: Array.isArray(json.offered) ? json.offered.flatMap((one) => { const ref = refOf(one); return ref === undefined ? [] : [ref]; }) : [] };
}

/**
 * The reply to a change of the desk: the desk after it, or why it was not made.
 * @param {boolean} ok — whether the viewer said yes
 * @param {unknown} json
 * @returns {DeskChanged}
 */
export function parseDeskChanged(ok, json) {
  if (ok) return { ok: true, desk: parseDeskState(json) };
  const error = isRecord(json) ? text(json.error) : undefined;
  // a refusal the page does not know of is the viewer not answering as it should
  return { ok: false, error: refusalKinds.find((kind) => kind === error) ?? 'failed' };
}

/** @type {readonly DeskRefusal[]} */
const refusalKinds = ['no-desk', 'no-folder', 'exists', 'not-found', 'not-a-folder', 'not-absolute', 'failed'];

/** @param {unknown} value @returns {DeskRef | undefined} */
function refOf(value) {
  if (!isRecord(value)) return undefined;
  const path = text(value.path);
  const name = text(value.name);
  const folder = text(value.folder);
  return path === undefined || name === undefined || folder === undefined ? undefined : { path, name, folder };
}
