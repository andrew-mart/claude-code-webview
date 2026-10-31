// @ts-check
// Adapter to herdr — the terminal multiplexer whose panes run Claude Code sessions.
// Verified on Windows with herdr inside WezTerm: send-text delivers the text as is, and Claude Code inserts
// a "\n" line break into its input box; send-keys enter produces "\r" — submit; esc — interrupt.
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isRecord, text } from '../public/model/narrow.js';

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
        resolve({ ok: true, json: parseJson(stdout), text: stdout });
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
  return foregroundProcesses(json).flatMap((process) => (typeof process.pid === 'number' ? [process.pid] : []));
}

/**
 * The session a pane's process goes on from as a fork of its own — Claude Code started `--resume <id> --fork-session`,
 * as a tab duplicated from the page is: none for another process, or one that resumes a session without forking it.
 * Claude Code writes the fork's transcript only with its first new message; until then the session it was forked from
 * holds its conversation.
 * @param {unknown} json — the `herdr pane process-info` reply
 * @param {number} pid — the process's
 * @returns {string | undefined}
 */
export function forkedFrom(json, pid) {
  const argv = foregroundProcesses(json).find((process) => process.pid === pid)?.argv;
  if (!Array.isArray(argv) || !argv.includes('--fork-session')) return undefined;
  const resumed = argv[argv.indexOf('--resume') + 1];
  return argv.includes('--resume') && typeof resumed === 'string' && !resumed.startsWith('-') ? resumed : undefined;
}

/**
 * @param {unknown} json — the `herdr pane process-info` reply
 * @returns {readonly Record<string, unknown>[]}
 */
function foregroundProcesses(json) {
  const info = isRecord(json) && isRecord(json.result) && isRecord(json.result.process_info) ? json.result.process_info : {};
  return Array.isArray(info.foreground_processes) ? info.foreground_processes.filter(isRecord) : [];
}

/**
 * @typedef {typeof agentStatuses[number]} AgentStatus — what herdr makes of the agent in a pane, a tab or a workspace
 * @typedef {{ id: string, number: number, label: string, status: AgentStatus, activeTab: string | undefined }} HerdrWorkspace
 * @typedef {{ id: string, workspaceId: string, number: number, label: string, status: AgentStatus }} HerdrTab
 * @typedef {{ cols: number, rows: number }} PaneSize
 * @typedef {{ paneId: string, workspaceId: string, tabId: string | undefined, terminal: string | undefined, cwd: string | undefined, agent: string | undefined, status: AgentStatus, title: string | undefined, size: PaneSize | undefined, activity: number | undefined }} Pane
 *   terminal: herdr's id of its terminal, one of its own for every terminal herdr opens — a pane's id is used again by
 *   others; cwd: the folder of its shell or program; agent: the coding agent herdr recognized there (claude, codex, …);
 *   title: the terminal's title; size: its terminal's, from the tab's layout; activity: herdr's count of agents' state
 *   changes when this pane's agent changed state last — the larger, the more recent; none without an agent
 * @typedef {{ workspaces: readonly HerdrWorkspace[], tabs: readonly HerdrTab[], panes: readonly Pane[] }} HerdrSnapshot
 */

const agentStatuses = /** @type {const} */ (['idle', 'working', 'blocked', 'done', 'unknown']);

/**
 * What herdr shows: its workspaces, their tabs and the panes in them (the `herdr api snapshot` reply).
 * @param {unknown} json
 * @returns {HerdrSnapshot | undefined}
 */
export function snapshotOf(json) {
  const snapshot = isRecord(json) && isRecord(json.result) && isRecord(json.result.snapshot) ? json.result.snapshot : undefined;
  if (snapshot === undefined) return undefined;
  const sizes = paneSizes(snapshot.layouts);
  const activity = agentActivity(snapshot.agents);
  return {
    workspaces: recordsIn(snapshot.workspaces).flatMap((workspace) =>
      typeof workspace.workspace_id === 'string' && typeof workspace.label === 'string' && typeof workspace.number === 'number'
        ? [{ id: workspace.workspace_id, number: workspace.number, label: workspace.label, status: statusOf(workspace.agent_status), activeTab: text(workspace.active_tab_id) }]
        : [],
    ),
    tabs: recordsIn(snapshot.tabs).flatMap((tab) =>
      typeof tab.tab_id === 'string' && typeof tab.workspace_id === 'string' && typeof tab.label === 'string' && typeof tab.number === 'number'
        ? [{ id: tab.tab_id, workspaceId: tab.workspace_id, number: tab.number, label: tab.label, status: statusOf(tab.agent_status) }]
        : [],
    ),
    panes: recordsIn(snapshot.panes).flatMap((pane) =>
      typeof pane.pane_id === 'string' && typeof pane.workspace_id === 'string'
        ? [{ paneId: pane.pane_id, workspaceId: pane.workspace_id, tabId: text(pane.tab_id), terminal: text(pane.terminal_id), cwd: text(pane.cwd), agent: text(pane.agent), status: statusOf(pane.agent_status), title: text(pane.terminal_title_stripped), size: sizes.get(pane.pane_id), activity: activity.get(pane.pane_id) }]
        : [],
    ),
  };
}

/**
 * When each pane's agent changed state last, as herdr counts its agents' state changes.
 * @param {unknown} agents
 * @returns {Map<string, number>} — by pane id
 */
function agentActivity(agents) {
  return new Map(recordsIn(agents).flatMap((agent) => (typeof agent.pane_id === 'string' && typeof agent.state_change_seq === 'number' ? [/** @type {const} */ ([agent.pane_id, agent.state_change_seq])] : [])));
}

/**
 * The size of each pane's terminal, in columns and rows, from the layouts of the tabs.
 * @param {unknown} layouts
 * @returns {Map<string, PaneSize>} — by pane id
 */
function paneSizes(layouts) {
  return new Map(
    recordsIn(layouts).flatMap((layout) =>
      recordsIn(layout.panes).flatMap((pane) => {
        const rect = isRecord(pane.rect) ? pane.rect : {};
        return typeof pane.pane_id === 'string' && typeof rect.width === 'number' && typeof rect.height === 'number' ? [/** @type {const} */ ([pane.pane_id, { cols: rect.width, rows: rect.height }])] : [];
      }),
    ),
  );
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>[]}
 */
function recordsIn(value) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * @param {unknown} value
 * @returns {AgentStatus}
 */
function statusOf(value) {
  return agentStatuses.find((status) => status === value) ?? 'unknown';
}

/**
 * herdr reports a failure either by its exit code or by an error field in the JSON (e.g. protocol_mismatch).
 * @param {import('./composer.js').HerdrReply} reply
 * @returns {reply is { ok: true, json: unknown, text: string }}
 */
export function succeeded(reply) {
  return reply.ok && !(isRecord(reply.json) && reply.json.error !== undefined);
}

/**
 * herdr turned off (--no-herdr): as if it were not installed, so the page only reads sessions.
 * @type {import('./composer.js').RunHerdr}
 */
export const herdrTurnedOff = async () => ({ ok: false, error: 'herdr is turned off with --no-herdr', missing: true });

/**
 * A pane's terminal through herdr's commands — given to its socket or its program (herdr-socket.js).
 * @param {import('./composer.js').RunHerdr} herdr
 * @returns {import('./terminal.js').PaneIo}
 */
export function paneIoOf(herdr) {
  return {
    async read(pane) {
      const reply = await herdr(['pane', 'read', pane, '--source', 'visible', '--format', 'ansi']);
      return reply.ok ? { ok: true, text: reply.text } : { ok: false, missing: reply.missing };
    },
    async type(pane, text) {
      const reply = await herdr(['pane', 'send-text', pane, text]);
      if (succeeded(reply)) return { ok: true };
      return { ok: false, error: !reply.ok && reply.missing ? 'herdr-missing' : 'gone' };
    },
  };
}

