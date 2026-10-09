// @ts-check
// Adapter to herdr — the terminal multiplexer whose panes run Claude Code sessions.
// Verified on Windows with herdr inside WezTerm: send-text delivers the text as is, and Claude Code inserts
// a "\n" line break into its input box; send-keys enter produces "\r" — submit; esc — interrupt.
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isRecord } from '../public/model/narrow.js';

/**
 * @param {string} file — .run/herdr.json
 * @returns {Promise<SavedHerdr | undefined>}
 */
export async function readSavedHerdr(file) {
  const content = await readFile(file, 'utf8').catch(() => undefined);
  if (content === undefined) return undefined;
  try {
    return parseSavedHerdr(JSON.parse(content));
  } catch {
    return undefined; // the file is corrupt — treat it as if no herdr was saved
  }
}

/**
 * Remember the herdr found in a pane's environment — for launches outside herdr (the Start menu shortcut).
 * @param {string} file
 * @param {SavedHerdr} saved
 */
export async function saveHerdr(file, saved) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(saved, undefined, 2)}\n`);
}

/** herdr answers quickly; a hung call must not hold up a request from the browser. */
const herdrTimeoutMs = 5000;

/**
 * Runs the herdr CLI without a shell (arguments as an array, so the prompt text is never interpreted as a command).
 * The herdr server address is passed via HERDR_SOCKET_PATH — this is how the client finds the herdr running the sessions.
 * @param {HerdrTarget} target
 * @returns {import('./composer.js').RunHerdr}
 */
export function createHerdrRunner(target) {
  const env = target.socketPath === undefined ? process.env : { ...process.env, HERDR_SOCKET_PATH: target.socketPath };
  return (args) =>
    new Promise((resolve) => {
      execFile(target.bin, [...args], { env, timeout: herdrTimeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error !== null) {
          // ENOENT — no such program: herdr is not installed (or HERDR_BIN_PATH is wrong).
          resolve({ ok: false, error: `${error.message}${stderr === '' ? '' : `: ${stderr.trim()}`}`, missing: error.code === 'ENOENT' });
          return;
        }
        resolve({ ok: true, json: parseJson(stdout) });
      });
    });
}

/**
 * @param {string} output
 * @returns {unknown}
 */
function parseJson(output) {
  try {
    return JSON.parse(output);
  } catch {
    return undefined; // commands like send-keys may print nothing — that is not an error
  }
}

/**
 * @typedef {{ binPath: string, socketPath: string }} SavedHerdr — a remembered herdr: its executable and server address
 * @typedef {{ bin: string, socketPath: string | undefined, source: 'env' | 'saved' | 'path' }} HerdrTarget
 */

/**
 * @param {unknown} json — contents of .run/herdr.json
 * @returns {SavedHerdr | undefined}
 */
export function parseSavedHerdr(json) {
  if (!isRecord(json) || typeof json.binPath !== 'string' || typeof json.socketPath !== 'string') return undefined;
  return { binPath: json.binPath, socketPath: json.socketPath };
}

/**
 * Which herdr to call. Inside a pane herdr itself sets HERDR_BIN_PATH and HERDR_SOCKET_PATH — they are the most accurate;
 * outside herdr (the Start menu shortcut) — the ones saved by the last launch from a pane; otherwise — herdr from PATH.
 * @param {Readonly<Record<string, string | undefined>>} env
 * @param {SavedHerdr | undefined} saved
 * @returns {HerdrTarget}
 */
export function resolveHerdr(env, saved) {
  const bin = env.HERDR_BIN_PATH;
  const socketPath = env.HERDR_SOCKET_PATH;
  if (bin !== undefined && socketPath !== undefined) return { bin, socketPath, source: 'env' };
  if (saved !== undefined) return { bin: saved.binPath, socketPath: saved.socketPath, source: 'saved' };
  return { bin: 'herdr', socketPath: undefined, source: 'path' };
}

/**
 * Prompt text for Claude Code's input box: "\r" would act as Enter and submit the prompt mid-text,
 * so every line break becomes "\n"; trailing blank lines are dropped.
 * @param {string} text
 * @returns {string}
 */
export function toTerminalInput(text) {
  return text.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
}

/**
 * Panes in which herdr recognized Claude Code (the `herdr pane list` reply).
 * @param {unknown} json
 * @returns {readonly string[]}
 */
export function claudePaneIds(json) {
  const panes = isRecord(json) && isRecord(json.result) && Array.isArray(json.result.panes) ? json.result.panes.filter(isRecord) : [];
  return panes.flatMap((pane) => (pane.agent === 'claude' && typeof pane.pane_id === 'string' ? [pane.pane_id] : []));
}

/**
 * A pane's foreground processes (the `herdr pane process-info` reply).
 * @param {unknown} json
 * @returns {readonly number[]}
 */
export function foregroundPids(json) {
  const info = isRecord(json) && isRecord(json.result) && isRecord(json.result.process_info) ? json.result.process_info : {};
  const processes = Array.isArray(info.foreground_processes) ? info.foreground_processes.filter(isRecord) : [];
  return processes.flatMap((process) => (typeof process.pid === 'number' ? [process.pid] : []));
}
