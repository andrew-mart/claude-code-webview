// @ts-check
// The claude-code-webview command: start the viewer (in the foreground or in the background), stop it, create a shortcut.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, open, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord, text } from '../public/model/narrow.js';
import { parseCommand } from './args.js';
import { openBrowser, serve, stateDir } from './serve.js';
import { installShortcut, isTemporaryInstall } from './shortcut.js';

const binPath = fileURLToPath(new URL('../bin/claude-code-webview.js', import.meta.url));
const iconPath = fileURLToPath(new URL('../assets/icon.ico', import.meta.url));
const logFile = join(stateDir, 'server.log');
/** How long to wait for the background server to start answering. */
const startTimeoutMs = 20_000;

const usage = `claude-code-webview — Claude Code sessions in the browser, styled like Claude Desktop

Usage: claude-code-webview [options]

  (no options)          start the viewer and open it in the browser (Ctrl+C to stop);
                        if it is already running, just open the browser
  -b, --background      start in the background (log: ${logFile})
      --stop            stop the running viewer
      --restart         stop and start again in the background
  -p, --port <port>     port on 127.0.0.1 (default 7788)
      --no-open         do not open the browser
      --palette <name>  the page's accent colour, to tell two viewers apart:
                        clay (default), sea, moss or plum
      --public-url <url>  an address the page is also opened at, behind a tunnel such as
                        Cloudflare Tunnel: https://viewer.example.com (repeat for more);
                        keep it behind a login such as Cloudflare Access
      --no-herdr        do not use herdr even if it is found: the page only reads sessions
      --claude-command <command>
                        what starts Claude Code in a herdr tab opened from the page (default: claude)
      --editor-command <command>
                        opens a file of the file panel in an editor of this computer, from a browser
                        on it: {path}, {line} and {project} (the nearest folder above with a .sln
                        or .git) are filled in, e.g. "code --goto {path}:{line}"
      --install-shortcut  create a desktop shortcut that starts the viewer (Windows);
                        add --start-menu to put it into the Start menu instead
  -h, --help            show this help
  -v, --version         show the version

Environment:
  CLAUDE_CONFIG_DIR     Claude Code config directory (default ~/.claude)

Sending prompts from the page needs herdr (https://herdr.dev): run the viewer once from a herdr pane,
it remembers how to reach herdr; its workspaces then group the session list. Without herdr everything else works,
the input box and the workspaces are not shown.`;

/**
 * @param {readonly string[]} argv
 * @returns {Promise<number>} — exit code; serve does not return while the server is running
 */
export async function main(argv) {
  const parsed = parseCommand(argv);
  if (!parsed.ok) {
    console.error(`${parsed.error}\nRun "claude-code-webview --help" for usage.`);
    return 2;
  }
  const { command } = parsed;
  const about = readAbout();
  switch (command.action) {
    case 'help':
      console.log(usage);
      return 0;
    case 'version':
      console.log(about.version);
      return 0;
    case 'serve':
      return serveHere(command, about);
    case 'background':
      return startInBackground(command);
    case 'stop':
      return stop(command.port);
    case 'restart': {
      const stopped = await stop(command.port);
      return stopped === 0 ? startInBackground(command) : stopped;
    }
    case 'install-shortcut':
      return shortcut(command.startMenu);
    default:
      return exhaustive(command.action);
  }
}

/**
 * @param {import('./args.js').Command} command
 * @param {import('../server/app.js').About} about
 * @returns {Promise<number>}
 */
async function serveHere(command, about) {
  const url = `http://127.0.0.1:${command.port}/`;
  const found = await probe(command.port);
  if (found.kind === 'viewer') {
    console.log(`Already running (process ${found.pid}): ${url}`);
    if (command.open) openBrowser(url);
    return 0;
  }
  if (found.kind === 'other') return portTaken(command.port);
  const server = await serve({ port: command.port, about, palette: command.palette, publicAddresses: command.publicAddresses, herdr: command.herdr, claudeCommand: command.claudeCommand, editor: command.editor?.command });
  if (command.open) openBrowser(server.url);
  console.log('Press Ctrl+C to stop.');
  const shutdown = () => {
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return new Promise(() => {}); // runs until the process is stopped
}

/**
 * The background server is this same command in a separate windowless process; its output goes to the log.
 * @param {import('./args.js').Command} command
 * @returns {Promise<number>}
 */
async function startInBackground(command) {
  const url = `http://127.0.0.1:${command.port}/`;
  const found = await probe(command.port);
  if (found.kind === 'other') return portTaken(command.port);
  if (found.kind === 'free') {
    await mkdir(stateDir, { recursive: true });
    const log = await open(logFile, 'a');
    const publicUrls = command.publicAddresses.flatMap((publicAddress) => ['--public-url', publicAddress.origin]);
    const child = spawn(process.execPath, [binPath, '--port', String(command.port), '--palette', command.palette, ...publicUrls, ...(command.herdr === 'off' ? ['--no-herdr'] : []), '--claude-command', command.claudeCommand, ...(command.editor === undefined ? [] : ['--editor-command', command.editor.text]), '--no-open'], {
      cwd: homedir(),
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log.fd, log.fd],
    });
    child.unref();
    await log.close();
    if (!(await waitUntil(command.port, 'viewer', startTimeoutMs))) {
      const tail = (await readFile(logFile, 'utf8').catch(() => '')).split('\n').slice(-15).join('\n');
      console.error(`The viewer did not start within ${startTimeoutMs / 1000} s. End of ${logFile}:\n${tail}`);
      return 1;
    }
    console.log(`Started in the background: ${url}\nLog: ${logFile}`);
  } else {
    console.log(`Already running (process ${found.pid}): ${url}`);
  }
  if (command.open) openBrowser(url);
  return 0;
}

/**
 * Stops the process that identified itself as the viewer in /api/health; leaves any other process on the port alone.
 * @param {number} port
 * @returns {Promise<number>}
 */
async function stop(port) {
  const found = await probe(port);
  if (found.kind === 'free') {
    console.log('The viewer is not running.');
    return 0;
  }
  if (found.kind === 'other') {
    console.error(`Port ${port} is used by another program, not by the viewer — leaving it alone.`);
    return 1;
  }
  process.kill(found.pid);
  if (!(await waitUntil(port, 'free', 5000))) {
    console.error(`Process ${found.pid} did not stop.`);
    return 1;
  }
  console.log(`Stopped (process ${found.pid}).`);
  return 0;
}

/**
 * @param {boolean} startMenu
 * @returns {Promise<number>}
 */
async function shortcut(startMenu) {
  if (process.platform !== 'win32') {
    console.error('Shortcuts are created on Windows only. Elsewhere run "claude-code-webview --background".');
    return 1;
  }
  if (isTemporaryInstall(binPath)) {
    console.error('This copy runs from the npx cache, which npm may clean up — a shortcut to it would break.\nInstall the package globally and create the shortcut from there:\n  npm install -g claude-code-webview\n  claude-code-webview --install-shortcut');
    return 1;
  }
  const link = await installShortcut({ scriptPath: binPath, iconPath, workingDir: homedir(), folder: startMenu ? 'Programs' : 'Desktop' });
  console.log(`Shortcut created: ${link}`);
  return 0;
}

/**
 * Who is on the port: the viewer (and its pid), nobody, or another program.
 * @param {number} port
 * @returns {Promise<{ kind: 'viewer', pid: number } | { kind: 'free' } | { kind: 'other' }>}
 */
async function probe(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
    const health = await response.json().catch(() => undefined);
    if (response.ok && isRecord(health) && health.name === 'claude-code-webview' && typeof health.pid === 'number') return { kind: 'viewer', pid: health.pid };
    return { kind: 'other' };
  } catch (error) {
    // Connection refused — the port is free; no reply in time — the port is held by something that does not answer.
    return isRefused(error) ? { kind: 'free' } : { kind: 'other' };
  }
}

/** @param {unknown} error */
function isRefused(error) {
  const cause = error instanceof Error && isRecord(error.cause) ? error.cause : {};
  return cause.code === 'ECONNREFUSED';
}

/**
 * @param {number} port
 * @param {'viewer' | 'free'} wanted
 * @param {number} timeoutMs
 */
async function waitUntil(port, wanted, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await probe(port)).kind === wanted) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

/** @param {number} port */
function portTaken(port) {
  console.error(`Port ${port} is used by another program. Choose another one: claude-code-webview --port 7800`);
  return 1;
}

/** @returns {import('../server/app.js').About} */
function readAbout() {
  const json = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const name = isRecord(json) ? text(json.name) : undefined;
  const version = isRecord(json) ? text(json.version) : undefined;
  if (name === undefined || version === undefined) throw new Error('package.json of claude-code-webview has no name or version');
  return { name, version };
}

/**
 * @param {never} value
 * @returns {never}
 */
function exhaustive(value) {
  throw new Error(`Unexpected action ${String(value)}`);
}
