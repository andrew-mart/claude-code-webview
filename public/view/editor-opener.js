// @ts-check
// Opening a file in the editor of the viewer's computer — from a browser on that computer only, where it shows up.
// A page opened through a tunnel finds out by asking the viewer at the browser's own 127.0.0.1: Chrome asks the user
// once to let the page reach apps on this device, so it is asked when the button is pressed — or by itself, without
// troubling anyone, in a browser found on the viewer's computer before, which has been let reach it.
import { editorReach, parseMachine } from '../model/machine.js';
import { isRecord, text } from '../model/narrow.js';

/** What the browser found out last time: { instance, reach } — kept per browser, the answer is the browser's. */
const keptKey = 'viewer.editorReach';

/**
 * @typedef {import('../model/machine.js').EditorReach} EditorReach
 * @typedef {{ ok: true } | { ok: false, error: string }} EditorReply
 * @typedef {{ reach: () => Promise<EditorReach>, check: () => Promise<EditorReach>, open: (path: string, line: number) => Promise<EditorReply> }} EditorOpener —
 *   reach: what is known without asking the user; check: asks the viewer at 127.0.0.1, the browser may ask the user first
 */

/**
 * @param {Promise<import('../model/machine.js').Machine | undefined>} own — what the viewer that served the page says of
 *   itself
 * @returns {EditorOpener}
 */
export function createEditorOpener(own) {
  /** What the viewer at 127.0.0.1 said, once asked. */
  /** @type {Promise<EditorReach> | undefined} */
  let checked;
  const check = async () => {
    const machine = await own;
    if (machine === undefined) return 'none';
    checked ??= askLocal(machine.port).then((local) => {
      const reach = editorReach(machine, { hostname: location.hostname, local });
      // a refusal tells nothing of where the browser is: the next press asks again, the page let in by then
      if (reach === 'blocked') checked = undefined;
      else keep({ instance: machine.instance, reach });
      return reach;
    });
    return checked;
  };
  return {
    async reach() {
      const machine = await own;
      if (machine === undefined || matchMedia('(pointer: coarse)').matches) return 'none';
      const known = editorReach(machine, { hostname: location.hostname, local: 'unasked' });
      if (known !== 'unknown') return known;
      if (checked !== undefined) return checked;
      const kept = keptReach();
      if (kept?.instance === machine.instance) return kept.reach;
      // the viewer has started again since: a browser on its computer asks it again, one elsewhere may be asked
      return kept?.reach === 'same' ? check() : 'unknown';
    },
    check,
    async open(path, line) {
      const response = await fetch('/api/open-in-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Viewer': '1' },
        body: JSON.stringify({ path, line }),
      }).catch(() => undefined);
      const reply = response?.ok ? await response.json().catch(() => undefined) : undefined;
      if (isRecord(reply) && reply.ok === true) return { ok: true };
      return { ok: false, error: (isRecord(reply) ? text(reply.error) : undefined) ?? 'no-answer' };
    },
  };
}

/**
 * The viewer at the browser's own 127.0.0.1: what it says of itself; nothing answering there, or the browser keeping the
 * page from this computer's apps.
 * @param {number} port
 * @returns {Promise<import('../model/machine.js').LocalAnswer>}
 */
async function askLocal(port) {
  // no targetAddressSpace: Chrome tells 127.0.0.1 by itself, asks the user and lets an https page reach http there — and
  // a system proxy that takes 127.0.0.1 too leaves the address space unknown, the request naming one refused
  const response = await fetch(`http://127.0.0.1:${port}/api/machine`, { mode: 'cors' }).catch(() => undefined);
  if (response === undefined) return (await appsRefused()) ? 'refused' : 'no-answer';
  const machine = response.ok ? parseMachine(await response.json().catch(() => undefined)) : undefined;
  return machine === undefined ? 'no-answer' : machine;
}

/**
 * Whether the browser keeps the page from this computer's apps: Chrome asks its user first, and a refusal — or the
 * question put away unanswered — leaves the page out, wherever the browser is. A browser that knows no such permission
 * keeps nothing from it.
 * @returns {Promise<boolean>}
 */
async function appsRefused() {
  // Chrome 145 on, then the name before the permission was split; a name the browser does not know is refused
  for (const name of /** @type {const} */ (['loopback-network', 'local-network-access'])) {
    const status = await navigator.permissions.query({ name }).catch(() => undefined);
    if (status !== undefined) return status.state !== 'granted';
  }
  return false;
}

/** @returns {{ instance: string, reach: EditorReach } | undefined} */
function keptReach() {
  try {
    const kept = JSON.parse(localStorage.getItem(keptKey) ?? 'null');
    return isRecord(kept) && typeof kept.instance === 'string' && (kept.reach === 'same' || kept.reach === 'elsewhere') ? { instance: kept.instance, reach: kept.reach } : undefined;
  } catch {
    return undefined; // storage is unavailable or holds something else: the browser is asked again
  }
}

/** @param {{ instance: string, reach: EditorReach }} found */
function keep(found) {
  try {
    localStorage.setItem(keptKey, JSON.stringify(found));
  } catch {
    // storage is unavailable: found out again after a reload
  }
}
