// @ts-check
// The viewer's HTTP server: static files, the session list, the stream of transcript entries.
// Transcripts contain everything the agent saw, secrets included, so the server listens only on a local address
// and answers only requests whose Host is that address: a page from another site cannot read it via DNS rebinding.
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { homedir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../public/model/narrow.js';
import { readTextFile } from './files.js';
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
 * @param {{ root: string, host: string, port: number, pollMs: number, composer: Composer, about: About }} options
 *   about — package name and version for /api/health
 * @returns {Promise<{ port: number, close: () => void }>}
 */
export async function startServer({ root, host, port, pollMs, composer, about }) {
  const index = createSessionIndex(root, { summaryBudgetMs: 1500 });
  /** @type {Set<string>} */
  const allowedHosts = new Set();
  /** @type {Set<string>} */
  const allowedOrigins = new Set();
  const server = http.createServer((request, response) => {
    handle({ index, allowedHosts, allowedOrigins, pollMs, composer, about }, request, response).catch((error) => {
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
 * @typedef {{ index: ReturnType<typeof createSessionIndex>, allowedHosts: ReadonlySet<string>, allowedOrigins: ReadonlySet<string>, pollMs: number, composer: Composer, about: About }} Deps
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
    case '/api/stream':
      return withSession(url, response, async (id) => stream(deps, url, id, request, response));
    case '/api/file':
      return sendFile(url, response);
    default:
      return serveFile(url.pathname, response);
  }
}

/**
 * Writing to a session's terminal is the only thing the server does besides reading; sessions run
 * with permission to execute commands. So the request is accepted only from the viewer's own page:
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
  response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  response.flushHeaders();
  const controller = new AbortController();
  const ping = setInterval(() => response.write(': ping\n\n'), 15_000);
  request.on('close', () => {
    controller.abort();
    clearInterval(ping);
  });
  await streamTranscript({
    locate: agentId === null ? () => deps.index.find(id) : () => deps.index.findSubagent(id, agentId),
    scope: agentId === null ? 'main' : 'subagent',
    send: (event, data) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    signal: controller.signal,
    pollMs: deps.pollMs,
  });
  response.end();
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
 * @param {http.ServerResponse} response
 * @param {unknown} body
 * @param {number} [status]
 */
function sendJson(response, body, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

/**
 * @param {string} pathname
 * @param {http.ServerResponse} response
 */
async function serveFile(pathname, response) {
  const file = vendor.get(pathname) ?? publicFile(pathname === '/' ? '/index.html' : pathname);
  const body = file === undefined ? undefined : await readFile(file).catch(() => undefined);
  if (file === undefined || body === undefined) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  response.end(body);
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
