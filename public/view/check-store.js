// @ts-check
// The green checks on a session's messages, kept by the viewer's server (~/.claude-code-webview/checks.json): every
// device sees the same ones.
import { changeChecks, parseChecks } from '../model/checks.js';

/**
 * @typedef {import('../model/checks.js').CheckChange} CheckChange
 * @typedef {{ has: (id: string) => boolean, toggle: (id: string) => void, onChange: (listener: () => void) => () => void, dispose: () => void }} CheckStore
 */

/**
 * A change shows at once; the server's reply then replaces the checks. Coming back to the window asks for them again,
 * so checks made on another device appear.
 * @param {string} sessionId
 * @returns {CheckStore}
 */
export function createCheckStore(sessionId) {
  /** @type {readonly string[]} */
  let checks = [];
  /** @type {Set<() => void>} */
  const listeners = new Set();
  /** @param {readonly string[]} next */
  const show = (next) => {
    checks = next;
    for (const listener of listeners) listener();
  };
  const load = async () => {
    const response = await fetch(`/api/checks?session=${sessionId}`).catch(() => undefined);
    if (response?.ok) show(parseChecks(await response.json()));
  };
  const reload = () => void load();
  window.addEventListener('focus', reload);
  reload();
  return {
    has: (id) => checks.includes(id),
    toggle(id) {
      /** @type {CheckChange} */
      const change = checks.includes(id) ? { action: 'uncheck', id } : { action: 'check', id };
      show(changeChecks(checks, change));
      void sendChange(sessionId, change).then((saved) => (saved === undefined ? load() : show(saved)));
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      window.removeEventListener('focus', reload);
      listeners.clear();
    },
  };
}

/**
 * @param {string} sessionId
 * @param {CheckChange} change
 * @returns {Promise<readonly string[] | undefined>} — the session's checks after the change; none if the server did not take it
 */
async function sendChange(sessionId, change) {
  const response = await fetch('/api/checks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Viewer': '1' },
    body: JSON.stringify({ session: sessionId, change }),
  }).catch(() => undefined);
  return response?.ok ? parseChecks(await response.json()) : undefined;
}
