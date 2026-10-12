// @ts-check
// The viewer's HTTP server: static files, the session list, the stream of transcript entries.
// Transcripts contain everything the agent saw, secrets included, so the server listens only on a local address
// and answers only requests whose Host is that address: a page from another site cannot read it via DNS rebinding.
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import { homedir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { constants as zlibConstants, createGzip, gzip } from 'node:zlib';
import { withAttachedImages } from '../public/model/attachments.js';
import { parseBookmarkChange } from '../public/model/bookmarks.js';
import { isRecord } from '../public/model/narrow.js';
import { takenBackPrompt } from './branch.js';
import { readImageFile, readTextFile } from './files.js';
import { readBranch } from './git.js';
import { readImage } from './images.js';
import { rewindTarget } from './rewind.js';
import { createSessionIndex } from './sessions.js';
import { slimEntry } from './slim.js';
import { openingPart, streamTranscript } from './stream.js';
import { readLineAt } from './tail.js';
import { createTranscriptCache } from './transcript-cache.js';
import { parseImages } from './uploads.js';

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
]);

/** @type {Readonly<Record<string, string>>} */
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const agentIdPattern = /^[0-9a-z]{1,64}$/i;
/** herdr's pane ids: w2:p1, w3D:pK */
const paneIdPattern = /^[\w:-]{1,40}$/;

/**
 * @typedef {{ liveState: (sessionId: string) => Promise<import('./composer.js').LiveState>, send: (sessionId: string, text: string) => Promise<import('./composer.js').SendOutcome>, interrupt: (sessionId: string) => Promise<import('./composer.js').StopReply>, rewind: (sessionId: string, request: import('./composer.js').RewindRequest) => Promise<import('./composer.js').RewindReply> }} Composer
 * @typedef {{ name: string, version: string }} About
 */

/**
 * @param {{ root: string, host: string, port: number, pollMs: number, composer: Composer, bookmarks: import('./bookmarks.js').Bookmarks, uploads: Uploads, about: About, palette: import('../public/model/palettes.js').Palette, publicAddresses: readonly PublicAddress[], herdrView: HerdrView, terminals: Terminals }} options
 *   about — package name and version for /api/health; palette — the page's colours (public/model/palettes.js);
 *   publicAddresses — where else the page is opened at, answered as the local address is; herdrView — what herdr
 *   shows (herdr-view.js); terminals — herdr panes' terminals (terminal.js)
 * @returns {Promise<{ port: number, close: () => void }>}
 */
export async function startServer({ root, host, port, pollMs, composer, bookmarks, uploads, about, palette, publicAddresses, herdrView, terminals }) {
  const index = createSessionIndex(root, { summaryBudgetMs: 1500 });
  const build = await pageBuild();
  /** Sessions this page rewound: session id → the prompt rewound to; its branch is hidden before the next prompt shows the fork. */
  /** @type {Map<string, string>} */
  const rewinds = new Map();
  const transcripts = createTranscriptCache({ maxFiles: cachedTranscripts });
  /** @type {Set<string>} */
  const allowedHosts = new Set();
  /** @type {Set<string>} */
  const allowedOrigins = new Set();
  const server = http.createServer((request, response) => {
    handle({ index, allowedHosts, allowedOrigins, pollMs, composer, bookmarks, uploads, about, build, rewinds, transcripts, palette, herdrView, terminals }, request, response).catch((error) => {
      console.error(`${request.method} ${request.url} failed`, error);
      if (!response.headersSent) response.writeHead(500).end();
      else response.end();
    });
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
 * @typedef {{ index: ReturnType<typeof createSessionIndex>, allowedHosts: ReadonlySet<string>, allowedOrigins: ReadonlySet<string>, pollMs: number, composer: Composer, bookmarks: import('./bookmarks.js').Bookmarks, uploads: Uploads, about: About, build: string, rewinds: Map<string, string>, transcripts: import('./stream.js').TranscriptCache, palette: import('../public/model/palettes.js').Palette, herdrView: HerdrView, terminals: Terminals }} Deps
 * @typedef {Pick<ReturnType<typeof import('./herdr-view.js').createHerdrView>, 'workspacesOf' | 'layout'>} HerdrView
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
    case '/api/branch':
      // The branch checked out in the session's folder now, for the header.
      return withSession(url, response, async (id) => {
        const cwd = (await deps.index.list()).find((session) => session.id === id)?.cwd;
        return sendJson(response, { branch: cwd === undefined ? undefined : await readBranch(cwd) });
      });
    // The page asks about herdr every few seconds: an unchanged reply goes without its body.
    case '/api/workspaces':
      return sendRevalidated(response, await deps.herdrView.workspacesOf(await deps.index.list()));
    case '/api/herdr':
      return sendRevalidated(response, await deps.herdrView.layout());
    case '/api/pane/stream':
      return streamPane(deps, url, request, response);
    case '/api/subagents':
      return withSession(url, response, async (id) => sendJson(response, await deps.index.subagents(id)));
    case '/api/bookmarks':
      return withSession(url, response, async (id) => sendJson(response, await deps.bookmarks.list(id)));
    case '/api/stream':
      return withSession(url, response, async (id) => stream(deps, url, id, request, response));
    case '/api/file':
      return sendFile(url, response);
    case '/api/file/image':
      return sendFileImage(url, response);
    case '/api/image':
      return withSession(url, response, async (id) => sendImage(deps, url, id, response));
    case '/api/entry':
      return withSession(url, response, async (id) => sendEntry(deps, url, id, response));
    case '/api/snapshot':
      return withSession(url, response, async (id) => sendSnapshot(deps, url, id, response));
    default:
      return servePage(deps.build, deps.palette, url.pathname, response);
  }
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
  const body = await readJsonBody(request, url.pathname === '/api/send' ? maxSendBytes : maxBodyBytes);
  if (url.pathname === '/api/pane/input') return typeIntoPane(deps, body, response);
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
      // Claude Code opens attached images by path; the files stay only if the terminal took the prompt.
      const paths = await deps.uploads.save(attached.images);
      const outcome = await deps.composer.send(sessionId, withAttachedImages(isRecord(body) && typeof body.text === 'string' ? body.text : '', paths));
      if (!outcome.ok) await deps.uploads.remove(paths);
      return sendJson(response, outcome);
    }
    case '/api/interrupt':
      return stop(deps, sessionId, response);
    case '/api/rewind':
      return rewind(deps, sessionId, isRecord(body) ? body : {}, response);
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
  if (reply.ok && (action === 'both' || action === 'conversation')) deps.rewinds.set(sessionId, body.prompt);
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
 * @returns {Promise<readonly unknown[]>} — the session's transcript entries in file order
 */
async function transcriptRecords(deps, sessionId) {
  const path = await deps.index.find(sessionId);
  return path === undefined ? [] : (await readFile(path, 'utf8')).split('\n').flatMap((line) => {
    try {
      return line === '' ? [] : [JSON.parse(line)];
    } catch {
      return []; // a line still being written
    }
  });
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
  await streamTranscript({
    locate: agentId === null ? () => deps.index.find(id) : () => deps.index.findSubagent(id, agentId),
    scope: agentId === null ? 'main' : 'subagent',
    rewoundAt: () => (agentId === null ? deps.rewinds.get(id) : undefined),
    imageUrl: (lineStart, n) => imageLink(id, agentId, lineStart, n),
    send: events.send,
    signal: events.signal,
    pollMs: deps.pollMs,
    transcripts: deps.transcripts,
    tail: tailOf(url),
  });
  events.end();
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
  const line = path === undefined ? undefined : await readLineAt(path, lineStart);
  const raw = line === undefined ? undefined : parseLine(line);
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
  const etag = `"${createHash('sha256').update(json).digest('base64url').slice(0, 27)}"`;
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', ETag: etag };
  if (response.req.headers['if-none-match'] === etag) {
    response.writeHead(304, headers).end();
    return;
  }
  await sendBody(response, 200, headers, json);
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
 * @param {string} build
 * @param {import('../public/model/palettes.js').Palette} palette — the page's colours and tab icon
 * @param {string} pathname
 * @param {http.ServerResponse} response
 */
async function servePage(build, palette, pathname, response) {
  if (pathname === '/' || pathname === '/index.html') {
    const html = (await readFile(join(publicDir, 'index.html'), 'utf8')).replaceAll('{{assets}}', `/b/${build}`).replaceAll('{{palette}}', palette);
    return sendBody(response, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, Buffer.from(html));
  }
  const built = buildPath.exec(pathname)?.[1];
  if (built !== undefined) return serveFile(built, response, 'private, max-age=31536000, immutable');
  return serveFile(pathname, response, 'no-cache');
}

/**
 * A fingerprint of the page files: it changes whenever one of them changes, and the page's file URLs change with it.
 * @returns {Promise<string>}
 */
async function pageBuild() {
  const names = await readdir(publicDir, { recursive: true });
  const files = [...names.map((name) => join(publicDir, name)), ...vendor.values()].sort();
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
  const file = vendor.get(pathname) ?? publicFile(pathname === '/' ? '/index.html' : pathname);
  const info = file === undefined ? undefined : await stat(file).catch(() => undefined);
  if (file === undefined || info === undefined || !info.isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  // Without the build path the browser asks every time (no-cache) but downloads the file again only when it has changed.
  const etag = `W/"${info.size}-${Math.trunc(info.mtimeMs)}"`;
  if (response.req.headers['if-none-match'] === etag) {
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
