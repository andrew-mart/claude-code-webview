// @ts-check
// Which Antigravity CLI (agy) conversation is open now, and in which herdr pane. agy keeps no record of its processes
// as Claude Code does, nor a lock that tells on every system; what it does keep is a log of each run
// (<home>/log/cli-<time>.log): the pid of the language server it starts — alive while agy runs — the folder it works in,
// each conversation it creates or goes over to, whether it runs a program's prompt (agy -p), and its language server's
// shutting down, once agy quits as it should. agy makes a conversation only with its first message: a run before it
// goes by an id of its own (agyStartedId), as a session Claude Code has just started — its pane shows a feed to write
// the first message in, and the page goes on to the conversation once agy has made it.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { folderKey } from './folders.js';

/**
 * @typedef {{ serverPid: number, folder: string | undefined, conversation: string | undefined, print: boolean, ended: boolean }} AgyProcess
 *   — an agy process, as its log tells it: conversation, the one it streams now — none before its first message;
 *   print, a program's run, agy -p, in no terminal; ended, its language server shut down — agy quit as it should
 */

/**
 * @typedef {AgyProcess & { startedAt: number }} AgyRun — an agy run alive: startedAt, when, in ms — its log is named so
 */

/**
 * The id a run goes by before its first message, a session's id in shape: made from the run — the same each time —
 * marked as a UUID of version 8, made by its maker, apart from agy's conversations' random ones (version 4).
 * @param {AgyRun} run
 * @returns {string}
 */
export function agyStartedId(run) {
  const hash = createHash('sha1').update(`agy-run:${run.startedAt}:${run.serverPid}`).digest('hex');
  const variant = ((Number.parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/**
 * The runs in a terminal before their first message, as sessions just started: each in its folder, since it started.
 * @param {readonly AgyRun[]} runs
 * @returns {import('./sessions.js').StartedSession[]}
 */
export function agyStartedSessions(runs) {
  return runs.flatMap((run) => (run.print || run.conversation !== undefined || run.folder === undefined ? [] : [{ id: agyStartedId(run), cwd: run.folder, startedAt: run.startedAt, agent: 'agy' }]));
}

/** A run's log's name: when it started, in the computer's time. */
const runLogName = /^cli-(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.log$/;

/**
 * When a run started, as its log is named; none for a name that tells no time.
 * @param {string} name
 * @returns {number | undefined}
 */
function startedAtOf(name) {
  const parts = runLogName.exec(name)?.slice(1).map(Number);
  if (parts === undefined) return undefined;
  const [year = 0, month = 1, day = 1, hours = 0, minutes = 0, seconds = 0] = parts;
  return new Date(year, month - 1, day, hours, minutes, seconds).getTime();
}

const serverStarted = /Starting language server process with pid (\d+)/;
const workspace = /workspaceDirs=\[([^\]]*)\]/;
/** The lines that tell the conversation agy goes on with: one made, one gone over to, a program's prompt's. */
const conversationLine = /(?:Created conversation|Streaming conversation|Print mode: conversation=)\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;
const shutDown = /\] Language server shutting down$/m;

/**
 * @param {string} log — a run's, whole
 * @returns {AgyProcess | undefined} — none for a log that is not of an agy run
 */
export function agyProcessOf(log) {
  const pid = Number(serverStarted.exec(log)?.[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  const folder = workspace.exec(log)?.[1]?.trim();
  const conversations = [...log.matchAll(conversationLine)].map((match) => match[1]);
  return { serverPid: pid, folder: folder === undefined || folder === '' ? undefined : folder, conversation: conversations.at(-1), print: log.includes('Print mode: starting'), ended: shutDown.test(log) };
}

/** The processes found are told again for this long: the feed asks whether its conversation is open several times a second. */
const freshMs = 1500;
/** How many of the latest runs' logs are looked at: a log stays once its run ended, a program's runs leave many a day. */
const latestLogs = 300;

/**
 * agy's processes alive now, from the latest runs' logs: each read once, and again once it has grown; a run whose log
 * tells it ended, or whose language server is no longer agy's — gone, or its pid given to another program — has ended.
 * @param {{ home: string, agyOnes: (pids: readonly number[]) => ReadonlySet<number> }} deps — home: agy's,
 *   ~/.gemini/antigravity-cli; agyOnes: which of these pids are agy's processes now (createAgyCheck)
 */
export function createAgyProcesses({ home, agyOnes }) {
  /** Each log read, by its path, and the state of the file it was read in. */
  /** @type {Map<string, { stamp: string, process: AgyProcess | undefined }>} */
  const read = new Map();
  /** @type {{ at: number, found: Promise<AgyRun[]> } | undefined} */
  let last;

  /** @returns {Promise<AgyRun[]>} */
  const look = async () => {
    const folder = join(home, 'log');
    // a run's log is named by when it started: the latest last
    const names = (await readdir(folder).catch(() => [])).filter((name) => name.startsWith('cli-') && name.endsWith('.log')).sort().slice(-latestLogs);
    const logged = await Promise.all(
      names.map(async (name) => {
        const path = join(folder, name);
        const startedAt = startedAtOf(name);
        const info = await stat(path).catch(() => undefined);
        if (info === undefined || startedAt === undefined) return [];
        const stamp = `${info.mtimeMs}:${info.size}`;
        const known = read.get(path);
        const process = known?.stamp === stamp ? known.process : agyProcessOf(await readFile(path, 'utf8').catch(() => ''));
        read.set(path, { stamp, process });
        return process === undefined ? [] : [{ ...process, startedAt }];
      }),
    );
    const runs = logged.flat().filter((run) => !run.ended);
    const agys = agyOnes(runs.map((run) => run.serverPid));
    return runs.filter((run) => agys.has(run.serverPid));
  };

  /** @returns {Promise<AgyRun[]>} */
  const open = () => {
    const now = Date.now();
    if (last === undefined || now - last.at >= freshMs) last = { at: now, found: look() };
    return last.found;
  };

  return {
    open,
    /**
     * Whether agy holds a conversation open now: a run streams it — in a terminal, or a program's writing it — or it is
     * a run's in a terminal before its first message.
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    holds: async (id) => (await open()).some((run) => run.conversation === id || agyStartedSessions([run]).some((started) => started.id === id)),
  };
}

/** A pid the system told agy's — or not — is believed so this long while it lives; then the system is asked again. */
const toldForMs = 60_000;

/**
 * Which of these pids are agy's processes now, told at once from what the system last said of each: asking it is slow on
 * Windows — seconds, tasklist, tens of them on a busy computer — so it is asked in the background, and a pid it has not
 * told of yet is none of agy's until it does, or until someone vouches for it: herdr, telling agy's program in its pane;
 * a pid gone is forgotten — its number may be given to another program.
 * @param {{ alive: (pid: number) => boolean, agyAmong: (pids: readonly number[]) => Promise<readonly number[]>, now: () => number }} deps
 *   — alive: whether a process of this pid runs (processAlive); agyAmong: which of these are agy's, asking the system
 *   (agyProcessesAmong)
 * @returns {{ agyOnes: (pids: readonly number[]) => ReadonlySet<number>, vouch: (pids: readonly number[]) => void }}
 */
export function createAgyCheck({ alive, agyAmong, now }) {
  /** @type {Map<number, { agy: boolean, at: number }>} */
  const told = new Map();
  /** @type {{ asking: Promise<void> | undefined }} */
  const system = { asking: undefined };

  /** @param {readonly number[]} pids */
  const ask = (pids) => {
    const at = now();
    system.asking = agyAmong(pids)
      .then((agys) => {
        for (const pid of pids) told.set(pid, { agy: agys.includes(pid), at });
      })
      // the system did not answer: what it said before stands, it is asked again at the next look
      .catch(() => undefined)
      .finally(() => {
        system.asking = undefined;
      });
  };

  return {
    /** @param {readonly number[]} pids */
    agyOnes: (pids) => {
      const living = pids.filter(alive);
      for (const pid of told.keys()) if (!living.includes(pid)) told.delete(pid);
      const stale = living.filter((pid) => {
        const known = told.get(pid);
        return known === undefined || now() - known.at >= toldForMs;
      });
      if (stale.length > 0 && system.asking === undefined) ask(stale);
      return new Set(living.filter((pid) => told.get(pid)?.agy === true));
    },
    /**
     * Pids someone else tells are agy's — herdr, of the program in an agy pane — taken so at once, as the system's own
     * answer would be: asked again once that is old.
     * @param {readonly number[]} pids
     */
    vouch: (pids) => {
      for (const pid of pids) if (told.get(pid)?.agy !== true) told.set(pid, { agy: true, at: now() });
    },
  };
}

/**
 * Whether a process of this pid runs: one there, though another user's — not to be signalled — runs as well.
 * @param {number} pid
 * @returns {boolean}
 */
export function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

/**
 * Which of these pids are agy's processes now — its own or its language server's, the same program — by the system's
 * list of them: on Windows tasklist's, each one's program; elsewhere /proc's, each one's command line. A pid there is not
 * enough: Windows gives a freed one to the next program soon.
 * @param {readonly number[]} pids
 * @returns {Promise<number[]>}
 */
export async function agyProcessesAmong(pids) {
  if (process.platform === 'win32') {
    const listed = await new Promise((resolve, reject) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => (error === null ? resolve(stdout) : reject(error))));
    return agyPidsListed(String(listed)).filter((pid) => pids.includes(pid));
  }
  const found = await Promise.all(pids.map(async (pid) => ((await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')).split('\0').some((word) => agyProgram.test(word)) ? [pid] : [])));
  return found.flat();
}

/**
 * agy's programs, by their path or name: agy itself — agy, agy.exe — and a language server of its own, should it run
 * one apart, as the editors agy comes of do (language_server_windows_x64.exe).
 */
const agyProgram = /(?:^|[\\/])(?:agy(?:\.exe)?|language_server[^\\/]*)$/i;

/**
 * Whether a program is one of agy's, by its path or name.
 * @param {string} program
 * @returns {boolean}
 */
export function isAgyProgram(program) {
  return agyProgram.test(program);
}

/**
 * The pids of agy's processes in tasklist's CSV: a line a process — its program, its pid, ….
 * @param {string} csv
 * @returns {number[]}
 */
export function agyPidsListed(csv) {
  return csv.split(/\r?\n/).flatMap((line) => {
    const [program, pid] = [...line.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
    const number = Number(pid);
    return program !== undefined && agyProgram.test(program) && Number.isSafeInteger(number) ? [number] : [];
  });
}

/**
 * What the agy panes run: the agy run whose process herdr tells in the pane; then, in a pane's folder, the one agy run
 * left there in a terminal — a program's run is in none — when the pane is the one agy pane left there. A pane runs
 * its run's conversation or, before its first message, the run itself by its own id (agyStartedId). Panes of a folder
 * with more runs left than one cannot be told apart and are left out — a terminal, not a feed.
 * @param {readonly import('./herdr.js').Pane[]} panes
 * @param {readonly AgyRun[]} runs
 * @param {ReadonlyMap<string, readonly number[]>} told — the processes herdr told in each pane asked about, by pane id
 * @returns {{ conversations: Map<string, string>, started: Map<string, string> }} — by pane id: conversations' ids;
 *   the ids of runs before their first message
 */
export function agyPanes(panes, runs, told) {
  const inTerminals = runs.filter((one) => !one.print && one.folder !== undefined);
  const agyPanesThere = panes.filter((pane) => pane.agent === 'agy' && pane.cwd !== undefined);
  /** @type {Map<string, AgyRun>} */
  const runByPane = new Map();
  for (const pane of agyPanesThere) {
    const run = inTerminals.find((one) => told.get(pane.paneId)?.includes(one.serverPid) === true);
    if (run !== undefined) runByPane.set(pane.paneId, run);
  }
  const taken = new Set(runByPane.values());
  for (const pane of agyPanesThere) {
    if (pane.cwd === undefined || runByPane.has(pane.paneId)) continue;
    const folder = folderKey(pane.cwd);
    const there = agyPanesThere.filter((one) => !runByPane.has(one.paneId) && one.cwd !== undefined && folderKey(one.cwd) === folder);
    const running = inTerminals.filter((one) => !taken.has(one) && one.folder !== undefined && folderKey(one.folder) === folder);
    const [run] = running;
    if (there.length === 1 && running.length === 1 && run !== undefined) runByPane.set(pane.paneId, run);
  }
  /** @type {Map<string, string>} */
  const conversations = new Map();
  /** @type {Map<string, string>} */
  const started = new Map();
  for (const [pane, run] of runByPane) {
    if (run.conversation === undefined) started.set(pane, agyStartedId(run));
    else conversations.set(pane, run.conversation);
  }
  return { conversations, started };
}
