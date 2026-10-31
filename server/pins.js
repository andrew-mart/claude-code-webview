// @ts-check
// The files pinned beside sessions, in one file on this computer, so that every device shows them: each project
// folder's — every session in it shows them — and each session's own. Kept as the per-session lists are
// (session-lists.js), under "folder:<the folder's name>" (model/notes.js: notesFolderOf) and "session:<its id>".
import { changePins, parsePins } from '../public/model/pins.js';
import { createSessionListFile } from './session-lists.js';

/**
 * @typedef {import('../public/model/pins.js').PinScope} PinScope
 * @typedef {import('../public/model/pins.js').PinChange} PinChange
 * @typedef {import('../public/model/pins.js').SessionPins} SessionPins
 * @typedef {{ folder: string | undefined, session: string }} PinOwners — a session, and its project folder: none when
 *   it is not known
 * @typedef {{ of: (owners: PinOwners) => Promise<SessionPins>, change: (owners: PinOwners, scope: PinScope, change: PinChange) => Promise<SessionPins> }} Pins
 */

/**
 * @param {string} file
 * @returns {Pins}
 */
export function createPinsFile(file) {
  const lists = createSessionListFile({ file, what: 'pinned files', parse: parsePins, apply: changePins });
  /** @param {PinOwners} owners @returns {Promise<SessionPins>} */
  const of = async ({ folder, session }) => ({ folder: folder === undefined ? [] : await lists.list(`folder:${folder}`), session: await lists.list(`session:${session}`) });
  return {
    of,
    async change(owners, scope, change) {
      if (scope === 'session') await lists.change(`session:${owners.session}`, change);
      else if (owners.folder !== undefined) await lists.change(`folder:${owners.folder}`, change);
      return of(owners);
    },
  };
}
