// @ts-check
// A session's prompts set aside for later, kept by the viewer's server (~/.claude-code-webview/later.json): every
// device sees the same ones. A change shows at once; the server's reply then replaces the list. Coming back to the
// window reloads it, so a prompt set aside on another device appears.
import { changeLaterPrompts, parseLaterPrompts } from '../model/later.js';

/**
 * @typedef {import('../model/later.js').LaterPrompt} LaterPrompt
 * @typedef {import('../model/later.js').LaterChange} LaterChange
 */

/**
 * @param {string} sessionId
 * @param {(prompts: readonly LaterPrompt[]) => void} onChange — the list as it stands, each time it changes
 */
export function createLaterStore(sessionId, onChange) {
  /** @type {readonly LaterPrompt[]} */
  let prompts = [];
  /** @param {readonly LaterPrompt[]} next */
  const show = (next) => {
    prompts = next;
    onChange(next);
  };
  const load = async () => {
    const response = await fetch(`/api/later?session=${sessionId}`).catch(() => undefined);
    if (response?.ok) show(parseLaterPrompts(await response.json()));
  };
  /** @param {LaterChange} change */
  const change = (change) => {
    show(changeLaterPrompts(prompts, change));
    void sendChange(sessionId, change).then((saved) => (saved === undefined ? load() : show(saved)));
  };
  const reload = () => void load();
  window.addEventListener('focus', reload);
  reload();
  return {
    /** @param {string} text */
    add(text) {
      const at = new Date();
      // the time and a random tail: crypto.randomUUID is only there on https and on the viewer's own computer
      change({ action: 'add', prompt: { id: `${at.getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, text, at: at.toISOString() } });
    },
    /** @param {string} id */
    remove(id) {
      change({ action: 'remove', id });
    },
    dispose() {
      window.removeEventListener('focus', reload);
    },
  };
}

/**
 * @param {string} sessionId
 * @param {LaterChange} change
 * @returns {Promise<readonly LaterPrompt[] | undefined>} — the session's prompts as the server keeps them now; none if it did not answer
 */
async function sendChange(sessionId, change) {
  const response = await fetch('/api/later', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Viewer': '1' },
    body: JSON.stringify({ session: sessionId, change }),
  }).catch(() => undefined);
  return response?.ok ? parseLaterPrompts(await response.json()) : undefined;
}
