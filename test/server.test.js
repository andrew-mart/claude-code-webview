import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/app.js';
import { createBookmarkFile } from '../server/bookmarks.js';

const sessionId = '3f2c9a50-1111-4222-8333-944455556666';
const at = '2026-10-09T07:02:11.686Z';
/** @param {string} uuid @param {string} text */
const promptLine = (uuid, text) =>
  `${JSON.stringify({ type: 'user', uuid, timestamp: at, cwd: 'D:\\dev\\x', promptSource: 'typed', message: { role: 'user', content: text } })}\n`;

/** A fake terminal sender: records calls, sends nothing to herdr. */
function fakeComposer() {
  /** @type {string[][]} */
  const calls = [];
  return {
    calls,
    composer: {
      /** @param {string} id @returns {Promise<import('../server/composer.js').LiveState>} */
      liveState: async (id) => {
        calls.push(['liveState', id]);
        return { state: 'live', status: 'idle', pane: 'w3D:p1' };
      },
      /** @param {string} id @param {string} text @returns {Promise<import('../server/composer.js').SendOutcome>} */
      send: async (id, text) => {
        calls.push(['send', id, text]);
        return { ok: true, pane: 'w3D:p1' };
      },
      /** @param {string} id @returns {Promise<import('../server/composer.js').SendOutcome>} */
      interrupt: async (id) => {
        calls.push(['interrupt', id]);
        return { ok: true, pane: 'w3D:p1' };
      },
    },
  };
}

/** @param {import('node:test').TestContext} t */
async function withServer(t) {
  const root = await mkdtemp(join(tmpdir(), 'csv-'));
  const project = join(root, 'D--dev-x');
  await mkdir(project);
  const file = join(project, `${sessionId}.jsonl`);
  await writeFile(file, promptLine('u1', 'First question'));
  const { composer, calls } = fakeComposer();
  const server = await startServer({ root, host: '127.0.0.1', port: 0, pollMs: 30, composer, bookmarks: createBookmarkFile(join(root, 'bookmarks.json')), about: { name: 'claude-code-webview', version: '9.9.9' } });
  t.after(() => server.close());
  return { file, base: `http://127.0.0.1:${server.port}`, port: server.port, calls };
}

/**
 * POST to the server with headers set by hand (fetch in Node does not pass all of them through).
 * @param {number} port
 * @param {string} path
 * @param {Record<string, string>} headers
 * @param {string} body
 * @returns {Promise<{ status: number | undefined, body: string }>}
 */
function post(port, path, headers, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        text += chunk;
      });
      response.on('end', () => resolve({ status: response.statusCode, body: text }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

/** @param {number} port */
const pageHeaders = (port) => ({ 'content-type': 'application/json', origin: `http://127.0.0.1:${port}`, 'x-viewer': '1' });

test('send_Should_PassTextFromViewerPageToSessionTerminal', async (t) => {
  const { port, calls } = await withServer(t);

  const response = await post(port, '/api/send', pageHeaders(port), JSON.stringify({ session: sessionId, text: 'Go on' }));

  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, pane: 'w3D:p1' });
  assert.deepEqual(calls, [['send', sessionId, 'Go on']]);
});

test('send_Should_RejectRequestsThatOtherSitesCouldForge', async (t) => {
  const { port, calls } = await withServer(t);
  const body = JSON.stringify({ session: sessionId, text: 'rm -rf' });
  const { origin, ...withoutOrigin } = pageHeaders(port);

  const forged = await Promise.all([
    post(port, '/api/send', { ...pageHeaders(port), origin: 'https://evil.example' }, body),
    post(port, '/api/send', withoutOrigin, body),
    post(port, '/api/send', { ...pageHeaders(port), 'x-viewer': '' }, body),
    post(port, '/api/send', { ...pageHeaders(port), 'content-type': 'text/plain' }, body),
  ]);

  assert.deepEqual(forged.map((response) => response.status), [403, 403, 403, 403]);
  assert.deepEqual(calls, []);
});

test('health_Should_NameViewerAndItsProcessSoCommandCanStopIt', async (t) => {
  const { base } = await withServer(t);

  const response = await fetch(`${base}/api/health`);

  assert.deepEqual(await response.json(), { name: 'claude-code-webview', version: '9.9.9', pid: process.pid });
});

test('live_Should_ReportWhetherSessionCanReceiveText', async (t) => {
  const { base } = await withServer(t);

  const response = await fetch(`${base}/api/live?session=${sessionId}`);

  assert.deepEqual(await response.json(), { state: 'live', status: 'idle', pane: 'w3D:p1' });
});

/**
 * Reads an SSE stream and returns events one at a time.
 * @param {ReadableStream<Uint8Array>} body
 */
function sseEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return async function next() {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (event !== undefined) return { event, data: data === undefined ? undefined : JSON.parse(data) };
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('stream ended');
      buffer += decoder.decode(value, { stream: true });
    }
  };
}

test('stream_Should_SendExistingEntriesThenLinesAppendedLater', async (t) => {
  const { file, base } = await withServer(t);
  const controller = new AbortController();
  t.after(() => controller.abort());

  const response = await fetch(`${base}/api/stream?session=${sessionId}`, { signal: controller.signal });
  assert.ok(response.body);
  const next = sseEvents(response.body);

  const initial = await next();
  assert.equal(initial.event, 'entries');
  assert.deepEqual(initial.data.map((/** @type {{ uuid: string }} */ e) => e.uuid), ['u1']);
  assert.equal((await next()).event, 'ready');

  await appendFile(file, promptLine('u2', 'Second question'));
  const appended = await next();
  assert.equal(appended.event, 'entries');
  assert.deepEqual(appended.data.map((/** @type {{ uuid: string }} */ e) => e.uuid), ['u2']);
});

test('sessions_Should_ListSessionWithTitleAndFolder', async (t) => {
  const { base } = await withServer(t);

  const response = await fetch(`${base}/api/sessions`);
  const sessions = await response.json();

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, sessionId);
  assert.equal(sessions[0].title, 'First question');
  assert.equal(sessions[0].cwd, 'D:\\dev\\x');
});

test('file_Should_ReturnTextForPanelAndNotFoundForMissingFile', async (t) => {
  const { file, base } = await withServer(t);

  const found = await fetch(`${base}/api/file?path=${encodeURIComponent(file)}`);
  const missing = await fetch(`${base}/api/file?path=${encodeURIComponent(`${file}.missing`)}`);

  assert.equal(found.status, 200);
  assert.equal((await found.json()).content, promptLine('u1', 'First question'));
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { ok: false, error: 'not-found' });
});

test('server_Should_RejectRequestForForeignHost', async (t) => {
  const { port } = await withServer(t);

  const status = await new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/api/sessions', headers: { host: 'evil.example:80' } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on('error', reject);
  });

  assert.equal(status, 403);
});

/** @type {import('../public/model/bookmarks.js').Bookmark} */
const report = { id: 'a1:0', kind: 'answer', label: 'Test results', at: '2026-10-09T10:05:00.000Z' };

test('bookmarks_Should_KeepBookmarkAddedOnViewerPageForEveryLaterRequest', async (t) => {
  const { base, port } = await withServer(t);

  const added = await post(port, '/api/bookmarks', pageHeaders(port), JSON.stringify({ session: sessionId, change: { action: 'add', bookmark: report } }));
  const listed = await fetch(`${base}/api/bookmarks?session=${sessionId}`);

  assert.equal(added.status, 200);
  assert.deepEqual(await listed.json(), [report]);
});

test('bookmarks_Should_RejectChangeOfUnknownShape', async (t) => {
  const { port } = await withServer(t);
  const malformed = [{ action: 'add', bookmark: { id: 1 } }, { action: 'rename', id: 'a1:0' }, undefined];

  const responses = await Promise.all(malformed.map((change) => post(port, '/api/bookmarks', pageHeaders(port), JSON.stringify({ session: sessionId, change }))));

  assert.deepEqual(responses.map((response) => response.status), [400, 400, 400]);
});
