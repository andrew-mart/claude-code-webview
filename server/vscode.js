// @ts-check
// VS Code in the browser: Microsoft's own web server — `code serve-web` of the VS Code CLI — started by the viewer the
// first time a page asks for it, and reached only through the viewer, at /vscode/: the viewer's checks — and whatever
// login stands in front of it — come before it. It listens on 127.0.0.1, on a port of its own, and answers only with a
// connection token the viewer makes, keeps in a file of its own and puts into each request itself: the browser never
// gets it. A server that stopped is started again; the viewer's stop takes it down with what it started.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

/**
 * @typedef {{ port: number, token: string }} VsCodeTarget — where the server answers, and its token
 * @typedef {{ target: () => Promise<VsCodeTarget | undefined>, close: () => void }} VsCode — target: the server,
 *   started if it is not running; none when it cannot be
 */

/** What runs VS Code's server and takes it down once the viewer is gone. */
const guard = fileURLToPath(new URL('./vscode-guard.js', import.meta.url));
/** The address the web UI and its server are under — the viewer passes /vscode/… on as it is. */
export const vscodeBasePath = '/vscode';
/** How long a server just started may take to listen: the first start downloads VS Code's server first. */
const listenTimeoutMs = 120_000;
const listenStepMs = 200;

/**
 * @param {{ command: readonly string[], tokenFile: string }} options — command: the VS Code CLI — code-tunnel.exe on
 *   Windows, code elsewhere — with any arguments before serve-web; tokenFile: where the token is kept for it
 * @returns {VsCode}
 */
export function createVsCode({ command, tokenFile }) {
  /** @typedef {{ child: import('node:child_process').ChildProcess | undefined, ready: Promise<VsCodeTarget | undefined> }} Run */
  /** @type {Run | undefined} */
  let running;

  /** @param {Run} run */
  const forget = (run) => {
    if (running === run) running = undefined;
    return undefined;
  };

  /**
   * The server started, once it listens; none when it cannot start.
   * @param {Run} run
   * @returns {Promise<VsCodeTarget | undefined>}
   */
  const launch = async (run) => {
    const [program, ...before] = command;
    if (program === undefined) return forget(run);
    // a server an earlier run left — the viewer fell, or was stopped before its guard looked — goes first
    await stopServers(tokenFile);
    const port = await freePort();
    const token = randomBytes(32).toString('base64url');
    await writeFile(tokenFile, token, { mode: 0o600 });
    const args = [...before, 'serve-web', '--host', '127.0.0.1', '--port', String(port), '--connection-token-file', tokenFile, '--server-base-path', vscodeBasePath, '--accept-server-license-terms', '--disable-telemetry'];
    // through the guard, which takes it down if the viewer goes without a word; detached: in a process group of its own
    // off Windows — stopping the group stops the guard, VS Code and the server it starts — and on Windows out of what
    // ends with the viewer: started through a shim (Volta), the viewer is in a job closed as the shim ends, which took
    // the guard along before it could stop the server
    const child = spawn(process.execPath, [guard, String(process.pid), program, ...args], { stdio: 'ignore', windowsHide: true, detached: true });
    run.child = child;
    const ended = new Promise((done) => {
      child.once('error', () => done(false));
      child.once('exit', () => {
        forget(run);
        done(false);
      });
    });
    if ((await Promise.race([waitForListening(port), ended])) !== true) {
      stopTree(child);
      return forget(run);
    }
    return { port, token };
  };

  return {
    target: () => {
      if (running !== undefined) return running.ready;
      /** @type {Run} */
      const run = { child: undefined, ready: Promise.resolve(undefined) };
      running = run;
      run.ready = launch(run);
      return run.ready;
    },
    close: () => {
      const stopping = running;
      running = undefined;
      if (stopping?.child !== undefined) stopTree(stopping.child);
      stopServersNow(tokenFile);
    },
  };
}

/**
 * A port of 127.0.0.1 no one listens on now.
 * @returns {Promise<number>}
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = address !== null && typeof address === 'object' ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Whether the port is listened on within the time a first start may take.
 * @param {number} port
 */
async function waitForListening(port) {
  for (let waited = 0; waited < listenTimeoutMs; waited += listenStepMs) {
    if (await answers(port)) return true;
    await delay(listenStepMs);
  }
  return false;
}

/** @param {number} port */
function answers(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

/**
 * The server and all it started: serve-web runs VS Code's server as a process of its own, which outlives a stopped
 * parent on Windows.
 * @param {import('node:child_process').ChildProcess} child
 */
function stopTree(child) {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => undefined);
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

/**
 * VS Code's servers started with this token file, with all they started, stopped. serve-web starts the server through
 * a process that ends at once: on Windows the server is out of its tree then, and lives on. Its command line names the
 * token file, which names the viewer's port: what another viewer on this computer runs is not touched. The processes
 * are listed without holding the viewer — on Windows it takes seconds.
 * @param {string} tokenFile
 * @returns {Promise<void>}
 */
export async function stopServers(tokenFile) {
  stopAll(serversOf(await processTable(), tokenFile, process.pid));
}

/**
 * The same, at once: for a process about to exit — the viewer, the guard — which waits for it.
 * @param {string} tokenFile
 */
export function stopServersNow(tokenFile) {
  stopAll(serversOf(processTableNow(), tokenFile, process.pid));
}

/** @param {ReadonlySet<number>} pids */
function stopAll(pids) {
  for (const pid of pids) {
    try {
      process.kill(pid);
    } catch {
      // gone already, or not ours to stop
    }
  }
}

/**
 * @typedef {{ pid: number, ppid: number, started: number | undefined, command: string }} Process — a process of the
 *   computer: its number, its parent's, when it began (ms) and its command line. On Windows a process keeps its
 *   parent's number after the parent is gone, and the number goes to another process: the parent is the one that began
 *   before it. Off Windows the number is always of a living parent — a process left behind is handed to another — and
 *   when it began is not told.
 */

/**
 * The processes of VS Code's servers started with this token file, and of all they started.
 * @param {readonly Process[]} table — the computer's processes
 * @param {string} tokenFile
 * @param {number} self — this process: not among them
 * @returns {Set<number>}
 */
export function serversOf(table, tokenFile, self) {
  const named = new RegExp(`${escaped(tokenFile)}(?=$|[\\s"'])`, process.platform === 'win32' ? 'i' : '');
  const servers = table.filter((one) => one.pid !== self && named.test(one.command));
  const doomed = new Map(servers.map((one) => [one.pid, one]));
  // and what they started, down the tree: a process that began before the one now under its parent's number is not
  for (let grew = true; grew; ) {
    grew = false;
    for (const one of table) {
      const parent = doomed.get(one.ppid);
      if (parent === undefined || doomed.has(one.pid) || one.pid === self || !startedBy(one, parent)) continue;
      doomed.set(one.pid, one);
      grew = true;
    }
  }
  return new Set(doomed.keys());
}

/**
 * Whether a process under another's number as its parent's was started by it: began after it — where neither tells
 * when it began, the number is its living parent's.
 * @param {Process} one
 * @param {Process} parent
 */
function startedBy(one, parent) {
  return one.started === undefined || parent.started === undefined || one.started >= parent.started;
}

/** What lists the computer's processes: each with its parent, when it began — on Windows — and its command line. */
const listing =
  process.platform === 'win32'
    ? { program: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$(if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() })`t$($_.CommandLine)" }'] }
    : { program: 'ps', args: ['-eo', 'pid=,ppid=,args='] };
const listingOptions = { encoding: /** @type {const} */ ('utf8'), windowsHide: true, timeout: 30_000, maxBuffer: 32 * 1024 * 1024 };

/**
 * The computer's processes, listed without holding this process.
 * @returns {Promise<Process[]>}
 */
async function processTable() {
  try {
    const { stdout } = await promisify(execFile)(listing.program, listing.args, listingOptions);
    return processesIn(stdout);
  } catch {
    return []; // nothing to tell the processes by: nothing is stopped
  }
}

/**
 * The computer's processes, listed at once.
 * @returns {Process[]}
 */
function processTableNow() {
  try {
    return processesIn(execFileSync(listing.program, listing.args, listingOptions));
  } catch {
    return []; // nothing to tell the processes by: nothing is stopped
  }
}

/**
 * The processes in what lists them: on Windows a line each, the fields between tabs; elsewhere as ps prints them, when
 * each began not told.
 * @param {string} output
 * @returns {Process[]}
 */
function processesIn(output) {
  const lines =
    process.platform === 'win32'
      ? output.split(/\r?\n/).map((line) => line.split('\t'))
      : output
          .split('\n')
          .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)?.slice(1) ?? [])
          .map(([pid, ppid, command]) => [pid, ppid, '', command]);
  return lines.flatMap(([pid, ppid, started, ...command]) =>
    pid === undefined || ppid === undefined || !/^\d+$/.test(pid) ? [] : [{ pid: Number(pid), ppid: Number(ppid), started: started !== undefined && /^\d+$/.test(started) ? Number(started) : undefined, command: command.join('\t') }],
  );
}

/** @param {string} text */
function escaped(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
