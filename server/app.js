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
import { parseBookmarkChange } from '../public/model/bookmarks.js';
import { isRecord } from '../public/model/narrow.js';
import { readTextFile } from './files.js';
import { readImage } from './images.js';
import { createSessionIndex } from './sessions.js';
import { streamTranscript } from './stream.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

/**
 * Third-party modules for the browser: URL → ES build file. Node finds the path by its module resolution rules:
 * when installed as a package (npx, npm i -g), dependencies live one level up, not in our own node_modules.
 */
const vendor = new Map([
  ['/vendor/marked.js', fileURLToPath(import.meta.resolve('marked'))],
  ['/vendor/purify.js', fileURLToPath(import.meta.resolve('dompurify'))],
  ['/vendor/highlight.js', fileURLToPath(import.meta.resolve('@highlightjs/cdn-assets/es/highlight.min.js'))],
]);

/** @type {Readonly<Record<string, string>>} */
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const agentIdPattern = /^[0-9a-z]{1,64}$/i;

/**
 * @typedef {{ liveState: (sessionId: string) => Promise<import('./composer.js').LiveState>, send: (sessionId: string, text: string) => Promise<import('./composer.js').SendOutcome>, interrupt: (sessionId: string) => Promise<import('./composer.js').SendOutcome> }} Composer
 * @typedef {{ name: string, version: string }} About
 */

/**
 * @param {{ root: string, host: string, port: number, pollMs: number, composer: Composer, bookmarks: import('./bookmarks.js').Bookmarks, about: About }} options
 *   about — package name and version for /api/health
 * @returns {Promise<{ port: number, close: () => void }>}
 */
export async function startServer({ root, host, port, pollMs, composer, bookmarks, about }) {
  const index = createSessionIndex(root, { summaryBudgetMs: 1500 });
  const build = await pageBuild();
  /** @type {Set<string>} */
  const allowedHosts = new Set();
  /** @type {Set<string>} */
  const allowedOrigins = new Set();
  const server = http.createServer((request, response) => {
    handle({ index, allowedHosts, allowedOrigins, pollMs, composer, bookmarks, about, build }, request, response).catch((error) => {
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
  return {
    port: address.port,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

/**
 * @typedef {{ index: ReturnType<typeof createSessionIndex>, allowedHosts: ReadonlySet<string>, allowedOrigins: ReadonlySet<string>, pollMs: number, composer: Composer, bookmarks: import('./bookmarks.js').Bookmarks, about: About, build: string }} Deps
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
  switch (url.pathname) {
    case '/api/health':
      // This reply tells the CLI that the port is held by the viewer itself, and which process to stop.
      return sendJson(response, { ...deps.about, pid: process.pid });
    case '/api/live':
      return withSession(url, response, async (id) => sendJson(response, await deps.composer.liveState(id)));
    case '/api/sessions':
      return sendJson(response, await deps.index.list());
    case '/api/subagents':
      return withSession(url, response, async (id) => sendJson(response, await deps.index.subagents(id)));
    case '/api/bookmarks':
      return withSession(url, response, async (id) => sendJson(response, await deps.bookmarks.list(id)));
    case '/api/stream':
      return withSession(url, response, async (id) => stream(deps, url, id, request, response));
    case '/api/file':
      return sendFile(url, response);
    case '/api/image':
      return withSession(url, response, async (id) => sendImage(deps, url, id, response));
    default:
      return servePage(deps.build, url.pathname, response);
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
  const body = await readJsonBody(request);
  const sessionId = isRecord(body) && typeof body.session === 'string' && sessionIdPattern.test(body.session) ? body.session : undefined;
  if (sessionId === undefined) {
    response.writeHead(400).end('Bad session id');
    return;
  }
  switch (url.pathname) {
    case '/api/send':
      return sendJson(response, await deps.composer.send(sessionId, isRecord(body) && typeof body.text === 'string' ? body.text : ''));
    case '/api/interrupt':
      return sendJson(response, await deps.composer.interrupt(sessionId));
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

/** A body larger than this is not a prompt but something else. */
const maxBodyBytes = 256 * 1024;

/**
 * @param {http.IncomingMessage} request
 * @returns {Promise<unknown>} — undefined if the body is not JSON or is too large
 */
async function readJsonBody(request) {
  /** @type {Buffer[]} */
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    if (!(chunk instanceof Buffer)) continue;
    size += chunk.length;
    if (size > maxBodyBytes) return undefined;
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
  const zipped = acceptsGzip(response);
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    ...(zipped ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}),
  });
  response.flushHeaders();
  // A session's history is megabytes of text that gzip shrinks several times; every event is flushed at once.
  const out = zipped ? createGzip({ flush: zlibConstants.Z_SYNC_FLUSH }) : response;
  if (out !== response) out.pipe(response);
  const controller = new AbortController();
  const ping = setInterval(() => out.write(': ping\n\n'), 15_000);
  request.on('close', () => {
    controller.abort();
    clearInterval(ping);
  });
  await streamTranscript({
    locate: agentId === null ? () => deps.index.find(id) : () => deps.index.findSubagent(id, agentId),
    scope: agentId === null ? 'main' : 'subagent',
    imageUrl: (lineStart, n) => `/api/image?session=${id}${agentId === null ? '' : `&agent=${agentId}`}&at=${lineStart}&n=${n}`,
    send: (event, data) => out.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    signal: controller.signal,
    pollMs: deps.pollMs,
  });
  out.end();
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
 * @param {http.ServerResponse} response
 * @param {unknown} body
 * @param {number} [status]
 */
async function sendJson(response, body, status = 200) {
  await sendBody(response, status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, Buffer.from(JSON.stringify(body)));
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
 * @param {string} pathname
 * @param {http.ServerResponse} response
 */
async function servePage(build, pathname, response) {
  if (pathname === '/' || pathname === '/index.html') {
    const html = (await readFile(join(publicDir, 'index.html'), 'utf8')).replaceAll('{{assets}}', `/b/${build}`);
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
