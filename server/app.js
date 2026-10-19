// @ts-check
// The viewer's HTTP server: static files, the session list, the stream of transcript entries.
// Transcripts contain everything the agent saw, secrets included, so the server listens only on a local address
// and answers only requests whose Host is that address: a page from another site cannot read it via DNS rebinding.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { homedir } from 'node:os';
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { constants as zlibConstants, createGzip, gzip } from 'node:zlib';
import { withAttachedImages } from '../public/model/attachments.js';
import { parseBookmarkChange } from '../public/model/bookmarks.js';
import { iconValue, parseIcon } from '../public/model/icon-choice.js';
import { isRecord, text } from '../public/model/narrow.js';
import { takenBackPrompt } from './branch.js';
import { branchChanges, branchFileDiff } from './branch-changes.js';
import { createCodexReading } from './codex.js';
import { readCodexUsage } from './codex-usage.js';
import { openJoined } from './joined.js';
import { parseSteps } from '../public/model/dialog.js';
import { vscodeFileAddress } from '../public/model/vscode.js';
import { assetFile, folderFileAt, sandboxPolicy } from 'file-views/server';
import { editorImports, editorModuleFile, editorModuleFiles, editorModulesPrefix } from './editor-modules.js';
import { createFileIcons, fileIconAnswer, fileIconsManifest, fileIconsPrefix } from './file-icons.js';
import { readImageFile, readTextFile, saveTextFile } from './files.js';
import { fileLinks } from './links.js';
import { listFolder, searchProject, searchTimeoutMs } from './project.js';
import { readBranch, workTreeOf } from './git.js';
import { readImage } from './images.js';
import { rewindTarget } from './rewind.js';
import { createSessionIndex } from './sessions.js';
import { slimEntry } from './slim.js';
import { createFeedPages } from './feeds.js';
import { openingPart, streamTranscript } from './stream.js';
import { readLineAt } from './tail.js';
import { createTranscriptCache } from './transcript-cache.js';
import { readTaskOutput, seenTasks } from './tasks.js';
import { parseImages } from './uploads.js';
import { vscodeBasePath } from './vscode.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

/**
 * Third-party modules for the browser: URL → ES build file. Node finds the path by its module resolution rules:
 * when installed as a package (npx, npm i -g), dependencies live one level up, not in our own node_modules.
 */
const vendor = new Map([
  ['/vendor/marked.js', fileURLToPath(import.meta.resolve('marked'))],
  ['/vendor/purify.js', fileURLToPath(import.meta.resolve('dompurify'))],
  ['/vendor/highlight.js', fileURLToPath(import.meta.resolve('@highlightjs/cdn-assets/es/highlight.min.js'))],
  // the ES module: the package's main file is the CommonJS one, which a browser cannot import from
  ['/vendor/xterm.js', fileURLToPath(import.meta.resolve('@xterm/xterm/lib/xterm.mjs'))],
  ['/vendor/xterm.css', fileURLToPath(import.meta.resolve('@xterm/xterm/css/xterm.css'))],
  // the icon picker's full choice of emoji: the picker, the database module it imports beside it, the emoji's data
  ['/vendor/emoji-picker/picker.js', fileURLToPath(import.meta.resolve('emoji-picker-element/picker.js'))],
  ['/vendor/emoji-picker/database.js', fileURLToPath(import.meta.resolve('emoji-picker-element/database.js'))],
  ['/vendor/emoji-picker/data.json', fileURLToPath(import.meta.resolve('emoji-picker-element-data/en/emojibase/data.json'))],
  // Lucide's icons for a workspace's: the sprite they are drawn from, the words they are found by
  ['/vendor/lucide/sprite.svg', fileURLToPath(import.meta.resolve('lucide-static/sprite.svg'))],
  ['/vendor/lucide/tags.json', fileURLToPath(import.meta.resolve('lucide-static/tags.json'))],
]);

/** The file panel's views (file-views): the bundle, its styles, and what they load as they go — pdf.js, mermaid. */
const fileViewsPrefix = '/vendor/file-views/';

/**
 * @param {string} pathname
 * @returns {string | undefined}
 */
function fileViewsFile(pathname) {
  return pathname.startsWith(fileViewsPrefix) ? assetFile(decodeURIComponent(pathname.slice(fileViewsPrefix.length))) : undefined;
}

/**
 * @param {string} pathname
 * @returns {string | undefined}
 */
function editorFile(pathname) {
  return pathname.startsWith(editorModulesPrefix) ? editorModuleFile(decodeURIComponent(pathname.slice(editorModulesPrefix.length))) : undefined;
}

/** @type {Readonly<Record<string, string>>} */
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  // compiled as it streams in only with its own type: pdf.js's decoders
  '.wasm': 'application/wasm',
};

const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const agentIdPattern = /^[0-9a-z]{1,64}$/i;
/** herdr's pane ids: w2:p1, w3D:pK */
const paneIdPattern = /^[\w:-]{1,40}$/;

/**
 * @typedef {{ liveState: (sessionId: string) => Promise<import('./composer.js').LiveState>, send: (sessionId: string, text: string) => Promise<import('./composer.js').SendOutcome>, sendNow: (sessionId: string, text: string) => Promise<import('./composer.js').SendOutcome>, interrupt: (sessionId: string) => Promise<import('./composer.js').StopReply>, rewind: (sessionId: string, request: import('./composer.js').RewindRequest) => Promise<import('./composer.js').RewindReply>, btw: (sessionId: string, question: string) => Promise<import('./composer.js').BtwReply>, answer: (sessionId: string, steps: readonly import('../public/model/dialog.js').DialogStep[]) => Promise<import('../public/model/dialog.js').DialogReply> }} Composer
 * @typedef {{ name: string, version: string }} About
 * @typedef {() => Promise<import('../public/model/usage.js').Usage | undefined>} ReadUsage — none until Claude Code has read it
 * @typedef {(sessionId: string) => Promise<import('../public/model/session-status.js').SessionStatus | undefined>} ReadSessionStatus
 * @typedef {(sessionId: string) => Promise<boolean>} IsRunning
 * @typedef {(path: string, line: number) => Promise<import('./editor.js').EditorOutcome>} OpenEditor
 * @typedef {(session: { agent: 'claude' | 'codex', cwd: string | undefined }) => Promise<readonly import('./commands.js').SlashCommand[]>} SessionCommands —
 *   what a session's "/" offers, by its agent, in its folder
 * @typedef {(target: import('./file-manager.js').FileManagerTarget) => Promise<boolean>} OpenFileManager — a folder
 *   opened in the computer's file manager, or a file shown in its folder; whether it started
 * @typedef {ReturnType<typeof import('./seen.js').createSeenFile>} Seen
 */

/**
 * @param {{ index: SessionIndex, host: string, port: number, pollMs: number, composer: Composer, bookmarks: import('./bookmarks.js').Bookmarks, seen: Seen, uploads: Uploads, about: About, palette: import('../public/model/palettes.js').Palette, publicAddresses: readonly PublicAddress[], herdrView: HerdrView, terminals: Terminals, usage: ReadUsage, chatgptUsage?: ReadUsage, sessionStatus?: ReadSessionStatus, isRunning: IsRunning, editor: OpenEditor | undefined, fileManager: OpenFileManager, commands: SessionCommands, vscode?: import('./vscode.js').VsCode | undefined, codexInUse: () => Promise<boolean> }} options
 *   about — package name and version for /api/health; palette — the page's colours (public/model/palettes.js);
 *   publicAddresses — where else the page is opened at, answered as the local address is; herdrView — what herdr
 *   shows (herdr-view.js); terminals — herdr panes' terminals (terminal.js); usage — the account's usage (usage.js);
 *   isRunning — whether Claude Code has a session open; editor — opens a file at a line in the editor of this computer,
 *   if the viewer was given one; seen — the answers seen, for every device (seen.js); codexInUse — whether Codex has a
 *   thread open (codex-live.js)
 * @returns {Promise<{ port: number, close: () => void }>}
 */
export async function startServer({ index, host, port, pollMs, composer, bookmarks, seen, uploads, about, palette, publicAddresses, herdrView, terminals, usage, chatgptUsage = async () => undefined, sessionStatus = async () => undefined, isRunning, editor, fileManager, commands, vscode, codexInUse }) {
  const instance = randomUUID();
  const build = await pageBuild();
  /** Sessions this page rewound: session id → the prompt rewound to; its branch is hidden before the next prompt shows the fork. */
  /** @type {Map<string, string>} */
  const rewinds = new Map();
  const transcripts = createTranscriptCache({ maxFiles: cachedTranscripts, agentOf: index.agentOf, partsOf: index.partsOf });
  /** @type {Set<string>} */
  const allowedHosts = new Set();
  /** @type {Set<string>} */
  const allowedOrigins = new Set();
  const fileIcons = createFileIcons();
  /** @type {Deps} */
  const deps = { index, allowedHosts, allowedOrigins, pollMs, composer, bookmarks, seen, codexInUse, uploads, about, build, rewinds, transcripts, feeds: createFeedPages(), palette, herdrView, terminals, usage, chatgptUsage, sessionStatus, isRunning, editor, fileManager, commands, vscode, instance, fileIcons };
  const server = http.createServer((request, response) => {
    handle(deps, request, response).catch((error) => {
      console.error(`${request.method} ${request.url} failed`, error);
      if (!response.headersSent) response.writeHead(500).end();
      else response.end();
    });
  });
  // a WebSocket is VS Code's only: the viewer's own streams are server-sent events
  server.on('upgrade', (request, socket, head) => {
    upgradeToVsCode(deps, request, socket, head).catch(() => socket.destroy());
  });
  await new Promise((done) => server.listen(port, host, () => done(undefined)));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error(`Unexpected server address ${String(address)}`);
  for (const name of ['127.0.0.1', 'localhost', '[::1]', host]) {
    allowedHosts.add(`${name}:${address.port}`);
    allowedOrigins.add(`http://${name}:${address.port}`);
  }
  for (const publicAddress of publicAddresses) {
    allowedHosts.add(publicAddress.host);
    allowedOrigins.add(publicAddress.origin);
  }
  return {
    port: address.port,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

/**
 * @typedef {ReturnType<typeof createSessionIndex>} SessionIndex — Claude Code's sessions and Codex's (sessions.js)
 * @typedef {{ index: SessionIndex, allowedHosts: ReadonlySet<string>, allowedOrigins: ReadonlySet<string>, pollMs: number, composer: Composer, bookmarks: import('./bookmarks.js').Bookmarks, uploads: Uploads, about: About, build: string, rewinds: Map<string, string>, transcripts: import('./stream.js').TranscriptCache, feeds: ReturnType<typeof createFeedPages>, palette: import('../public/model/palettes.js').Palette, herdrView: HerdrView, terminals: Terminals, usage: ReadUsage, chatgptUsage: ReadUsage, sessionStatus: ReadSessionStatus, isRunning: IsRunning, editor: OpenEditor | undefined, fileManager: OpenFileManager, commands: SessionCommands, vscode: import('./vscode.js').VsCode | undefined, instance: string, fileIcons: ReturnType<typeof createFileIcons>, seen: Seen, codexInUse: () => Promise<boolean> }} Deps
 *   instance: this run of the viewer, told apart from any other — see /api/machine; vscode: VS Code's web server
 *   behind /vscode/, none when the viewer runs none
 * @typedef {Pick<ReturnType<typeof import('./herdr-view.js').createHerdrView>, 'workspacesOf' | 'layout' | 'renameTab' | 'closeTab' | 'moveTab' | 'renameWorkspace' | 'closeWorkspace' | 'setWorkspaceIcon' | 'hidePane' | 'showHidden' | 'createTab' | 'duplicateTab' | 'createWorkspace' | 'history' | 'reopen'>} HerdrView
 * @typedef {Pick<ReturnType<typeof import('./terminal.js').createTerminals>, 'stream' | 'type'>} Terminals
 * @typedef {ReturnType<typeof import('./uploads.js').createUploads>} Uploads
 * @typedef {{ origin: string, host: string }} PublicAddress — where the page is opened from outside, behind a tunnel:
 *   origin https://viewer.example.com, host viewer.example.com
 */

/**
 * @param {Deps} deps
 * @param {http.IncomingMessage} request
 * @param {http.ServerResponse} response
 */
async function handle(deps, request, response) {
  if (!deps.allowedHosts.has(request.headers.host ?? '')) {
    response.writeHead(403).end('Forbidden host');
    return;
  }
  // An open page compares this with the build it was loaded from and offers to reload after an update.
  response.setHeader('X-Viewer-Build', deps.build);
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (isVsCodePath(url.pathname)) return passToVsCode(deps, request, response);
  if (request.method === 'POST') return handleWrite(deps, url, request, response);
  if (request.method !== 'GET') {
    response.writeHead(405).end();
    return;
  }
  if (url.pathname.startsWith('/api/upload/')) return sendUpload(deps, decodeURIComponent(url.pathname.slice('/api/upload/'.length)), response);
  switch (url.pathname) {
    case '/api/health':
      // This reply tells the CLI that the port is held by the viewer itself, and which process to stop.
      return sendJson(response, { ...deps.about, pid: process.pid });
    case '/api/live':
      return withSession(url, response, async (id) => sendJson(response, await deps.composer.liveState(id)));
    case '/api/sessions': {
      // ?since=<version from the last reply> — only what changed since; an empty version — everything, with a version.
      const since = url.searchParams.get('since');
      if (since === null) return sendJson(response, await deps.index.list());
      const version = Number(since);
      return sendJson(response, await deps.index.changes(since === '' || !Number.isFinite(version) ? undefined : version));
    }
    // what the session's "/" offers: its agent's commands, the skills in its folder
    case '/api/commands':
      return withSession(url, response, async (id) => {
        const session = (await deps.index.list()).find((one) => one.id === id);
        return sendJson(response, await deps.commands({ agent: session?.agent ?? 'claude', cwd: session?.cwd }));
      });
    case '/api/branch':
      // The branch checked out in the session's folder now, for the header.
      return withSession(url, response, async (id) => {
        const cwd = await sessionFolder(deps, id);
        return sendJson(response, { branch: cwd === undefined ? undefined : await readBranch(cwd) });
      });
    case '/api/changes':
      // What the branch checked out in the session's folder changed since it was made: its commits and files, what is
      // not committed yet too; ?base= — a branch to compare with instead
      return withSession(url, response, async (id) => {
        const cwd = await sessionFolder(deps, id);
        const base = url.searchParams.get('base') || undefined;
        return sendJson(response, cwd === undefined ? { ok: false, error: 'not-a-repository' } : await branchChanges(cwd, { base }));
      });
    case '/api/changes/file':
      // One changed file's diff since the base the page was given
      return withSession(url, response, async (id) => {
        const file = changedFileOf(url);
        if (file === undefined) {
          response.writeHead(400).end('Bad file or base');
          return;
        }
        const cwd = await sessionFolder(deps, id);
        return sendJson(response, cwd === undefined ? { ok: false, error: 'not-a-repository' } : await branchFileDiff(cwd, file));
      });
    // The page asks about herdr every few seconds: an unchanged reply goes without its body.
    case '/api/workspaces':
      return sendRevalidated(response, await deps.herdrView.workspacesOf(await deps.index.list()));
    case '/api/herdr':
      return sendRevalidated(response, await deps.herdrView.layout());
    // the answers seen on any device: the green lamps out on every one
    case '/api/seen':
      return sendRevalidated(response, await deps.seen.all());
    // Where sessions ran in herdr, closed ones included: the session list finds them by workspace and tab.
    case '/api/machine':
      return sendMachine(deps, request, response);
    case '/api/tasks':
      return withSession(url, response, async (id) => sendTasks(deps, id, response));
    case '/api/tasks/output':
      return withSession(url, response, async (id) => sendTaskOutput(deps, url, id, response));
    case '/api/usage':
      return sendJson(response, (await deps.usage()) ?? {});
    // Codex's, as its transcripts tell it, while it is in use: with nothing of Codex's open, the page shows Claude's alone
    case '/api/usage/codex': {
      const readings = await Promise.all([deps.chatgptUsage(), (await deps.codexInUse()) ? readCodexUsage(deps.index) : undefined]);
      const latest = readings.filter((reading) => reading !== undefined).toSorted((one, other) => other.readAt - one.readAt)[0];
      return sendJson(response, latest ?? {});
    }
    case '/api/history':
      return sendRevalidated(response, await deps.herdrView.history());
    case '/api/pane/stream':
      return streamPane(deps, url, request, response);
    case '/api/subagents':
      return withSession(url, response, async (id) => sendJson(response, await deps.index.subagents(id)));
    case '/api/bookmarks':
      return withSession(url, response, async (id) => sendJson(response, await deps.bookmarks.list(id)));
    case '/api/stream':
      return withSession(url, response, async (id) => stream(deps, url, id, request, response));
    case '/api/feeds':
      return feedsStream(deps, url, request, response);
    case '/api/file':
      return sendFile(url, response);
    case '/api/vscode/open':
      return openInVsCode(deps, request, url, response);
    case '/api/file/image':
      return sendFileImage(url, response);
    case '/api/dir':
      return sendFolder(url, response);
    case '/api/search':
      return sendSearch(url, response);
    case '/api/links':
      return sendLinks(url, response);
    case '/api/image':
      return withSession(url, response, async (id) => sendImage(deps, url, id, response));
    case '/api/entry':
      return withSession(url, response, async (id) => sendEntry(deps, url, id, response));
    case '/api/snapshot':
      return withSession(url, response, async (id) => sendSnapshot(deps, url, id, response));
    default:
      if (url.pathname.startsWith(folderPrefix)) return sendFolderFile(url, response);
      return servePage(deps, url.pathname, response);
  }
}

/** @param {string} pathname */
function isVsCodePath(pathname) {
  return pathname === vscodeBasePath || pathname.startsWith(`${vscodeBasePath}/`);
}

/**
 * Whether a request to VS Code comes from a page of the viewer — VS Code's own included — not from another site in the
 * browser: VS Code would read and write any file for it. A browser tells the site a request comes from (Sec-Fetch-Site:
 * a link followed, an address typed — "none") and the origin of what it sends; a program that is no browser tells
 * neither, and is no other site's page.
 * @param {Deps} deps
 * @param {http.IncomingMessage} request
 * @param {'request' | 'socket'} kind — a WebSocket is sent by a page always, with its origin
 */
function fromViewerPages(deps, request, kind) {
  const site = request.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return false;
  const origin = request.headers.origin;
  if (origin === undefined) return kind === 'request';
  return deps.allowedOrigins.has(origin);
}

/**
 * A request's headers as VS Code's server is to get them: to its own address, from its own page, with its token.
 * @param {http.IncomingHttpHeaders} headers
 * @param {import('./vscode.js').VsCodeTarget} target
 * @returns {http.OutgoingHttpHeaders}
 */
function vscodeHeaders(headers, target) {
  const own = `127.0.0.1:${target.port}`;
  const cookies = (headers.cookie ?? '')
    .split(';')
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie !== '' && !cookie.startsWith('vscode-tkn='));
  // VS Code's page connects where the browser reached the viewer, not to VS Code's own address, which a browser
  // elsewhere cannot reach
  const authority = pageAuthority(headers);
  return {
    ...headers,
    host: own,
    ...(authority === undefined ? {} : { 'x-forwarded-host': authority }),
    ...(headers.origin === undefined ? {} : { origin: `http://${own}` }),
    cookie: [...cookies, `vscode-tkn=${target.token}`].join('; '),
  };
}

/**
 * Where the browser reached the viewer — or the public address a gate in front of it names: the address VS Code's page
 * is reached at, which names the files of its server too.
 * @param {http.IncomingHttpHeaders} headers
 * @returns {string | undefined}
 */
function pageAuthority(headers) {
  const forwarded = headers['x-forwarded-host'];
  return typeof forwarded === 'string' ? forwarded : headers.host;
}

/**
 * A file opened in VS Code in the browser at its project's folder — the nearest above it with git's .git, else its own
 * — at its line: the browser sent on to VS Code's address for it.
 * @param {Deps} deps
 * @param {http.IncomingMessage} request
 * @param {URL} url — ?path=<the file>&line=<n>
 * @param {http.ServerResponse} response
 */
async function openInVsCode(deps, request, url, response) {
  if (deps.vscode === undefined) return void response.writeHead(404).end('The viewer runs no VS Code: start it with --vscode');
  const authority = pageAuthority(request.headers);
  if (authority === undefined) return void response.writeHead(400).end('No host');
  const path = url.searchParams.get('path') ?? '';
  if ((await kindAt(path)) !== 'file') return void response.writeHead(404).end('No such file');
  const lineText = url.searchParams.get('line') ?? '';
  const line = /^[1-9]\d*$/.test(lineText) ? Number(lineText) : undefined;
  response.writeHead(302, { Location: vscodeFileAddress({ folder: await projectFolderOf(path), path, line, authority }) }).end();
}

/**
 * The computer's own VS Code opened, for a browser on this computer: at a session's folder, or at a file's project
 * with the file gone to at its line.
 * @param {Deps} deps
 * @param {unknown} body — { folder } or { path, line }
 * @param {http.ServerResponse} response
 */
async function openDesktopVsCode(deps, body, response) {
  const folder = isRecord(body) ? text(body.folder) : undefined;
  const path = isRecord(body) ? text(body.path) : undefined;
  const line = isRecord(body) && typeof body.line === 'number' && Number.isInteger(body.line) && body.line >= 1 ? body.line : undefined;
  if (deps.vscode === undefined) return sendJson(response, { ok: false, error: 'no-vscode' });
  const vscode = deps.vscode;
  /** @param {boolean} started */
  const told = (started) => sendJson(response, started ? { ok: true } : { ok: false, error: 'not-started' });
  const notThere = { ok: false, error: 'not-there' };
  if (folder !== undefined) return (await kindAt(folder)) === 'folder' ? told(await vscode.openDesktop(folder, undefined)) : sendJson(response, notThere);
  if (path === undefined) return void response.writeHead(400).end('Bad folder or file');
  return (await kindAt(path)) === 'file' ? told(await vscode.openDesktop(await projectFolderOf(path), { path, line })) : sendJson(response, notThere);
}

/**
 * A folder opened in the computer's file manager, for a browser on this computer — a session's — or a file shown there
 * in its folder.
 * @param {Deps} deps
 * @param {unknown} body — { folder } or { path }
 * @param {http.ServerResponse} response
 */
async function openFileManager(deps, body, response) {
  const folder = isRecord(body) ? text(body.folder) : undefined;
  const path = isRecord(body) ? text(body.path) : undefined;
  /** @type {import('./file-manager.js').FileManagerTarget | undefined} */
  let target;
  if (folder !== undefined) target = (await kindAt(folder)) === 'folder' ? { folder } : undefined;
  else if (path !== undefined) target = (await kindAt(path)) === 'file' ? { path } : undefined;
  else return void response.writeHead(400).end('Bad folder or file');
  if (target === undefined) return sendJson(response, { ok: false, error: 'not-there' });
  return sendJson(response, (await deps.fileManager(target)) ? { ok: true } : { ok: false, error: 'not-started' });
}

/**
 * The folder VS Code is opened at for a file: its project — the nearest above it with git's .git, a worktree's own —
 * else the file's own folder.
 * @param {string} path
 */
async function projectFolderOf(path) {
  return (await workTreeOf(dirname(path))) ?? dirname(path);
}

/**
 * What an absolute path names: a file, a folder, or nothing there.
 * @param {string} path
 * @returns {Promise<'file' | 'folder' | undefined>}
 */
async function kindAt(path) {
  if (!isAbsolute(path)) return undefined;
  const found = await stat(path).catch(() => undefined);
  return found?.isFile() ? 'file' : found?.isDirectory() ? 'folder' : undefined;
}

/**
 * A request under /vscode/ passed on to VS Code's server, and its answer back.
 * @param {Deps} deps
 * @param {http.IncomingMessage} request
 * @param {http.ServerResponse} response
 */
async function passToVsCode(deps, request, response) {
  if (deps.vscode === undefined) {
    response.writeHead(404).end('The viewer runs no VS Code: start it with --vscode');
    return;
  }
  if (!fromViewerPages(deps, request, 'request')) {
    response.writeHead(403).end('Forbidden: VS Code is reached from the viewer only');
    return;
  }
  const target = await deps.vscode.target();
  if (target === undefined) {
    response.writeHead(503).end('VS Code did not start');
    return;
  }
  const upstream = http.request({ host: '127.0.0.1', port: target.port, method: request.method, path: request.url, headers: vscodeHeaders(request.headers, target) }, (reply) => {
    response.writeHead(reply.statusCode ?? 502, reply.headers);
    reply.pipe(response);
  });
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502).end('VS Code did not answer');
    else response.end();
  });
  request.pipe(upstream);
}

/**
 * A WebSocket to VS Code's server — its page's connection to it — passed through as it is, once asked for from a page
 * of the viewer; any other upgrade is refused.
 * @param {Deps} deps
 * @param {http.IncomingMessage} request
 * @param {import('node:stream').Duplex} socket
 * @param {Buffer} head
 */
async function upgradeToVsCode(deps, request, socket, head) {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const allowed = deps.allowedHosts.has(request.headers.host ?? '') && isVsCodePath(path) && deps.vscode !== undefined && fromViewerPages(deps, request, 'socket');
  const target = allowed && deps.vscode !== undefined ? await deps.vscode.target() : undefined;
  if (target === undefined) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  const upstream = net.connect(target.port, '127.0.0.1', () => {
    const lines = Object.entries(vscodeHeaders(request.headers, target)).flatMap(([name, value]) => (value === undefined ? [] : (Array.isArray(value) ? value : [String(value)]).map((one) => `${name}: ${one}`)));
    upstream.write(`${request.method} ${request.url} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`);
    if (head.length > 0) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  // either side ended or gone — a tab closed, the server stopped — takes the other along: an upgraded socket stays
  // half-open after its end, and a pipe passes the end on without closing anything
  const takes = (/** @type {import('node:stream').Duplex} */ one, /** @type {import('node:stream').Duplex} */ other) => {
    one.on('end', () => other.destroy());
    one.on('close', () => other.destroy());
  };
  takes(upstream, socket);
  takes(socket, upstream);
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
}

/**
 * Writes — text to a session's terminal, bookmark changes — come only from the viewer's own page: sessions run
 * with permission to execute commands. So the request is accepted only from that page:
 * Origin is our address, the body is JSON, and the X-Viewer header is present. A form or fetch from another
 * site cannot send such a request without a CORS preflight, and the server does not allow CORS.
 * @param {Deps} deps
 * @param {URL} url
 * @param {http.IncomingMessage} request
 * @param {http.ServerResponse} response
 */
async function handleWrite(deps, url, request, response) {
  const fromViewer =
    deps.allowedOrigins.has(request.headers.origin ?? '') &&
    (request.headers['content-type'] ?? '').startsWith('application/json') &&
    request.headers['x-viewer'] === '1';
  if (!fromViewer) {
    response.writeHead(403).end('Forbidden: request did not come from the viewer page');
    return;
  }
  const body = await readJsonBody(request, url.pathname === '/api/send' ? maxSendBytes : url.pathname === '/api/file/save' ? maxSaveBytes : maxBodyBytes);
  if (url.pathname === '/api/file/save') return saveFile(body, response);
  if (url.pathname === '/api/seen') return markSeen(deps, body, response);
  if (url.pathname === '/api/pane/input') return typeIntoPane(deps, body, response);
  if (url.pathname === '/api/tab/rename') return renameTab(deps, body, response);
  if (url.pathname === '/api/tab/close') return closeTab(deps, body, response);
  if (url.pathname === '/api/tab/move') return moveTab(deps, body, response);
  if (url.pathname === '/api/tab/new') return newTab(deps, body, response);
  if (url.pathname === '/api/tab/duplicate') return duplicateTab(deps, body, response);
  if (url.pathname === '/api/workspace/new') return newWorkspace(deps, body, response);
  if (url.pathname === '/api/workspace/rename') return renameWorkspace(deps, body, response);
  if (url.pathname === '/api/workspace/icon') return setWorkspaceIcon(deps, body, response);
  if (url.pathname === '/api/workspace/close') return closeWorkspace(deps, body, response);
  if (url.pathname === '/api/herdr/hide') return hidePane(deps, body, response);
  if (url.pathname === '/api/feeds/watch') return watchFeed(deps, body, response);
  if (url.pathname === '/api/feeds/unwatch') return unwatchFeed(deps, body, response);
  if (url.pathname === '/api/herdr/show') return sendJson(response, await deps.herdrView.showHidden());
  if (url.pathname === '/api/open-in-editor') return openFile(deps, body, response);
  if (url.pathname === '/api/vscode/desktop') return openDesktopVsCode(deps, body, response);
  if (url.pathname === '/api/folder/open') return openFileManager(deps, body, response);
  const sessionId = isRecord(body) && typeof body.session === 'string' && sessionIdPattern.test(body.session) ? body.session : undefined;
  if (sessionId === undefined) {
    response.writeHead(400).end('Bad session id');
    return;
  }
  switch (url.pathname) {
    case '/api/send': {
      const attached = parseImages(isRecord(body) ? body.images : undefined);
      if (!attached.ok) {
        response.writeHead(400).end(attached.error);
        return;
      }
      // Claude Code and Codex open attached images by path; the files stay only if the terminal took the prompt.
      const paths = await deps.uploads.save(attached.images);
      const prompt = withAttachedImages(isRecord(body) && typeof body.text === 'string' ? body.text : '', paths);
      // now: what waits in Claude Code's queue goes at once, the prompt with it — Ctrl+Enter on the page
      const outcome = isRecord(body) && body.now === true ? await deps.composer.sendNow(sessionId, prompt) : await deps.composer.send(sessionId, prompt);
      if (!outcome.ok) await deps.uploads.remove(paths);
      return sendJson(response, outcome);
    }
    case '/api/interrupt':
      return stop(deps, sessionId, response);
    case '/api/rewind':
      return rewind(deps, sessionId, isRecord(body) ? body : {}, response);
    case '/api/dialog': {
      const steps = parseSteps(isRecord(body) ? body.steps : undefined);
      if (steps === undefined) {
        response.writeHead(400).end('Bad answer');
        return;
      }
      return sendJson(response, await deps.composer.answer(sessionId, steps));
    }
    // A session closed in herdr, opened there again: in its folder, which the transcript names, by its agent — one the
    // list has no transcript of is known from herdr's history alone, which is Claude Code's.
    case '/api/history/reopen': {
      const session = (await deps.index.list()).find((listed) => listed.id === sessionId);
      return sendJson(response, await deps.herdrView.reopen(sessionId, session?.cwd, session === undefined ? 'claude' : session.agent));
    }
    case '/api/btw':
      return askAside(deps, sessionId, isRecord(body) && typeof body.question === 'string' ? body.question : '', response);
    case '/api/bookmarks': {
      const change = parseBookmarkChange(isRecord(body) ? body.change : undefined);
      if (change === undefined) {
        response.writeHead(400).end('Bad bookmark change');
        return;
      }
      return sendJson(response, await deps.bookmarks.change(sessionId, change));
    }
    default:
      response.writeHead(404).end('Not found');
  }
}

/**
 * A side question, as /btw in the session's terminal. Claude may think for minutes — longer than a proxy in front of
 * the viewer waits for a reply that has not started (Cloudflare gives up after 100 s) — so the reply starts at once
 * and gets a space every few seconds until the answer comes: JSON allows spaces before the value.
 * @param {Deps} deps
 * @param {string} sessionId
 * @param {string} question
 * @param {http.ServerResponse} response
 */
async function askAside(deps, sessionId, question, response) {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  const keepAlive = setInterval(() => response.write(' '), keepAliveMs);
  try {
    response.end(JSON.stringify(await deps.composer.btw(sessionId, question)));
  } finally {
    clearInterval(keepAlive);
  }
}

const keepAliveMs = 15_000;

/**
 * A herdr tab named from the page's tab bar.
 * @param {Deps} deps
 * @param {unknown} body — { tab, label }
 * @param {http.ServerResponse} response
 */
async function renameTab(deps, body, response) {
  const tab = tabOf(body);
  if (tab === undefined || !isRecord(body) || typeof body.label !== 'string') {
    response.writeHead(400).end('Bad tab name');
    return;
  }
  return sendJson(response, await deps.herdrView.renameTab(tab, body.label));
}

/**
 * A herdr workspace named from the page's sidebar.
 * @param {Deps} deps
 * @param {unknown} body — { workspace, label }
 * @param {http.ServerResponse} response
 */
async function renameWorkspace(deps, body, response) {
  const workspace = workspaceOf(body);
  if (workspace === undefined || !isRecord(body) || typeof body.label !== 'string') {
    response.writeHead(400).end('Bad workspace name');
    return;
  }
  return sendJson(response, await deps.herdrView.renameWorkspace(workspace, body.label));
}

/**
 * A herdr workspace's icon picked by hand on the page — one its name cannot hold, Lucide's — or taken back: null.
 * @param {Deps} deps
 * @param {unknown} body — { workspace, icon }
 * @param {http.ServerResponse} response
 */
async function setWorkspaceIcon(deps, body, response) {
  const workspace = workspaceOf(body);
  const icon = isRecord(body) && typeof body.icon === 'string' ? parseIcon(body.icon) : undefined;
  if (workspace === undefined || !isRecord(body) || (body.icon !== null && icon === undefined)) {
    response.writeHead(400).end('Bad workspace icon');
    return;
  }
  return sendJson(response, await deps.herdrView.setWorkspaceIcon(workspace, icon === undefined ? undefined : iconValue(icon)));
}

/**
 * An idle session hidden from herdr's list in the page's sidebar, until its agent changes state.
 * @param {Deps} deps
 * @param {unknown} body — { pane }
 * @param {http.ServerResponse} response
 */
async function hidePane(deps, body, response) {
  const pane = isRecord(body) && typeof body.pane === 'string' && paneIdPattern.test(body.pane) ? body.pane : undefined;
  if (pane === undefined) {
    response.writeHead(400).end('Bad pane');
    return;
  }
  return sendJson(response, await deps.herdrView.hidePane(pane));
}

/**
 * A herdr workspace closed from the page's sidebar, with its tabs.
 * @param {Deps} deps
 * @param {unknown} body — { workspace }
 * @param {http.ServerResponse} response
 */
async function closeWorkspace(deps, body, response) {
  const workspace = workspaceOf(body);
  if (workspace === undefined) {
    response.writeHead(400).end('Bad workspace');
    return;
  }
  return sendJson(response, await deps.herdrView.closeWorkspace(workspace));
}

/**
 * A herdr tab closed from the page's tab bar.
 * @param {Deps} deps
 * @param {unknown} body — { tab }
 * @param {http.ServerResponse} response
 */
async function closeTab(deps, body, response) {
  const tab = tabOf(body);
  if (tab === undefined) {
    response.writeHead(400).end('Bad tab');
    return;
  }
  return sendJson(response, await deps.herdrView.closeTab(tab));
}

/**
 * A herdr tab dragged in the page's tab bar to another place among its workspace's tabs.
 * @param {Deps} deps
 * @param {unknown} body — { tab, place }: place — between the tabs as they stand, 0 before the first
 * @param {http.ServerResponse} response
 */
async function moveTab(deps, body, response) {
  const tab = tabOf(body);
  const place = isRecord(body) && Number.isSafeInteger(body.place) && Number(body.place) >= 0 ? Number(body.place) : undefined;
  if (tab === undefined || place === undefined) {
    response.writeHead(400).end('Bad tab place');
    return;
  }
  return sendJson(response, await deps.herdrView.moveTab(tab, place));
}

/**
 * A herdr tab opened from the page's tab bar, beside the open one: a shell, or Claude Code started in it.
 * @param {Deps} deps
 * @param {unknown} body — { tab, start }
 * @param {http.ServerResponse} response
 */
async function newTab(deps, body, response) {
  const tab = tabOf(body);
  const start = isRecord(body) ? tabStartOf(body.start) : undefined;
  if (tab === undefined || start === undefined) {
    response.writeHead(400).end('Bad new tab');
    return;
  }
  const label = isRecord(body) ? text(body.label) : undefined;
  return sendJson(response, await deps.herdrView.createTab(tab, start, label));
}

/**
 * A copy of a herdr tab, asked for from the page's tab bar: the session in it forked into a new tab of its workspace.
 * @param {Deps} deps
 * @param {unknown} body — { tab }
 * @param {http.ServerResponse} response
 */
async function duplicateTab(deps, body, response) {
  const tab = tabOf(body);
  if (tab === undefined) {
    response.writeHead(400).end('Bad tab');
    return;
  }
  return sendJson(response, await deps.herdrView.duplicateTab(tab));
}

/**
 * A herdr workspace opened from the page: { label, folder, start } — start: a shell, or Claude Code.
 * @param {Deps} deps
 * @param {unknown} body
 * @param {http.ServerResponse} response
 */
async function newWorkspace(deps, body, response) {
  const fields = isRecord(body) ? body : {};
  const label = text(fields.label);
  const folder = text(fields.folder);
  const start = tabStartOf(fields.start);
  if (label === undefined || folder === undefined || start === undefined) {
    response.writeHead(400).end('Bad new workspace');
    return;
  }
  // a folder that is not there is made only when the page asks: once it has told the user so
  return sendJson(response, await deps.herdrView.createWorkspace(label, folder, start, fields.create === true ? 'create' : 'refuse'));
}

/**
 * @param {unknown} body
 * @returns {string | undefined} — the tab id, when it looks like one: herdr's tab ids are like its pane ids
 */
function tabOf(body) {
  return isRecord(body) && typeof body.tab === 'string' && paneIdPattern.test(body.tab) ? body.tab : undefined;
}

/**
 * @param {unknown} body
 * @returns {string | undefined} — herdr's workspace id: w2, w3D
 */
function workspaceOf(body) {
  return isRecord(body) && typeof body.workspace === 'string' && paneIdPattern.test(body.workspace) ? body.workspace : undefined;
}

/**
 * Keys from the page's terminal, typed into a herdr pane.
 * @param {Deps} deps
 * @param {unknown} body — { pane, data }
 * @param {http.ServerResponse} response
 */
async function typeIntoPane(deps, body, response) {
  const pane = isRecord(body) && typeof body.pane === 'string' && paneIdPattern.test(body.pane) ? body.pane : undefined;
  if (pane === undefined || !isRecord(body) || typeof body.data !== 'string') {
    response.writeHead(400).end('Bad pane input');
    return;
  }
  return sendJson(response, await deps.terminals.type(pane, body.data));
}

/** @type {readonly import('./rewind.js').RewindAction[]} */
const rewindActions = ['both', 'conversation', 'code', 'summarize-from', 'summarize-up-to'];

/**
 * Rewind to before a message, as /rewind in the terminal does. After the conversation is rewound the feed hides the
 * rewound messages at once: the transcript shows the fork only when the next prompt arrives.
 * @param {Deps} deps
 * @param {string} sessionId
 * @param {Record<string, unknown>} body — { prompt: the message's uuid, action }
 * @param {http.ServerResponse} response
 */
async function rewind(deps, sessionId, body, response) {
  const action = rewindActions.find((known) => known === body.action);
  if (action === undefined || typeof body.prompt !== 'string') {
    response.writeHead(400).end('Bad rewind request');
    return;
  }
  const target = rewindTarget(await transcriptRecords(deps, sessionId), body.prompt);
  // A message sent while Claude was working joined that turn: the menu does not list it.
  if (target === undefined) return sendJson(response, { ok: false, error: 'not-listed' }, 404);
  const reply = await deps.composer.rewind(sessionId, { ...target, action });
  // Claude Code's transcript keeps the branch rewound from, hidden here; Codex goes on in a file of its own, which is
  // read in its place — and numbers what follows from where it was rewound
  const path = await deps.index.find(sessionId);
  const claude = path !== undefined && deps.index.agentOf(path) === 'claude';
  if (reply.ok && claude && (action === 'both' || action === 'conversation')) deps.rewinds.set(sessionId, body.prompt);
  return sendJson(response, reply.ok ? { ok: true, ...(reply.restoredPrompt ? { prompt: target.prompt } : {}) } : reply);
}

/**
 * Stop the current turn, as Esc in the terminal does. A prompt Claude had not started on goes back to the page's box;
 * if it reached the transcript anyway, the feed hides it at once, as the terminal does.
 * @param {Deps} deps
 * @param {string} sessionId
 * @param {http.ServerResponse} response
 */
async function stop(deps, sessionId, response) {
  const reply = await deps.composer.interrupt(sessionId);
  const stopped = reply.ok && reply.prompt !== undefined ? takenBackPrompt(await transcriptRecords(deps, sessionId), reply.prompt) : undefined;
  if (stopped !== undefined) deps.rewinds.set(sessionId, stopped);
  return sendJson(response, reply);
}

/**
 * @param {Deps} deps
 * @param {string} sessionId
 * @returns {Promise<readonly unknown[]>} — the session's transcript entries in file order — a Codex session's, from its
 *   files in turn, as Claude Code's records
 */
async function transcriptRecords(deps, sessionId) {
  const path = await deps.index.find(sessionId);
  if (path === undefined) return [];
  const joined = await openJoined(await deps.index.partsOf(path));
  /** @type {unknown[]} */
  let raw;
  try {
    const buffer = Buffer.alloc(joined.size);
    await joined.read(buffer, 0);
    raw = buffer.toString('utf8').split('\n').flatMap((line) => {
      try {
        return line === '' ? [] : [JSON.parse(line)];
      } catch {
        return []; // a line still being written
      }
    });
  } finally {
    await joined.close();
  }
  // a Codex session's, as Claude Code's records
  if (deps.index.agentOf(path) !== 'codex') return raw;
  const codex = createCodexReading();
  return raw.flatMap((record) => codex.translate(record));
}

/**
 * ?tail=<n> — the stream starts with the latest n entries.
 * @param {URL} url
 * @returns {number | undefined}
 */
function tailOf(url) {
  const tail = Number(url.searchParams.get('tail'));
  return Number.isInteger(tail) && tail > 0 ? tail : undefined;
}

/** Transcripts kept read in memory: the sessions opened lately, switched between. */
const cachedTranscripts = 8;

/** A body larger than this is not a prompt but something else. */
const maxBodyBytes = 256 * 1024;
/** A prompt with attached images: the page shrinks photos before sending, this leaves room for several. */
const maxSendBytes = 48 * 1024 * 1024;

/**
 * @param {http.IncomingMessage} request
 * @param {number} limit
 * @returns {Promise<unknown>} — undefined if the body is not JSON or is too large
 */
async function readJsonBody(request, limit) {
  /** @type {Buffer[]} */
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    if (!(chunk instanceof Buffer)) continue;
    size += chunk.length;
    if (size > limit) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined; // malformed JSON — the request is rejected as bad
  }
}

/**
 * The folder the session works in, as its transcript says last.
 * @param {Deps} deps
 * @param {string} id
 * @returns {Promise<string | undefined>}
 */
async function sessionFolder(deps, id) {
  return (await deps.index.list()).find((session) => session.id === id)?.cwd;
}

/** How git names a commit: the only base a file's diff is asked from — anything else could be an order to git. */
const commitPattern = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
/** @type {ReadonlySet<string>} */
const changeStatuses = new Set(['modified', 'added', 'deleted', 'renamed', 'copied', 'type-changed', 'untracked']);

/**
 * The changed file a diff is asked for: ?base= a commit, ?path=, ?old= for a renamed one, ?status=.
 * @param {URL} url
 * @returns {{ base: string, path: string, oldPath: string | undefined, status: import('../public/model/branch-changes.js').ChangeStatus } | undefined}
 */
function changedFileOf(url) {
  const base = url.searchParams.get('base') ?? '';
  const path = url.searchParams.get('path') ?? '';
  const status = url.searchParams.get('status') ?? '';
  if (!commitPattern.test(base) || path === '' || !isChangeStatus(status)) return undefined;
  return { base, path, oldPath: url.searchParams.get('old') || undefined, status };
}

/**
 * @param {string} value
 * @returns {value is import('../public/model/branch-changes.js').ChangeStatus}
 */
function isChangeStatus(value) {
  return changeStatuses.has(value);
}

/**
 * @param {URL} url
 * @param {http.ServerResponse} response
 * @param {(id: string) => Promise<void>} next
 */
async function withSession(url, response, next) {
  const id = url.searchParams.get('session') ?? '';
  if (!sessionIdPattern.test(id)) {
    response.writeHead(400).end('Bad session id');
    return;
  }
  await next(id);
}

/**
 * @param {Deps} deps
 * @param {URL} url
 * @param {string} id
 * @param {http.IncomingMessage} request
 * @param {http.ServerResponse} response
 */
async function stream(deps, url, id, request, response) {
  const agentId = url.searchParams.get('agent');
  if (agentId !== null && !agentIdPattern.test(agentId)) {
    response.writeHead(400).end('Bad agent id');
    return;
  }
  const events = eventStream(request, response);
  await streamTranscript({ ...feedOf(deps, { id, agentId, tail: tailOf(url), from: fromOf(url.searchParams.get('from')) }), send: events.send, signal: events.signal });
  events.end();
}

/** A page's name for itself, or for a feed it follows: short, letters and digits. */
const feedNamePattern = /^[\w-]{1,64}$/;

/**
 * @param {unknown} name
 * @returns {string | undefined}
 */
function feedNameOf(name) {
  return typeof name === 'string' && feedNamePattern.test(name) ? name : undefined;
}

/**
 * A page's stream of the feeds it follows (feeds.js), open until the page closes it: the feeds go over it as the page
 * asks for them.
 * @param {Deps} deps
 * @param {URL} url — ?page=<the page's name for itself>
 * @param {http.IncomingMessage} request
 * @param {http.ServerResponse} response
 */
async function feedsStream(deps, url, request, response) {
  const page = feedNameOf(url.searchParams.get('page'));
  if (page === undefined) {
    response.writeHead(400).end('Bad page');
    return;
  }
  const events = eventStream(request, response);
  deps.feeds.open(page, events);
  if (!events.signal.aborted) await new Promise((resolve) => events.signal.addEventListener('abort', resolve, { once: true }));
  events.end();
}

/**
 * A feed the page asks for over its stream: a session's transcript as /api/stream sends it, its events marked with the
 * page's name for it.
 * @param {Deps} deps
 * @param {unknown} body — { page, feed, session, agent?, tail?, from? }
 * @param {http.ServerResponse} response
 */
async function watchFeed(deps, body, response) {
  const asked = isRecord(body) ? body : {};
  const page = feedNameOf(asked.page);
  const feed = feedNameOf(asked.feed);
  const id = typeof asked.session === 'string' && sessionIdPattern.test(asked.session) ? asked.session : undefined;
  const agentId = asked.agent === undefined ? null : typeof asked.agent === 'string' && agentIdPattern.test(asked.agent) ? asked.agent : undefined;
  const tail = asked.tail === undefined ? undefined : Number.isSafeInteger(asked.tail) && Number(asked.tail) > 0 ? Number(asked.tail) : null;
  if (page === undefined || feed === undefined || id === undefined || agentId === undefined || tail === null || (asked.from !== undefined && fromOf(typeof asked.from === 'string' ? asked.from : undefined) === undefined)) {
    response.writeHead(400).end('Bad feed');
    return;
  }
  const following = deps.feeds.watch(page, feed);
  if (following === undefined) return sendJson(response, { ok: false, error: 'no-stream' }, 404);
  const from = typeof asked.from === 'string' ? asked.from : undefined;
  streamTranscript({ ...feedOf(deps, { id, agentId, tail, from }), send: following.send, signal: following.signal })
    .catch((error) => console.error(`The feed of session ${id} for page ${page} failed`, error))
    .finally(following.done);
  return sendJson(response, { ok: true });
}

/**
 * A feed the page lets go of.
 * @param {Deps} deps
 * @param {unknown} body — { page, feed }
 * @param {http.ServerResponse} response
 */
async function unwatchFeed(deps, body, response) {
  const page = isRecord(body) ? feedNameOf(body.page) : undefined;
  const feed = isRecord(body) ? feedNameOf(body.feed) : undefined;
  if (page === undefined || feed === undefined) {
    response.writeHead(400).end('Bad feed');
    return;
  }
  deps.feeds.unwatch(page, feed);
  return sendJson(response, { ok: true });
}

/**
 * How a session's feed is read for a page — the main conversation's, or a subagent's — but where it goes.
 * @param {Deps} deps
 * @param {{ id: string, agentId: string | null, tail: number | undefined, from: string | undefined }} asked — tail: how
 *   many of the latest entries it opens with, none — all; from: the token of the copy the page goes on from
 */
function feedOf(deps, { id, agentId, tail, from }) {
  return {
    locate: agentId === null ? () => deps.index.find(id) : () => deps.index.findSubagent(id, agentId),
    running: agentId === null ? () => deps.isRunning(id) : async () => false,
    sessionStatus: agentId === null ? () => deps.sessionStatus(id) : async () => undefined,
    scope: agentId === null ? /** @type {const} */ ('main') : /** @type {const} */ ('subagent'),
    rewoundAt: () => (agentId === null ? deps.rewinds.get(id) : undefined),
    imageUrl: (/** @type {number} */ lineStart, /** @type {number} */ n) => imageLink(id, agentId, lineStart, n),
    pollMs: deps.pollMs,
    transcripts: deps.transcripts,
    tail,
    version: deps.build,
    from,
  };
}

/** A token is short: one longer is none of the viewer's. */
const maxTokenChars = 400;

/**
 * The token of the copy a page goes on from, as it asks; none for one it does not have — or one too long to be a token.
 * @param {string | null | undefined} asked
 * @returns {string | undefined}
 */
function fromOf(asked) {
  return typeof asked === 'string' && asked !== '' && asked.length <= maxTokenChars ? asked : undefined;
}

/**
 * A herdr pane's screen for the page's terminal, as it changes, until the pane is gone or the page closes the stream.
 * @param {Deps} deps
 * @param {URL} url
 * @param {http.IncomingMessage} request
 * @param {http.ServerResponse} response
 */
async function streamPane(deps, url, request, response) {
  const pane = url.searchParams.get('pane');
  if (pane === null || !paneIdPattern.test(pane)) {
    response.writeHead(400).end('Bad pane id');
    return;
  }
  const events = eventStream(request, response);
  await deps.terminals.stream(pane, events.send, events.signal);
  events.end();
}

/**
 * Server-sent events: every one flushed at once, and gzipped when the browser takes it — a session's history is
 * megabytes of text that gzip shrinks several times, a terminal's screen is mostly colour codes.
 * @param {http.IncomingMessage} request
 * @param {http.ServerResponse} response
 * @returns {{ send: (event: string, data: unknown) => void, signal: AbortSignal, end: () => void }} — signal: aborted
 *   when the page closes the stream
 */
function eventStream(request, response) {
  const zipped = acceptsGzip(response);
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    ...(zipped ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}),
  });
  response.flushHeaders();
  const out = zipped ? createGzip({ flush: zlibConstants.Z_SYNC_FLUSH }) : response;
  if (out !== response) out.pipe(response);
  const controller = new AbortController();
  const ping = setInterval(() => out.write(': ping\n\n'), 15_000);
  request.on('close', () => {
    controller.abort();
    clearInterval(ping);
  });
  return {
    send: (event, data) => out.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    signal: controller.signal,
    end: () => {
      clearInterval(ping);
      out.end();
    },
  };
}

/**
 * An image attached to a prompt from the page.
 * @param {Deps} deps
 * @param {string} name
 * @param {http.ServerResponse} response
 */
async function sendUpload(deps, name, response) {
  const image = await deps.uploads.read(name);
  if (image === undefined) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': image.mediaType, 'Content-Length': image.bytes.length, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  response.end(image.bytes);
}

/**
 * An image of a transcript entry, whose link the stream sent instead of its bytes.
 * @param {Deps} deps
 * @param {URL} url
 * @param {string} id
 * @param {http.ServerResponse} response
 */
async function sendImage(deps, url, id, response) {
  const agentId = url.searchParams.get('agent');
  const lineStart = Number(url.searchParams.get('at'));
  const n = Number(url.searchParams.get('n'));
  const valid = (agentId === null || agentIdPattern.test(agentId)) && Number.isSafeInteger(lineStart) && lineStart >= 0 && Number.isSafeInteger(n) && n >= 0;
  if (!valid) {
    response.writeHead(400).end('Bad image link');
    return;
  }
  const path = agentId === null ? await deps.index.find(id) : await deps.index.findSubagent(id, agentId);
  /** @type {import('./images.js').ImageOutcome} */
  const outcome = path === undefined ? { ok: false, error: 'not-found' } : await readImage(path, lineStart, n);
  if (!outcome.ok) {
    response.writeHead(imageRefusalStatus[outcome.error]).end();
    return;
  }
  // A transcript line never changes once written, so the browser may keep the image.
  response.writeHead(200, { 'Content-Type': outcome.mediaType, 'Content-Length': outcome.bytes.length, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  response.end(outcome.bytes);
}

/** @type {Readonly<Record<'not-found' | 'not-raster', number>>} */
const imageRefusalStatus = { 'not-found': 404, 'not-raster': 415 };

/**
 * The n-th image of the entry on the line that starts at lineStart, for the page to load when it is in view.
 * @param {string} id
 * @param {string | null} agentId
 * @param {number} lineStart
 * @param {number} n
 */
function imageLink(id, agentId, lineStart, n) {
  return `/api/image?session=${id}${agentId === null ? '' : `&agent=${agentId}`}&at=${lineStart}&n=${n}`;
}

/**
 * An entry whole — with the tool output the stream left out of it (lite.js): the page asks for it when the row opens.
 * ?at= — where its line starts, as the stream gave it; an offset inside a line finds nothing.
 * @param {Deps} deps
 * @param {URL} url
 * @param {string} id
 * @param {http.ServerResponse} response
 */
async function sendEntry(deps, url, id, response) {
  const agentId = url.searchParams.get('agent');
  const lineStart = Number(url.searchParams.get('at'));
  if ((agentId !== null && !agentIdPattern.test(agentId)) || !Number.isSafeInteger(lineStart) || lineStart < 0) {
    response.writeHead(400).end('Bad entry link');
    return;
  }
  const path = agentId === null ? await deps.index.find(id) : await deps.index.findSubagent(id, agentId);
  // a subagent's transcript is its file alone; a session's, the files it went on in
  const parts = path === undefined ? undefined : agentId === null ? await deps.index.partsOf(path) : [{ path, end: undefined }];
  const line = parts === undefined ? undefined : await readLineAt(parts, lineStart);
  const parsed = line === undefined ? undefined : parseLine(line);
  // a Codex session's line read alone is the record it was read as in turn
  const raw = path !== undefined && parsed !== undefined && deps.index.agentOf(path) === 'codex' ? createCodexReading().translate(parsed)[0] : parsed;
  const entry = raw === undefined ? undefined : slimEntry(raw, agentId === null ? 'main' : 'subagent', (n) => imageLink(id, agentId, lineStart, n));
  if (entry === undefined) {
    response.writeHead(404).end('Not found');
    return;
  }
  return sendJson(response, entry);
}

/**
 * The opening part of a session at once, as its stream would start: the page keeps it to read offline.
 * ?tail=<n> — the latest n entries.
 * @param {Deps} deps
 * @param {URL} url
 * @param {string} id
 * @param {http.ServerResponse} response
 */
async function sendSnapshot(deps, url, id, response) {
  const path = await deps.index.find(id);
  if (path === undefined) {
    response.writeHead(404).end('Not found');
    return;
  }
  const read = await deps.transcripts.read(path, { scope: 'main', imageUrl: (lineStart, n) => imageLink(id, null, lineStart, n) });
  return sendJson(response, openingPart(read.entries, deps.rewinds.get(id), tailOf(url)));
}

/**
 * Which run of the viewer answers, at which port, and whether it has an editor. A page opened through a tunnel asks the
 * viewer at 127.0.0.1 on that port: the same run answering there means the browser is on the viewer's computer, where
 * a file opened in the editor shows up. So the viewer's own pages may read it from any of their addresses.
 * @param {Deps} deps
 * @param {http.IncomingMessage} request
 * @param {http.ServerResponse} response
 */
function sendMachine(deps, request, response) {
  const origin = request.headers.origin;
  if (origin !== undefined && deps.allowedOrigins.has(origin)) response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  return sendJson(response, { instance: deps.instance, port: request.socket.localPort, editor: deps.editor !== undefined, vscode: deps.vscode !== undefined });
}

/**
 * A file of the file panel, opened at its line in the editor of the viewer's computer.
 * @param {Deps} deps
 * @param {unknown} body — { path, line }
 * @param {http.ServerResponse} response
 */
async function openFile(deps, body, response) {
  const path = isRecord(body) ? text(body.path) : undefined;
  const line = isRecord(body) && typeof body.line === 'number' && Number.isInteger(body.line) && body.line >= 1 ? body.line : undefined;
  if (path === undefined || line === undefined) {
    response.writeHead(400).end('Bad file or line');
    return;
  }
  if (deps.editor === undefined) return sendJson(response, { ok: false, error: 'no-editor' });
  return sendJson(response, await deps.editor(path, line));
}

/**
 * The work the session started in the background: subagents and commands.
 * @param {Deps} deps
 * @param {string} id
 * @param {http.ServerResponse} response
 */
async function sendTasks(deps, id, response) {
  const path = await deps.index.find(id);
  if (path === undefined) return sendJson(response, []);
  const read = await deps.transcripts.read(path, { scope: 'main', imageUrl: (lineStart, n) => imageLink(id, null, lineStart, n) });
  return sendJson(response, await seenTasks(read.tasks.list(), await deps.isRunning(id), (agentId) => deps.index.findSubagent(id, agentId)));
}

/**
 * The output of a command the session runs in the background: ?task=<the call's id>, &from=<byte> to read on.
 * Only a command of this session is read, from the file Claude Code named for it.
 * @param {Deps} deps
 * @param {URL} url
 * @param {string} id
 * @param {http.ServerResponse} response
 */
async function sendTaskOutput(deps, url, id, response) {
  const path = await deps.index.find(id);
  const read = path === undefined ? undefined : await deps.transcripts.read(path, { scope: 'main', imageUrl: (lineStart, n) => imageLink(id, null, lineStart, n) });
  const task = read?.tasks.list().find((one) => one.id === url.searchParams.get('task'));
  if (task?.output === undefined) {
    response.writeHead(404).end('Not found');
    return;
  }
  const from = Number(url.searchParams.get('from') ?? Number.NaN);
  const output = await readTaskOutput(task.output, Number.isInteger(from) && from >= 0 ? from : undefined);
  return sendJson(response, output ?? { missing: true });
}

/**
 * @param {string} line
 * @returns {unknown}
 */
function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return undefined; // not an entry
  }
}

/**
 * File text for the right-hand panel. Any absolute path is served: the page is open only on this machine,
 * and other sites cannot reach it — the server listens on 127.0.0.1 and checks Host.
 * @param {URL} url
 * @param {http.ServerResponse} response
 */
async function sendFile(url, response) {
  const outcome = await readTextFile(url.searchParams.get('path') ?? '', { maxBytes: maxFileBytes, home: homedir() });
  if (outcome.ok) return sendJson(response, outcome);
  return sendJson(response, outcome, refusalStatus[outcome.error]);
}

/** @type {Readonly<Record<import('./files.js').FileRefusal, number>>} */
const refusalStatus = { 'not-absolute': 400, 'not-a-file': 400, 'not-found': 404, 'too-large': 413, binary: 415 };
const maxFileBytes = 2 * 1024 * 1024;
/**
 * A project's folder for the file panel: its folders, then its files.
 * @param {URL} url — ?path=<the folder>
 * @param {http.ServerResponse} response
 */
async function sendFolder(url, response) {
  const listing = await listFolder(url.searchParams.get('path') ?? '', { home: homedir(), maxEntries: maxFolderEntries });
  return sendJson(response, listing, listing.ok ? 200 : folderRefusalStatus[listing.error]);
}

/**
 * A project's text searched, for the file panel.
 * @param {URL} url — ?root=<the project's folder>&q=<what>&mode=text|regex&case=1&word=1
 * @param {http.ServerResponse} response
 */
async function sendSearch(url, response) {
  const text = url.searchParams.get('q') ?? '';
  if (text === '' || text.length > maxSearchChars) {
    response.writeHead(400).end('Bad search');
    return;
  }
  const query = { text, mode: url.searchParams.get('mode') === 'regex' ? /** @type {const} */ ('regex') : /** @type {const} */ ('text'), caseSensitive: url.searchParams.get('case') === '1', wholeWord: url.searchParams.get('word') === '1' };
  const found = await searchProject(url.searchParams.get('root') ?? '', query, { home: homedir(), maxMatches: maxSearchMatches, timeoutMs: searchTimeoutMs });
  return sendJson(response, found, found.ok ? 200 : searchRefusalStatus[found.error]);
}

/**
 * A file's links in its project: what it imports, and what imports it.
 * @param {URL} url — ?path=<the file>&root=<its project's folder>
 * @param {http.ServerResponse} response
 */
async function sendLinks(url, response) {
  const links = await fileLinks(url.searchParams.get('path') ?? '', url.searchParams.get('root') ?? '', { home: homedir(), maxMatches: maxSearchMatches, maxBytes: maxFileBytes });
  return sendJson(response, links, links.ok ? 200 : linksRefusalStatus[links.error]);
}

/** @type {Readonly<Record<'not-absolute' | 'not-found' | 'too-large' | 'not-a-folder', number>>} */
const linksRefusalStatus = { 'not-absolute': 400, 'not-found': 404, 'too-large': 413, 'not-a-folder': 400 };

const maxFolderEntries = 5000;
const maxSearchMatches = 1000;
const maxSearchChars = 1000;
/** @type {Readonly<Record<import('./project.js').FolderRefusal, number>>} */
const folderRefusalStatus = { 'not-absolute': 400, 'not-found': 404, 'not-a-folder': 400 };
/** @type {Readonly<Record<import('./project.js').FolderRefusal | 'bad-pattern' | 'no-git', number>>} */
const searchRefusalStatus = { ...folderRefusalStatus, 'bad-pattern': 400, 'no-git': 501 };

/**
 * An answer seen in a page, kept for every device.
 * @param {Deps} deps
 * @param {unknown} body — { pane, count }: herdr's pane, its count of changes when its answer was seen
 * @param {http.ServerResponse} response
 */
async function markSeen(deps, body, response) {
  const pane = isRecord(body) ? text(body.pane) : undefined;
  const count = isRecord(body) && typeof body.count === 'number' && Number.isSafeInteger(body.count) ? body.count : undefined;
  if (pane === undefined || pane.length > 100 || count === undefined) {
    response.writeHead(400).end('Bad answer seen');
    return;
  }
  await deps.seen.mark(pane, count);
  return sendJson(response, { ok: true });
}

/**
 * What a new tab or workspace starts with, as the page asks for it.
 * @param {unknown} value
 * @returns {import('../public/model/herdr.js').TabStart | undefined}
 */
function tabStartOf(value) {
  return value === 'shell' || value === 'claude' || value === 'claude-gpt' || value === 'codex' ? value : undefined;
}

/** A file's text as JSON: an escaped character takes up to six bytes. */
const maxSaveBytes = maxFileBytes * 6 + 64 * 1024;

/**
 * A text edited in the panel, saved over its file while the file is the one read; else what the file holds now.
 * @param {unknown} body — { path, content, version }
 * @param {http.ServerResponse} response
 */
async function saveFile(body, response) {
  const path = isRecord(body) ? text(body.path) : undefined;
  const content = isRecord(body) ? text(body.content) : undefined;
  const version = isRecord(body) ? text(body.version) : undefined;
  if (path === undefined || content === undefined || version === undefined) {
    response.writeHead(400).end('Bad file save');
    return;
  }
  const outcome = await saveTextFile(path, { content, version }, { maxBytes: maxFileBytes, home: homedir() });
  return sendJson(response, outcome, outcome.ok ? 200 : saveRefusalStatus[outcome.error]);
}

/** @type {Readonly<Record<import('./files.js').SaveRefusal | 'changed', number>>} */
const saveRefusalStatus = { 'not-absolute': 400, 'not-a-file': 400, 'not-found': 404, 'too-large': 413, binary: 415, 'not-utf8': 415, 'read-only': 403, changed: 409 };

/**
 * A picture for the right-hand panel's <img>, from any absolute path as the file text is. The file may change, so
 * the browser keeps nothing.
 * @param {URL} url
 * @param {http.ServerResponse} response
 */
async function sendFileImage(url, response) {
  const outcome = await readImageFile(url.searchParams.get('path') ?? '', { maxBytes: maxImageBytes, home: homedir() });
  if (!outcome.ok) return sendJson(response, outcome, imageFileRefusalStatus[outcome.error]);
  response.writeHead(200, { 'Content-Type': outcome.mediaType, 'Content-Length': outcome.bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(outcome.bytes);
}

/**
 * A document drawn in the panel — a page, a PDF — and what it loads beside it: /api/folder/<folder>/<path from it>,
 * the folder's absolute path in base64url, so the page's relative addresses resolve inside it. A page comes in a
 * sandbox — also when opened by its address in a tab of its own — that runs no script; with ?scripts=1 it runs them,
 * in an origin of its own: then it cannot reach the viewer's page or read what the viewer sends.
 * @param {URL} url
 * @param {http.ServerResponse} response
 */
async function sendFolderFile(url, response) {
  const [token = '', ...steps] = url.pathname.slice(folderPrefix.length).split('/');
  const folder = Buffer.from(token, 'base64url').toString('utf8');
  /** @type {string} */
  let relative;
  try {
    relative = steps.map((step) => decodeURIComponent(step)).join('/');
  } catch {
    return sendJson(response, { ok: false, error: 'not-found' }, 404); // a % that escapes nothing names no file
  }
  const outcome = await folderFileAt(folder, relative, { maxBytes: maxFolderFileBytes });
  if (!outcome.ok) return sendJson(response, outcome, folderFileRefusalStatus[outcome.error]);
  response.writeHead(200, {
    'Content-Type': outcome.mediaType,
    'Content-Length': outcome.size,
    'Content-Security-Policy': sandboxPolicy(url.searchParams.get('scripts') === '1' ? 'on' : 'off'),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(outcome.path)
    .on('error', () => response.destroy())
    .pipe(response);
}

const folderPrefix = '/api/folder/';
/** @type {Readonly<Record<import('file-views/server').FolderFileRefusal, number>>} */
const folderFileRefusalStatus = { 'not-absolute': 400, 'not-a-file': 400, 'not-found': 404, 'too-large': 413, outside: 403 };
/** PDFs of scanned pages run large. */
const maxFolderFileBytes = 200 * 1024 * 1024;

/** @type {Readonly<Record<import('./files.js').ImageRefusal, number>>} */
const imageFileRefusalStatus = { 'not-absolute': 400, 'not-a-file': 400, 'not-found': 404, 'too-large': 413, 'not-image': 415 };
/** Screenshots run to several megabytes. */
const maxImageBytes = 20 * 1024 * 1024;

/**
 * @param {http.ServerResponse} response
 * @param {unknown} body
 * @param {number} [status]
 */
async function sendJson(response, body, status = 200) {
  await sendBody(response, status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, Buffer.from(JSON.stringify(body)));
}

/**
 * JSON the browser keeps and asks about again: the same reply as last time comes back as 304 Not Modified.
 * @param {http.ServerResponse} response
 * @param {unknown} body
 */
async function sendRevalidated(response, body) {
  const json = Buffer.from(JSON.stringify(body));
  // weak: the same tag for the reply gzipped and not; a strong one Cloudflare drops or weakens as it recompresses
  const etag = `W/"${createHash('sha256').update(json).digest('base64url').slice(0, 27)}"`;
  // the tag in a header of the viewer's own as well: Cloudflare does not pass ETag on to Safari, and the page sends the
  // tag back itself (view/revalidated-polls.js)
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', ETag: etag, 'X-Viewer-Tag': etag };
  if (isUnchanged(response.req.headers['if-none-match'], etag)) {
    response.writeHead(304, headers).end();
    return;
  }
  await sendBody(response, 200, headers, json);
}

/**
 * Whether the browser's If-None-Match names this tag among those it lists. Compared weakly, as RFC 9110 has it: a proxy
 * that recompresses the reply — Cloudflare, gzip into brotli — hands the tag back weakened, W/"…".
 * @param {string | undefined} ifNoneMatch
 * @param {string} etag
 */
function isUnchanged(ifNoneMatch, etag) {
  const opaque = (/** @type {string} */ tag) => tag.replace(/^W\//, '');
  return [...(ifNoneMatch ?? '').matchAll(/(?:W\/)?"[^"]*"/g)].some(([tag]) => opaque(tag) === opaque(etag));
}

/** Bodies smaller than this gain nothing from gzip. */
const minGzipBytes = 1024;
const gzipAsync = promisify(gzip);

/**
 * A reply, gzipped when the browser accepts it and the body is worth compressing.
 * @param {http.ServerResponse} response
 * @param {number} status
 * @param {Record<string, string>} headers
 * @param {Buffer} body
 */
async function sendBody(response, status, headers, body) {
  if (body.length < minGzipBytes || !acceptsGzip(response)) {
    response.writeHead(status, headers).end(body);
    return;
  }
  const zipped = await gzipAsync(body);
  response.writeHead(status, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' }).end(zipped);
}

/** @param {http.ServerResponse} response */
function acceptsGzip(response) {
  return /\bgzip\b/.test(response.req.headers['accept-encoding'] ?? '');
}

/** A page file under the build path: /b/<build>/app.js is /app.js of that build. */
const buildPath = /^\/b\/[0-9a-f]{1,64}(\/.+)$/;

/**
 * The page links its files under the current build path, so after an update they have new URLs and no cache —
 * the browser's or a proxy's — can serve the old ones; under such a URL a file never changes and may be kept.
 * @param {Pick<Deps, 'build' | 'palette' | 'fileIcons'>} deps — palette: the page's colours and tab icon
 * @param {string} pathname
 * @param {http.ServerResponse} response
 */
async function servePage({ build, palette, fileIcons }, pathname, response) {
  if (pathname === '/' || pathname === '/index.html') {
    const assets = `/b/${build}`;
    // CodeMirror's modules, for the file panel's editor: the import map names each
    const editor = Object.entries(editorImports(assets)).map(([name, address]) => `,
        ${JSON.stringify(name)}: ${JSON.stringify(address)}`).join('');
    const html = (await readFile(join(publicDir, 'index.html'), 'utf8')).replaceAll('{{editorImports}}', editor).replaceAll('{{assets}}', assets).replaceAll('{{palette}}', palette);
    return sendBody(response, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, Buffer.from(html));
  }
  const built = buildPath.exec(pathname)?.[1];
  const file = built ?? pathname;
  const cacheControl = built === undefined ? 'no-cache' : 'private, max-age=31536000, immutable';
  if (file.startsWith(fileIconsPrefix)) return serveFileIcon(fileIcons, file.slice(fileIconsPrefix.length), response, cacheControl);
  return serveFile(file, response, cacheControl);
}

/**
 * The icon theme's choices, or one of its icons.
 * @param {Deps['fileIcons']} fileIcons
 * @param {string} rest — the address past the prefix
 * @param {http.ServerResponse} response
 * @param {string} cacheControl
 */
async function serveFileIcon(fileIcons, rest, response, cacheControl) {
  const answer = await fileIconAnswer(fileIcons, decodeURIComponent(rest));
  if (answer === undefined) {
    response.writeHead(404).end('Not found');
    return;
  }
  if (answer.kind === 'theme') return sendBody(response, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cacheControl }, Buffer.from(answer.json));
  return sendBody(response, 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff' }, await readFile(answer.file));
}

/**
 * A fingerprint of the page files: it changes whenever one of them changes, and the page's file URLs change with it.
 * @returns {Promise<string>}
 */
async function pageBuild() {
  const names = await readdir(publicDir, { recursive: true });
  const views = ['file-views.js', 'file-views.css'].flatMap((name) => assetFile(name) ?? []);
  const files = [...names.map((name) => join(publicDir, name)), ...vendor.values(), ...views, ...editorModuleFiles(), fileIconsManifest].sort();
  const hash = createHash('sha256');
  for (const file of files) {
    const info = await stat(file).catch(() => undefined);
    if (info?.isFile()) hash.update(`${file}:${info.size}:${info.mtimeMs}\n`);
  }
  return hash.digest('hex').slice(0, 12);
}

/**
 * @param {string} pathname
 * @param {http.ServerResponse} response
 * @param {string} cacheControl
 */
async function serveFile(pathname, response, cacheControl) {
  const file = vendor.get(pathname) ?? fileViewsFile(pathname) ?? editorFile(pathname) ?? publicFile(pathname === '/' ? '/index.html' : pathname);
  const info = file === undefined ? undefined : await stat(file).catch(() => undefined);
  if (file === undefined || info === undefined || !info.isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  // Without the build path the browser asks every time (no-cache) but downloads the file again only when it has changed.
  const etag = `W/"${info.size}-${Math.trunc(info.mtimeMs)}"`;
  if (isUnchanged(response.req.headers['if-none-match'], etag)) {
    response.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl }).end();
    return;
  }
  const headers = { 'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream', 'Cache-Control': cacheControl, ETag: etag };
  await sendBody(response, 200, headers, await readFile(file));
}

/**
 * A file from public/; a path outside it ("..") is not served.
 * @param {string} pathname
 * @returns {string | undefined}
 */
function publicFile(pathname) {
  const file = resolve(publicDir, `.${decodeURIComponent(pathname)}`);
  return file.startsWith(publicDir + sep) ? file : undefined;
}
