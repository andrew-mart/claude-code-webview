// @ts-check
// The files pinned beside a session, kept by the viewer's server (~/.claude-code-webview/pins.json): its project
// folder's — every session in it shows them, on every device — and its own. A change shows at once; the server's reply
// then replaces them. Coming back to the window reloads them, so a file pinned elsewhere appears. A reply asked for
// before the latest change — the pins reloaded, an earlier change's — comes without it and is dropped.
import { changePins, parseSessionPins, scopesOf } from '../model/pins.js';
import { isRecord } from '../model/narrow.js';

/**
 * @typedef {import('../model/pins.js').SessionPins} SessionPins
 * @typedef {import('../model/pins.js').PinScope} PinScope
 * @typedef {import('../model/pins.js').PinChange} PinChange
 * @typedef {'pinned' | 'not-found' | 'not-a-file' | 'not-absolute' | 'failed'} PinOutcome — how a change went: done, or
 *   refused — no file at the path, a folder there, a path not absolute — or the viewer not answering
 */

/** Why a file was not pinned — a path typed in the outline, the file in the side panel. */
/** @type {Readonly<Record<Exclude<PinOutcome, 'pinned'>, string>>} */
export const pinRefusals = {
  'not-found': 'No file there.',
  'not-a-file': 'That is a folder, not a file.',
  'not-absolute': 'The whole path, please: from a drive, from /, or from ~/.',
  failed: 'The viewer did not answer.',
};

/**
 * @param {string} sessionId — the server knows its folder
 * @param {(pins: SessionPins) => void} onChange — the pins as they stand, each time they change
 */
export function createPinsStore(sessionId, onChange) {
  /** @type {SessionPins} */
  let pins = { folder: [], session: [] };
  /** @param {SessionPins} next */
  const show = (next) => {
    pins = next;
    onChange(next);
  };
  /** The changes made: a reply asked for before the latest one would take it away. */
  let changes = 0;
  const load = async () => {
    const asked = changes;
    const response = await fetch(`/api/pins?session=${sessionId}`).catch(() => undefined);
    if (response?.ok && asked === changes) show(parseSessionPins(await response.json()));
  };
  /** @param {PinScope} scope @param {PinChange} change @returns {Promise<PinOutcome>} */
  const change = async (scope, change) => {
    const made = ++changes;
    show({ ...pins, [scope]: changePins(pins[scope], change) });
    const saved = await sendChange(sessionId, scope, change);
    if (made === changes) {
      if (saved.ok) show(saved.pins);
      else void load();
    }
    return saved.ok ? 'pinned' : saved.error;
  };
  const reload = () => void load();
  window.addEventListener('focus', reload);
  reload();
  return {
    /** The pins as they stand now. */
    now: () => pins,
    /**
     * A file pinned to the session's project folder, or to the session alone: shown at once, gone again if the viewer
     * finds no file at the path — a path typed by hand.
     * @param {PinScope} scope @param {string} path
     * @returns {Promise<PinOutcome>}
     */
    pin(scope, path) {
      return change(scope, { action: 'add', pin: { path, at: new Date().toISOString() } });
    },
    /** A file unpinned from everywhere it is pinned. @param {string} path */
    unpin(path) {
      for (const scope of scopesOf(pins, path)) void change(scope, { action: 'remove', path });
    },
    /** A pinned file named in the list — a blank name giving back the file's — wherever it is pinned. @param {string} path @param {string} name */
    rename(path, name) {
      for (const scope of scopesOf(pins, path)) void change(scope, { action: 'name', path, name });
    },
    dispose() {
      window.removeEventListener('focus', reload);
    },
  };
}

/**
 * @param {string} sessionId
 * @param {PinScope} scope
 * @param {PinChange} change
 * @returns {Promise<{ ok: true, pins: SessionPins } | { ok: false, error: Exclude<PinOutcome, 'pinned'> }>} — the session's
 *   pins as the server keeps them now, or why the change was not made
 */
async function sendChange(sessionId, scope, change) {
  const response = await fetch('/api/pins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Viewer': '1' },
    body: JSON.stringify({ session: sessionId, scope, change }),
  }).catch(() => undefined);
  /** @type {unknown} */
  const json = await response?.json().catch(() => undefined);
  if (response?.ok === true) return { ok: true, pins: parseSessionPins(json) };
  const error = isRecord(json) ? json.error : undefined;
  return { ok: false, error: error === 'not-found' || error === 'not-a-file' || error === 'not-absolute' ? error : 'failed' };
}
