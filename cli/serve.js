// @ts-check
// Starting the viewer server in this process.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createVsCode } from '../server/vscode.js';
import { startServer } from '../server/app.js';
import { createBookmarkFile } from '../server/bookmarks.js';
import { createSeenFile } from '../server/seen.js';
import { createUploads } from '../server/uploads.js';
import { createComposer } from '../server/composer.js';
import { latestRecords, readSessionRecords } from '../server/registry.js';
import { createHerdrRunner, herdrTurnedOff, paneIoOf, readSavedHerdr, resolveHerdr, saveHerdr } from '../server/herdr.js';
import { createHerdrSocket, socketRunner } from '../server/herdr-socket.js';
import { createHerdrView } from '../server/herdr-view.js';
import { createCodexThreads, lockHeld } from '../server/codex-live.js';
import { createSessionIndex } from '../server/sessions.js';
import { createTerminals } from '../server/terminal.js';
import { readUsage } from '../server/usage.js';
import { openInEditor } from '../server/editor.js';

/**
 * The viewer's settings and log folder: the remembered herdr (herdr.json), bookmarks of all sessions (bookmarks.json),
 * the herdr workspaces of sessions seen running (workspaces.json), images attached to prompts (uploads/), the background
 * server log (server.log), the account's usage a statusline drops in (rate-limits.json, see the README).
 */
export const stateDir = join(homedir(), '.claude-code-webview');

/**
 * The Claude Code folder: CLAUDE_CONFIG_DIR if it was relocated, otherwise ~/.claude.
 * @param {Readonly<Record<string, string | undefined>>} env
 */
export function claudeDir(env) {
  return env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
}

/**
 * Claude Code's own state, its reading of the account's usage among it: .claude.json beside the relocated folder,
 * otherwise in the home folder.
 * @param {Readonly<Record<string, string | undefined>>} env
 */
function claudeStateFile(env) {
  return join(env.CLAUDE_CONFIG_DIR ?? homedir(), '.claude.json');
}

/** @type {Readonly<Record<import('../server/herdr.js').HerdrTarget['source'], string>>} */
const herdrSources = {
  env: 'from this herdr pane (remembered for launches outside herdr)',
  saved: 'remembered from a previous launch inside herdr',
  path: 'from PATH',
};

/** herdr is asked what it shows at most this often: each call starts a process. */
const herdrRefreshMs = 3_000;
/** Claude Code started from the page is watched this long for the question whether to trust its folder: 30 s. */
const claudeTrustPace = { looks: 60, stepMs: 500 };

/**
 * @param {{ port: number, about: import('../server/app.js').About, palette: import('../public/model/palettes.js').Palette, publicAddresses: readonly import('../server/app.js').PublicAddress[], herdr: 'on' | 'off', claudeCommand: string, codexCommand: string, editor: import('../server/editor.js').EditorCommand | undefined, vscode: string | undefined }} options
 * @returns {Promise<{ url: string, close: () => void }>}
 */
export async function serve({ port, about, palette, publicAddresses, herdr, claudeCommand, codexCommand, editor, vscode }) {
  await mkdir(stateDir, { recursive: true });
  const { run, via, note } = await herdrToUse(herdr);
  const claude = claudeDir(process.env);
  const readRecords = () => readSessionRecords(join(claude, 'sessions'));
  const usageFiles = { claudeState: claudeStateFile(process.env), rateLimits: join(stateDir, 'rate-limits.json') };
  // Codex's sessions beside Claude Code's: none while it has never run here
  const codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex');
  const index = createSessionIndex(join(claude, 'projects'), { summaryBudgetMs: 1500, missRetryMs: 2000, codexRoot: join(codexHome, 'sessions') });
  const codexThreads = createCodexThreads({ home: codexHome, summaryOf: index.summaryOf, held: lockHeld });
  const herdrView = createHerdrView({ herdr: run, readRecords, codexThreads: codexThreads.open, file: join(stateDir, 'workspaces.json'), refreshMs: herdrRefreshMs, trust: claudeTrustPace, claudeCommand, codexCommand });
  const composer = createComposer({ readRecords, herdr: run, codexPlace: herdrView.codexPlace });
  // A terminal on the page: through herdr's socket a screen is read in a millisecond or two, so it is read every 40 ms
  // while typing; through the herdr program every call starts a process, a tenth of a second.
  const terminals = createTerminals({ io: paneIoOf(run), quickMs: via === 'socket' ? 40 : 200, slowMs: via === 'socket' ? 500 : 1000, quickForMs: 4000 });
  // VS Code in the browser, its token kept beside the viewer's other files — named by the port: another viewer on this
  // computer has a VS Code of its own
  const vscodeServer = vscode === undefined ? undefined : createVsCode({ command: [vscode], tokenFile: join(stateDir, `vscode-token-${port}`) });
  const server = await startServer({ index, host: '127.0.0.1', port, pollMs: 400, composer, bookmarks: createBookmarkFile(join(stateDir, 'bookmarks.json')), seen: createSeenFile(join(stateDir, 'seen.json'), { limit: 500 }), uploads: createUploads(join(stateDir, 'uploads')), about, palette, publicAddresses, herdrView, terminals, usage: () => readUsage(usageFiles), isRunning: async (id) => latestRecords(await readRecords()).has(id), editor: editor === undefined ? undefined : (path, line) => openInEditor(editor, path, line), vscode: vscodeServer, codexInUse: async () => (await codexThreads.open()).length > 0 });
  const url = `http://127.0.0.1:${server.port}/`;
  console.log(`Claude Code Webview ${about.version}: ${url}`);
  for (const publicAddress of publicAddresses) console.log(`Also answers at ${publicAddress.origin}/ — keep it behind a login such as Cloudflare Access`);
  console.log(`Sessions: ${join(claude, 'projects')}`);
  console.log(note);
  if (vscode !== undefined) console.log(`VS Code: ${vscode} — in the browser at ${url}vscode/ once a page asks for it.`);
  return {
    url,
    close: () => {
      vscodeServer?.close();
      server.close();
    },
  };
}

/**
 * The herdr the viewer types prompts and finds workspaces through, and the log line about it.
 * @param {'on' | 'off'} use
 * @returns {Promise<{ run: import('../server/composer.js').RunHerdr, via: 'socket' | 'program', note: string }>} — via: how
 *   herdr is reached: its socket, when known — a millisecond or two a call — or its program, a tenth of a second
 */
async function herdrToUse(use) {
  if (use === 'off') return { run: herdrTurnedOff, via: 'program', note: 'herdr: off (--no-herdr) — the viewer only reads sessions.' };
  const herdrFile = join(stateDir, 'herdr.json');
  const herdr = resolveHerdr(process.env, await readSavedHerdr(herdrFile));
  if (herdr.source === 'env' && herdr.socketPath !== undefined) await saveHerdr(herdrFile, { binPath: herdr.bin, socketPath: herdr.socketPath });
  const program = createHerdrRunner(herdr);
  const note = `herdr: ${herdr.bin} — ${herdrSources[herdr.source]}. Without herdr the viewer only reads sessions.`;
  if (herdr.socketPath === undefined) return { run: program, via: 'program', note };
  return { run: socketRunner(createHerdrSocket(herdr.socketPath), program), via: 'socket', note: `${note} Talks to it through its socket.` };
}

/** @param {string} url */
export function openBrowser(url) {
  const [command, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true })
    .on('error', () => console.log(`Open ${url} in your browser.`))
    .unref();
}
