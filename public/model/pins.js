// @ts-check
// Files pinned beside a session — in the outline, under its notes — opened in the side panel at a click: pinned to the
// session's project folder, every session in it showing them, or to the session alone; the last pinned first. The
// /api/pins contract, shared with the server (pins.js there).
import { isRecord, text } from './narrow.js';

/**
 * @typedef {'folder' | 'session'} PinScope — the session's project folder, or the session alone
 * @typedef {{ path: string, at: string, name?: string }} Pin — path: the file's, as the side panel opened it — or as
 *   typed; at: when it was pinned; name: given it in the list by hand, the file's own unchanged
 * @typedef {{ action: 'add', pin: Pin } | { action: 'remove', path: string } | { action: 'name', path: string, name: string }} PinChange
 *   — name: the pin named so, a blank name giving back the file's
 * @typedef {{ folder: readonly Pin[], session: readonly Pin[] }} SessionPins — a session's pins: its folder's, its own
 */

/**
 * A file's path as pins are compared: forward slashes, a Windows path in one case.
 * @param {string} path
 */
export function pinKey(path) {
  const slashed = path.replaceAll('\\', '/');
  return /^[a-z]:\//i.test(slashed) ? slashed.toLowerCase() : slashed;
}

/**
 * A file pinned goes first, once however its path is written; unpinned, it is gone however it is written.
 * @param {readonly Pin[]} list
 * @param {PinChange} change
 * @returns {readonly Pin[]}
 */
export function changePins(list, change) {
  switch (change.action) {
    case 'add':
      return list.some((pin) => pinKey(pin.path) === pinKey(change.pin.path)) ? list : [change.pin, ...list];
    case 'remove':
      return list.filter((pin) => pinKey(pin.path) !== pinKey(change.path));
    case 'name':
      return list.map((pin) => (pinKey(pin.path) === pinKey(change.path) ? named(pin, change.name) : pin));
    default:
      return exhaustive(change);
  }
}

/**
 * What a pinned file is listed by: the name given it, else its file's name.
 * @param {Pin} pin
 * @returns {string}
 */
export function pinLabel(pin) {
  return pin.name ?? pin.path.split(/[\\/]/).filter((part) => part !== '').at(-1) ?? pin.path;
}

/**
 * The pin under a name — its words, without the spaces around them — or under none, a blank name being none.
 * @param {Pin} pin
 * @param {string | undefined} name
 * @returns {Pin}
 */
function named({ name: _was, ...pin }, name) {
  const words = name?.trim() ?? '';
  return words === '' ? pin : { ...pin, name: words };
}

/**
 * Where a file is pinned.
 * @param {SessionPins} pins
 * @param {string} path
 * @returns {PinScope[]}
 */
export function scopesOf(pins, path) {
  /** @type {readonly PinScope[]} */
  const scopes = ['folder', 'session'];
  return scopes.filter((scope) => pins[scope].some((pin) => pinKey(pin.path) === pinKey(path)));
}

/**
 * Pins from stored JSON — the server's file — a pin of any other shape left out.
 * @param {unknown} stored
 * @returns {readonly Pin[]}
 */
export function parsePins(stored) {
  if (!Array.isArray(stored)) return [];
  return stored.filter(isRecord).flatMap((item) => {
    const path = text(item.path);
    const at = text(item.at);
    return path === undefined || path.trim() === '' || at === undefined ? [] : [named({ path, at }, text(item.name))];
  });
}

/**
 * The /api/pins reply: a session's pins, its folder's and its own; a reply of another shape is none of either.
 * @param {unknown} json
 * @returns {SessionPins}
 */
export function parseSessionPins(json) {
  return isRecord(json) ? { folder: parsePins(json.folder), session: parsePins(json.session) } : { folder: [], session: [] };
}

/**
 * A change the page sends; anything of another shape — undefined.
 * @param {unknown} value
 * @returns {PinChange | undefined}
 */
export function parsePinChange(value) {
  if (!isRecord(value)) return undefined;
  const path = text(value.path);
  if (value.action === 'remove' && path !== undefined) return { action: 'remove', path };
  if (value.action === 'name' && path !== undefined && typeof value.name === 'string') return { action: 'name', path, name: value.name };
  const [pin] = value.action === 'add' ? parsePins([value.pin]) : [];
  return pin === undefined ? undefined : { action: 'add', pin };
}

/**
 * @param {never} value
 * @returns {never}
 */
function exhaustive(value) {
  throw new Error(`Unexpected change of the pins ${JSON.stringify(value)}`);
}
