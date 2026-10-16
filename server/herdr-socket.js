// @ts-check
// herdr's socket API, without starting the herdr program for every call (a tenth of a second on Windows each): a JSON
// line with the request, a JSON line with the reply, and herdr closes the connection. herdr listens on the unix socket
// at its socket path, and on Windows on the named pipe of that path's name.
// One request at a time: a connection opened while another is open waits for herdr's next pipe — again a tenth of a
// second on Windows — while requests one after another take a millisecond or two.
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { isRecord } from '../public/model/narrow.js';

/** A request that has not been answered by then is given up: herdr answers in milliseconds. */
const replyTimeoutMs = 5000;
/** The pause between one connection's close and the next one, for herdr to have its next pipe ready. */
const pipeReadyMs = 1;

/**
 * Where herdr listens, for a socket path.
 * @param {string} socketPath — HERDR_SOCKET_PATH
 * @returns {string}
 */
export function socketAddress(socketPath) {
  return process.platform === 'win32' ? `\\\\.\\pipe\\${socketPath}` : socketPath;
}

/**
 * @typedef {{ ok: true, result: unknown } | { ok: false, error: string }} SocketReply
 */

/** What a terminal on the page and its prompts wait for: asked before the requests queued for the sidebar. */
const urgentMethods = new Set(['pane.read', 'pane.send_text', 'pane.send_keys']);

/**
 * @typedef {{ method: string, params: Record<string, unknown>, resolve: (reply: SocketReply) => void }} Job
 */

/**
 * @param {string} socketPath — HERDR_SOCKET_PATH
 */
export function createHerdrSocket(socketPath) {
  const address = socketAddress(socketPath);
  /** @type {{ urgent: Job[], background: Job[] }} */
  const queued = { urgent: [], background: [] };
  let asking = false;
  const take = () => queued.urgent.shift() ?? queued.background.shift();
  /**
   * Asks the queued requests one after another until none is left. On Windows herdr's next pipe is not ready at once
   * when one closes: a connection opened straight after waits a tenth of a second for it, a millisecond later it does not.
   */
  const work = async () => {
    if (asking) return;
    asking = true;
    for (let job = take(); job !== undefined; job = take()) {
      job.resolve(await ask(address, job.method, job.params));
      await delay(pipeReadyMs);
    }
    asking = false;
  };
  return {
    /**
     * @param {string} method — e.g. pane.read
     * @param {Record<string, unknown>} params
     * @returns {Promise<SocketReply>}
     */
    request(method, params) {
      return new Promise((resolve) => {
        (urgentMethods.has(method) ? queued.urgent : queued.background).push({ method, params, resolve });
        void work();
      });
    },
  };
}

/**
 * @param {string} address
 * @param {string} method
 * @param {Record<string, unknown>} params
 * @returns {Promise<SocketReply>}
 */
function ask(address, method, params) {
  return new Promise((resolve) => {
    const socket = connect(address);
    let text = '';
    const timer = setTimeout(() => socket.destroy(new Error(`herdr did not answer ${method} within ${replyTimeoutMs} ms`)), replyTimeoutMs);
    socket.on('connect', () => socket.write(`${JSON.stringify({ id: method, method, params })}\n`));
    socket.on('data', (chunk) => {
      text += chunk.toString('utf8');
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message });
    });
    socket.on('close', (failed) => {
      clearTimeout(timer);
      if (!failed) resolve(replyOf(text));
    });
  });
}

/**
 * @param {string} text — herdr's reply line
 * @returns {SocketReply}
 */
function replyOf(text) {
  /** @type {unknown} */
  let reply;
  try {
    reply = JSON.parse(text);
  } catch {
    return { ok: false, error: `herdr's reply is not JSON: ${text.slice(0, 120)}` };
  }
  if (!isRecord(reply)) return { ok: false, error: `herdr's reply is not an object: ${text.slice(0, 120)}` };
  if (isRecord(reply.error)) return { ok: false, error: `${String(reply.error.code)}: ${String(reply.error.message)}` };
  return 'result' in reply ? { ok: true, result: reply.result } : { ok: false, error: `herdr's reply has no result: ${text.slice(0, 120)}` };
}

/**
 * The herdr commands the viewer gives, asked through herdr's socket instead of starting the herdr program, and
 * answered as the program prints them: its JSON — the socket's result is the same — or, for pane read, the screen's
 * text. A command not known here is left to the program.
 * @param {ReturnType<typeof createHerdrSocket>} socket
 * @param {import('./composer.js').RunHerdr} program
 * @returns {import('./composer.js').RunHerdr}
 */
export function socketRunner(socket, program) {
  return async (args) => {
    const call = socketCall(args);
    if (call === undefined) return program(args);
    const reply = await socket.request(call.method, call.params);
    if (!reply.ok) return { ok: false, error: reply.error, missing: false };
    if (call.method !== 'pane.read') return { ok: true, json: { result: reply.result }, text: '' };
    const read = isRecord(reply.result) && isRecord(reply.result.read) ? reply.result.read : {};
    return typeof read.text === 'string' ? { ok: true, json: undefined, text: read.text } : { ok: false, error: `herdr's pane.read gave no text`, missing: false };
  };
}

/**
 * The socket's method and parameters for a command of the herdr program.
 * @param {readonly string[]} args
 * @returns {{ method: string, params: Record<string, unknown> } | undefined} — none for a command not known here
 */
function socketCall(args) {
  const [subject, command, ...rest] = args;
  if (subject === 'api' && command === 'snapshot' && rest.length === 0) return { method: 'session.snapshot', params: {} };
  if (subject === 'tab') return tabCall(command, rest);
  if (subject === 'workspace' && command === 'create') return workspaceCreateCall(rest);
  if (subject !== 'pane') return undefined;
  const [pane, ...more] = rest;
  switch (command) {
    case 'list':
      return rest.length === 0 ? { method: 'pane.list', params: {} } : undefined;
    case 'process-info':
      return pane === '--pane' && more.length === 1 ? { method: 'pane.process_info', params: { pane_id: more[0] } } : undefined;
    case 'send-text':
      return pane !== undefined && more.length === 1 ? { method: 'pane.send_text', params: { pane_id: pane, text: more[0] } } : undefined;
    case 'send-keys':
      return pane !== undefined && more.length > 0 ? { method: 'pane.send_keys', params: { pane_id: pane, keys: more } } : undefined;
    case 'read': {
      const [sourceFlag, source, formatFlag, format] = more;
      const known = pane !== undefined && sourceFlag === '--source' && formatFlag === '--format' && more.length === 4;
      return known ? { method: 'pane.read', params: { pane_id: pane, source, format, strip_ansi: format === 'text' } } : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * @param {string | undefined} command
 * @param {readonly string[]} rest — the tab, and the new name for rename, where it goes for move — the place between its
 *   workspace's tabs as they stand, 0 before the first; for create, its workspace and folder
 * @returns {{ method: string, params: Record<string, unknown> } | undefined}
 */
function tabCall(command, rest) {
  if (command === 'create') return tabCreateCall(rest);
  const [tab, label, ...more] = rest;
  if (tab === undefined || more.length > 0) return undefined;
  if (command === 'rename' && label !== undefined) return { method: 'tab.rename', params: { tab_id: tab, label } };
  // herdr's program has no move: the socket alone moves a tab
  if (command === 'move' && label !== undefined && /^\d+$/.test(label)) return { method: 'tab.move', params: { tab_id: tab, insert_index: Number(label) } };
  if (command === 'close' && label === undefined) return { method: 'tab.close', params: { tab_id: tab } };
  return undefined;
}

/**
 * A new tab in a workspace, in a folder if one is given; the tab it is opened from stays the focused one in herdr.
 * @param {readonly string[]} rest — --workspace <id> [--cwd <folder>]
 * @returns {{ method: string, params: Record<string, unknown> } | undefined}
 */
function tabCreateCall(rest) {
  const [workspaceFlag, workspace, cwdFlag, cwd, ...more] = rest;
  if (workspaceFlag !== '--workspace' || workspace === undefined || more.length > 0) return undefined;
  if (cwdFlag === undefined) return { method: 'tab.create', params: { workspace_id: workspace, focus: false } };
  return cwdFlag === '--cwd' && cwd !== undefined ? { method: 'tab.create', params: { workspace_id: workspace, cwd, focus: false } } : undefined;
}

/**
 * A new workspace with its first tab, in a folder; the one focused stays so in herdr.
 * @param {readonly string[]} rest — --label <name> --cwd <folder>
 * @returns {{ method: string, params: Record<string, unknown> } | undefined}
 */
function workspaceCreateCall(rest) {
  const [labelFlag, label, cwdFlag, cwd, ...more] = rest;
  const known = labelFlag === '--label' && label !== undefined && cwdFlag === '--cwd' && cwd !== undefined && more.length === 0;
  return known ? { method: 'workspace.create', params: { label, cwd, focus: false } } : undefined;
}
