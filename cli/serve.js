// @ts-check
// Starting the viewer server in this process.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/app.js';
import { createBookmarkFile } from '../server/bookmarks.js';
import { createUploads } from '../server/uploads.js';
import { createComposer } from '../server/composer.js';
import { readSessionRecords } from '../server/registry.js';
import { createHerdrRunner, herdrTurnedOff, readSavedHerdr, resolveHerdr, saveHerdr } from '../server/herdr.js';
import { createHerdrView } from '../server/herdr-view.js';
import { createTerminals } from '../server/terminal.js';

/**
 * The viewer's settings and log folder: the remembered herdr (herdr.json), bookmarks of all sessions (bookmarks.json),
 * the herdr workspaces of sessions seen running (workspaces.json), images attached to prompts (uploads/), the background
 * server log (server.log).
 */
export const stateDir = join(homedir(), '.claude-code-webview');

/**
 * The Claude Code folder: CLAUDE_CONFIG_DIR if it was relocated, otherwise ~/.claude.
 * @param {Readonly<Record<string, string | undefined>>} env
 */
export function claudeDir(env) {
  return env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
}

/** @type {Readonly<Record<import('../server/herdr.js').HerdrTarget['source'], string>>} */
const herdrSources = {
  env: 'from this herdr pane (remembered for launches outside herdr)',
  saved: 'remembered from a previous launch inside herdr',
  path: 'from PATH',
};

/** herdr is asked what it shows at most this often: each call starts a process. */
const herdrRefreshMs = 3_000;

/**
 * @param {{ port: number, about: import('../server/app.js').About, palette: import('../public/model/palettes.js').Palette, publicAddresses: readonly import('../server/app.js').PublicAddress[], herdr: 'on' | 'off' }} options
 * @returns {Promise<{ url: string, close: () => void }>}
 */
export async function serve({ port, about, palette, publicAddresses, herdr }) {
  await mkdir(stateDir, { recursive: true });
  const { run, note } = await herdrToUse(herdr);
  const claude = claudeDir(process.env);
  const readRecords = () => readSessionRecords(join(claude, 'sessions'));
  const composer = createComposer({ readRecords, herdr: run });
  const herdrView = createHerdrView({ herdr: run, readRecords, file: join(stateDir, 'workspaces.json'), refreshMs: herdrRefreshMs });
  // A terminal on the page shows the pane's screen within a fifth of a second of typing, and within a second otherwise.
  const terminals = createTerminals({ herdr: run, quickMs: 200, slowMs: 1000, quickForMs: 4000 });
  const server = await startServer({ root: join(claude, 'projects'), host: '127.0.0.1', port, pollMs: 400, composer, bookmarks: createBookmarkFile(join(stateDir, 'bookmarks.json')), uploads: createUploads(join(stateDir, 'uploads')), about, palette, publicAddresses, herdrView, terminals });
  const url = `http://127.0.0.1:${server.port}/`;
  console.log(`Claude Code Webview ${about.version}: ${url}`);
  for (const publicAddress of publicAddresses) console.log(`Also answers at ${publicAddress.origin}/ — keep it behind a login such as Cloudflare Access`);
  console.log(`Sessions: ${join(claude, 'projects')}`);
  console.log(note);
  return { url, close: server.close };
}

/**
 * The herdr the viewer types prompts and finds workspaces through, and the log line about it.
 * @param {'on' | 'off'} use
 * @returns {Promise<{ run: import('../server/composer.js').RunHerdr, note: string }>}
 */
async function herdrToUse(use) {
  if (use === 'off') return { run: herdrTurnedOff, note: 'herdr: off (--no-herdr) — the viewer only reads sessions.' };
  const herdrFile = join(stateDir, 'herdr.json');
  const herdr = resolveHerdr(process.env, await readSavedHerdr(herdrFile));
  if (herdr.source === 'env' && herdr.socketPath !== undefined) await saveHerdr(herdrFile, { binPath: herdr.bin, socketPath: herdr.socketPath });
  return { run: createHerdrRunner(herdr), note: `herdr: ${herdr.bin} — ${herdrSources[herdr.source]}. Without herdr the viewer only reads sessions.` };
}

/** @param {string} url */
export function openBrowser(url) {
  const [command, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true })
    .on('error', () => console.log(`Open ${url} in your browser.`))
    .unref();
}
