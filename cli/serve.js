// @ts-check
// Starting the viewer server in this process.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/app.js';
import { createBookmarkFile } from '../server/bookmarks.js';
import { createUploads } from '../server/uploads.js';
import { createComposer, readSessionRecords } from '../server/composer.js';
import { createHerdrRunner, readSavedHerdr, resolveHerdr, saveHerdr } from '../server/herdr.js';

/**
 * The viewer's settings and log folder: the remembered herdr (herdr.json), bookmarks of all sessions (bookmarks.json),
 * images attached to prompts (uploads/), the background server log (server.log).
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

/**
 * @param {{ port: number, about: import('../server/app.js').About, palette: import('../public/model/palettes.js').Palette, publicAddresses: readonly import('../server/app.js').PublicAddress[] }} options
 * @returns {Promise<{ url: string, close: () => void }>}
 */
export async function serve({ port, about, palette, publicAddresses }) {
  await mkdir(stateDir, { recursive: true });
  const herdrFile = join(stateDir, 'herdr.json');
  const herdr = resolveHerdr(process.env, await readSavedHerdr(herdrFile));
  if (herdr.source === 'env' && herdr.socketPath !== undefined) await saveHerdr(herdrFile, { binPath: herdr.bin, socketPath: herdr.socketPath });
  const claude = claudeDir(process.env);
  const composer = createComposer({ readRecords: () => readSessionRecords(join(claude, 'sessions')), herdr: createHerdrRunner(herdr) });
  const server = await startServer({ root: join(claude, 'projects'), host: '127.0.0.1', port, pollMs: 400, composer, bookmarks: createBookmarkFile(join(stateDir, 'bookmarks.json')), uploads: createUploads(join(stateDir, 'uploads')), about, palette, publicAddresses });
  const url = `http://127.0.0.1:${server.port}/`;
  console.log(`Claude Code Webview ${about.version}: ${url}`);
  for (const publicAddress of publicAddresses) console.log(`Also answers at ${publicAddress.origin}/ — keep it behind a login such as Cloudflare Access`);
  console.log(`Sessions: ${join(claude, 'projects')}`);
  console.log(`herdr: ${herdr.bin} — ${herdrSources[herdr.source]}. Without herdr the viewer works read-only.`);
  return { url, close: server.close };
}

/** @param {string} url */
export function openBrowser(url) {
  const [command, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true })
    .on('error', () => console.log(`Open ${url} in your browser.`))
    .unref();
}
