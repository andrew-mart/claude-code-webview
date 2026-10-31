// @ts-check
// The files pinned beside a session, kept by the viewer's server (~/.claude-code-webview/pins.json): its project
// folder's — every session in it shows them, on every device — and its own. A change shows at once; the server's reply
// then replaces them. Coming back to the window reloads them, so a file pinned elsewhere appears. A reply asked for
// before the latest change — the pins reloaded, an earlier change's — comes without it and is dropped.
import { changePins, parseSessionPins, scopesOf } from '../model/pins.js';

/**
 * @typedef {import('../model/pins.js').SessionPins} SessionPins
 * @typedef {import('../model/pins.js').PinScope} PinScope
 * @typedef {import('../model/pins.js').PinChange} PinChange
 */

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
  /** @param {PinScope} scope @param {PinChange} change */
  const change = (scope, change) => {
    const made = ++changes;
    show({ ...pins, [scope]: changePins(pins[scope], change) });
    void sendChange(sessionId, scope, change).then((saved) => {
      if (made !== changes) return;
      if (saved === undefined) void load();
      else show(saved);
    });
  };
  const reload = () => void load();
  window.addEventListener('focus', reload);
  reload();
  return {
    /** The pins as they stand now. */
    now: () => pins,
    /** A file pinned to the session's project folder, or to the session alone. @param {PinScope} scope @param {string} path */
    pin(scope, path) {
      change(scope, { action: 'add', pin: { path, at: new Date().toISOString() } });
    },
    /** A file unpinned from everywhere it is pinned. @param {string} path */
    unpin(path) {
      for (const scope of scopesOf(pins, path)) change(scope, { action: 'remove', path });
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
 * @returns {Promise<SessionPins | undefined>} — the session's pins as the server keeps them now; none if it did not answer
 */
async function sendChange(sessionId, scope, change) {
  const response = await fetch('/api/pins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Viewer': '1' },
    body: JSON.stringify({ session: sessionId, scope, change }),
  }).catch(() => undefined);
  return response?.ok ? parseSessionPins(await response.json()) : undefined;
}
