import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { appendFile, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { startServer } from '../server/app.js';
import { createBookmarkFile } from '../server/bookmarks.js';
import { createUploads } from '../server/uploads.js';

const sessionId = '3f2c9a50-1111-4222-8333-944455556666';
const at = '2026-10-09T07:02:11.686Z';
/** @param {string} uuid @param {string} text */
const promptLine = (uuid, text) =>
  `${JSON.stringify({ type: 'user', uuid, timestamp: at, cwd: 'D:\\dev\\x', promptSource: 'typed', message: { role: 'user', content: text } })}\n`;

/**
 * A fake terminal sender: records calls, sends nothing to herdr.
 * @param {string} [takenBack] - the prompt Esc takes back into the box, as if Claude had not started on it
 */
function fakeComposer(takenBack) {
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
      /** @param {string} id @returns {Promise<import('../server/composer.js').StopReply>} */
      interrupt: async (id) => {
        calls.push(['interrupt', id]);
        return { ok: true, pane: 'w3D:p1', prompt: takenBack };
      },
      /** @param {string} id @param {import('../server/composer.js').RewindRequest} request @returns {Promise<import('../server/composer.js').RewindReply>} */
      rewind: async (id, request) => {
        calls.push(['rewind', id, JSON.stringify(request)]);
        return { ok: true, restoredPrompt: true };
      },
    },
  };
}

/** @param {import('node:test').TestContext} t @param {string} [takenBack] - see fakeComposer */
async function withServer(t, takenBack) {
  const root = await mkdtemp(join(tmpdir(), 'csv-'));
  const project = join(root, 'D--dev-x');
  await mkdir(project);
  const file = join(project, `${sessionId}.jsonl`);
  await writeFile(file, promptLine('u1', 'First question'));
  const { composer, calls } = fakeComposer(takenBack);
  const server = await startServer({ root, host: '127.0.0.1', port: 0, pollMs: 30, composer, bookmarks: createBookmarkFile(join(root, 'bookmarks.json')), uploads: createUploads(join(root, 'uploads')), about: { name: 'claude-code-webview', version: '9.9.9' } });
  t.after(() => server.close());
  return { file, root, base: `http://127.0.0.1:${server.port}`, port: server.port, calls };
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

/** The start of a PNG file: the bytes do not have to form a whole picture, only to come back unchanged. */
const pngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
/**
 * @param {string} uuid
 * @param {string} mediaType
 */
const imageLine = (uuid, mediaType) =>
  `${JSON.stringify({ type: 'user', uuid, timestamp: at, cwd: 'D:\\dev\\x', promptSource: 'typed', message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: pngBytes.toString('base64') } }, { type: 'text', text: 'see the screenshot' }] } })}\n`;

/**
 * The link the stream sent instead of the image of the entry.
 * @param {string} base
 * @param {import('node:test').TestContext} t
 * @param {string} uuid
 * @returns {Promise<string>}
 */
async function streamedImageLink(base, t, uuid) {
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${base}/api/stream?session=${sessionId}`, { signal: controller.signal });
  assert.ok(response.body);
  const { data } = await sseEvents(response.body)();
  const entry = data.find((/** @type {{ uuid: string }} */ e) => e.uuid === uuid);
  return entry.message.content[0].source.url;
}

test('stream_Should_SendImageAsLinkThatServerAnswersWithImageBytes', async (t) => {
  const { file, base } = await withServer(t);
  await appendFile(file, imageLine('u2', 'image/png'));

  const link = await streamedImageLink(base, t, 'u2');
  const image = await fetch(`${base}${link}`);

  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), pngBytes);
});

test('image_Should_RefuseOffsetInsideLineMissingImageAndImageThatCouldRunScript', async (t) => {
  const { file, base } = await withServer(t);
  await appendFile(file, imageLine('u2', 'image/png'));
  await appendFile(file, imageLine('u3', 'image/svg+xml'));
  const link = new URL(await streamedImageLink(base, t, 'u2'), base);
  const svg = new URL(await streamedImageLink(base, t, 'u3'), base);
  /** @param {URL} url @param {string} name @param {string} value */
  const changed = (url, name, value) => {
    const copy = new URL(url);
    copy.searchParams.set(name, value);
    return copy;
  };

  const statuses = await Promise.all(
    [changed(link, 'at', String(Number(link.searchParams.get('at')) + 5)), changed(link, 'n', '1'), svg].map(async (url) => (await fetch(url)).status),
  );

  assert.deepEqual(statuses, [404, 404, 415]);
});

/**
 * A GET whose body comes back as raw bytes, compressed or not.
 * @param {number} port
 * @param {string} path
 * @param {Record<string, string>} headers
 * @returns {Promise<{ status: number | undefined, headers: http.IncomingHttpHeaders, body: Buffer }>}
 */
function rawGet(port, path, headers) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path, headers }, (response) => {
        /** @type {Buffer[]} */
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      })
      .on('error', reject);
  });
}

test('server_Should_GzipRepliesForBrowsersThatAcceptIt', async (t) => {
  const { port } = await withServer(t);

  const [zipped, plain] = await Promise.all([rawGet(port, '/app.js', { 'accept-encoding': 'gzip, deflate, br' }), rawGet(port, '/app.js', {})]);

  assert.equal(zipped.headers['content-encoding'], 'gzip');
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.ok(zipped.body.length < plain.body.length / 2, 'the page script did not get smaller');
  assert.deepEqual(gunzipSync(zipped.body), plain.body);
});

test('stream_Should_DeliverEachGzippedEventWithoutWaitingForMore', async (t) => {
  const { base } = await withServer(t);
  const controller = new AbortController();
  t.after(() => controller.abort());

  // fetch unzips by itself; the events must arrive while the stream stays open
  const response = await fetch(`${base}/api/stream?session=${sessionId}`, { headers: { 'accept-encoding': 'gzip' }, signal: controller.signal });
  assert.equal(response.headers.get('content-encoding'), 'gzip');
  assert.ok(response.body);
  const next = sseEvents(response.body);

  assert.equal((await next()).event, 'entries');
  assert.equal((await next()).event, 'ready');
});

test('server_Should_AnswerUnchangedPageFileWithNotModified', async (t) => {
  const { port } = await withServer(t);

  const first = await rawGet(port, '/style.css', {});
  const again = await rawGet(port, '/style.css', { 'if-none-match': String(first.headers.etag) });

  assert.equal(first.status, 200);
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);
});

/** @param {string} html */
const buildOf = (html) => /\/b\/([0-9a-f]+)\/app\.js/.exec(html)?.[1];

test('page_Should_LinkItsFilesUnderCurrentBuildSoNoCacheCanServeOldOnes', async (t) => {
  const { port } = await withServer(t);

  const page = await rawGet(port, '/', {});
  const html = page.body.toString('utf8');
  const build = buildOf(html);

  assert.ok(build, 'the page script is not under a build path');
  for (const file of ['style.css', 'app.js', 'favicon.svg', 'vendor/marked.js', 'vendor/purify.js', 'vendor/highlight.js']) {
    assert.ok(html.includes(`/b/${build}/${file}`), `${file} is not under the build path`);
  }
  assert.equal(page.headers['cache-control'], 'no-store');
  const [plain, built] = await Promise.all([rawGet(port, '/app.js', {}), rawGet(port, `/b/${build}/app.js`, {})]);
  assert.equal(built.status, 200);
  assert.deepEqual(built.body, plain.body);
  assert.match(String(built.headers['cache-control']), /immutable/);
});

test('api_Should_NameBuildSoOpenPageNoticesUpdate', async (t) => {
  const { port, base } = await withServer(t);
  const build = buildOf((await rawGet(port, '/', {})).body.toString('utf8'));

  const sessions = await fetch(`${base}/api/sessions`);

  assert.equal(sessions.headers.get('x-viewer-build'), build);
});

test('send_Should_SaveAttachedImageAndSendItsPathAfterText', async (t) => {
  const { port, base, calls } = await withServer(t);
  const body = JSON.stringify({ session: sessionId, text: 'Why is the legend cut off?', images: [{ mediaType: 'image/png', data: pngBytes.toString('base64') }] });

  const response = await post(port, '/api/send', pageHeaders(port), body);

  assert.equal(response.status, 200);
  const sent = calls[0]?.[2] ?? '';
  const path = /^Why is the legend cut off\?\n\nAttached images:\n(.+\.png)$/.exec(sent)?.[1];
  assert.ok(path, `the prompt does not end with the image path: ${sent}`);
  assert.deepEqual(await readFile(path), pngBytes);
  const served = await fetch(`${base}/api/upload/${basename(path)}`);
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), pngBytes);
});

test('send_Should_RefuseImagesItCannotSafelyShowAndSaveNothing', async (t) => {
  const { port, root, calls } = await withServer(t);
  const attempts = [
    [{ mediaType: 'image/svg+xml', data: Buffer.from('<svg onload="alert(1)"/>').toString('base64') }],
    [{ mediaType: 'image/png', data: 12345 }],
    'not a list',
  ];

  const statuses = await Promise.all(
    attempts.map(async (images) => (await post(port, '/api/send', pageHeaders(port), JSON.stringify({ session: sessionId, text: 'Look', images }))).status),
  );

  assert.deepEqual(statuses, [400, 400, 400]);
  assert.deepEqual(calls, []);
  assert.deepEqual(await readdir(join(root, 'uploads')).catch(() => []), []);
});

test('upload_Should_ServeOnlyImagesTheViewerSaved', async (t) => {
  const { base, root } = await withServer(t);
  await mkdir(join(root, 'uploads'), { recursive: true });
  await writeFile(join(root, 'outside.png'), pngBytes);
  await writeFile(join(root, 'uploads', 'notes.txt'), 'not an image');

  const statuses = await Promise.all(['/api/upload/..%2Foutside.png', '/api/upload/missing.png', '/api/upload/notes.txt'].map(async (path) => (await fetch(`${base}${path}`)).status));

  assert.deepEqual(statuses, [404, 404, 404]);
});

/** @param {string} uuid @param {string} parentUuid @param {string} text */
const childPrompt = (uuid, parentUuid, text) =>
  `${JSON.stringify({ type: 'user', uuid, parentUuid, timestamp: at, promptSource: 'typed', message: { role: 'user', content: text } })}\n`;
/** @param {string} uuid @param {string} parentUuid */
const answerLine = (uuid, parentUuid) =>
  `${JSON.stringify({ type: 'assistant', uuid, parentUuid, timestamp: at, message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: `answer ${uuid}` }] } })}\n`;

/**
 * @param {string} base
 * @param {import('node:test').TestContext} t
 * @param {string} [query] - more of the query string, from "&"
 */
async function openStream(base, t, query = '') {
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${base}/api/stream?session=${sessionId}${query}`, { signal: controller.signal });
  assert.ok(response.body);
  return sseEvents(response.body);
}

/** @param {{ data: unknown }} event */
const uuids = (event) => (Array.isArray(event.data) ? event.data.map((/** @type {{ uuid: string }} */ entry) => entry.uuid) : []);

test('stream_Should_ShowOnlyActiveBranchOfRewoundConversation', async (t) => {
  const { file, base } = await withServer(t);
  // u1 is the first prompt; p2 was rewound and p3 sent from the same point instead
  await appendFile(file, answerLine('a1', 'u1') + childPrompt('p2', 'a1', 'Now test it') + answerLine('a2', 'p2') + childPrompt('p3', 'a1', 'Now test it properly'));

  const next = await openStream(base, t);

  assert.deepEqual(uuids(await next()), ['u1', 'a1', 'p3']);
});

test('stream_Should_RebuildFeedWhenSessionIsRewoundWhileOpen', async (t) => {
  const { file, base } = await withServer(t);
  await appendFile(file, answerLine('a1', 'u1') + childPrompt('p2', 'a1', 'Now test it') + answerLine('a2', 'p2'));
  const next = await openStream(base, t);
  assert.deepEqual(uuids(await next()), ['u1', 'a1', 'p2', 'a2']);
  assert.equal((await next()).event, 'ready');

  await appendFile(file, childPrompt('p3', 'a1', 'Now test it properly'));

  assert.equal((await next()).event, 'reset');
  assert.deepEqual(uuids(await next()), ['u1', 'a1', 'p3']);
});

test('rewind_Should_RewindToChosenMessageAndHideItsBranchFromFeedAtOnce', async (t) => {
  const { file, base, port, calls } = await withServer(t);
  await appendFile(file, answerLine('a1', 'u1') + childPrompt('p2', 'a1', 'Now test it') + answerLine('a2', 'p2'));
  const next = await openStream(base, t);
  assert.deepEqual(uuids(await next()), ['u1', 'a1', 'p2', 'a2']);
  assert.equal((await next()).event, 'ready');

  const response = await post(port, '/api/rewind', pageHeaders(port), JSON.stringify({ session: sessionId, prompt: 'p2', action: 'conversation' }));

  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, prompt: 'Now test it' });
  assert.deepEqual(calls, [['rewind', sessionId, JSON.stringify({ stepsUp: 1, prompt: 'Now test it', action: 'conversation' })]]);
  // the terminal no longer shows the rewound messages, so neither does the page
  assert.equal((await next()).event, 'reset');
  assert.deepEqual(uuids(await next()), ['u1', 'a1']);
});

test('rewind_Should_RefuseUnknownMessageOrActionWithoutTouchingTerminal', async (t) => {
  const { file, port, calls } = await withServer(t);
  await appendFile(file, answerLine('a1', 'u1'));
  /** @param {unknown} request */
  const rewind = (request) => post(port, '/api/rewind', pageHeaders(port), JSON.stringify({ session: sessionId, ...Object(request) }));

  const replies = await Promise.all([rewind({ prompt: 'a1', action: 'conversation' }), rewind({ prompt: 'u1', action: 'delete' })]);

  assert.deepEqual(replies.map((reply) => reply.status), [404, 400]);
  assert.deepEqual(calls, []);
});

test('interrupt_Should_HideStoppedPromptClaudeGaveBackFromFeedAtOnce', { timeout: 5000 }, async (t) => {
  const { file, base, port } = await withServer(t, 'Now test it');
  await appendFile(file, answerLine('a1', 'u1') + childPrompt('p2', 'a1', 'Now test it'));
  const next = await openStream(base, t);
  assert.deepEqual(uuids(await next()), ['u1', 'a1', 'p2']);
  assert.equal((await next()).event, 'ready');

  const response = await post(port, '/api/interrupt', pageHeaders(port), JSON.stringify({ session: sessionId }));

  assert.deepEqual(JSON.parse(response.body), { ok: true, pane: 'w3D:p1', prompt: 'Now test it' });
  // the terminal takes the prompt out of the conversation, so does the page
  assert.equal((await next()).event, 'reset');
  assert.deepEqual(uuids(await next()), ['u1', 'a1']);
});

test('branch_Should_ReadBranchCheckedOutInSessionFolderNotOneTranscriptRecorded', async (t) => {
  const { file, base } = await withServer(t);
  const repo = await mkdtemp(join(tmpdir(), 'csv-repo-'));
  await mkdir(join(repo, '.git'));
  await writeFile(join(repo, '.git', 'HEAD'), 'ref: refs/heads/feat/header\n');
  // Claude Code records the branch it saw first; the session moved to another folder with /cd
  await appendFile(file, `${JSON.stringify({ type: 'user', uuid: 'u2', timestamp: at, cwd: repo, gitBranch: 'HEAD', message: { role: 'user', content: 'Next' } })}\n`);

  const response = await fetch(`${base}/api/branch?session=${sessionId}`);

  assert.deepEqual(await response.json(), { branch: 'feat/header' });
});

test('sessions_Should_SendOnlySessionsChangedSinceVersionPageHas', async (t) => {
  const { file, base } = await withServer(t);
  /** @param {string} since */
  const changes = async (since) => (await fetch(`${base}/api/sessions?since=${since}`)).json();
  await new Promise((resolve) => setTimeout(resolve, 5));

  const first = await changes('');
  await new Promise((resolve) => setTimeout(resolve, 5));
  const quiet = await changes(String(first.version));
  await appendFile(file, promptLine('u2', 'Next question'));
  const written = await changes(String(quiet.version));

  assert.deepEqual([first.sessions.map((/** @type {{ id: string }} */ session) => session.id), quiet.sessions, written.sessions.map((/** @type {{ id: string }} */ session) => session.id)], [[sessionId], [], [sessionId]]);
  assert.equal(written.total, 1);
});

test('stream_Should_SendOnlyLatestEntriesOfLongSessionAndCountEarlierOnes', async (t) => {
  const { file, base } = await withServer(t);
  await appendFile(file, answerLine('a1', 'u1') + childPrompt('p2', 'a1', 'Second question') + answerLine('a2', 'p2'));

  const next = await openStream(base, t, '&tail=2');

  assert.deepEqual(await next(), { event: 'earlier', data: { count: 2 } });
  assert.deepEqual(uuids(await next()), ['p2', 'a2']);
  assert.equal((await next()).event, 'ready');
});

test('entry_Should_GiveWholeEntryWhoseToolOutputTheStreamLeftOut', async (t) => {
  const { file, base } = await withServer(t);
  const output = 'x'.repeat(5000);
  const readCall = { type: 'assistant', uuid: 'c1', parentUuid: 'u1', timestamp: at, message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'D:\\x\\a.cs' } }] } };
  const readResult = { type: 'user', uuid: 'r1', parentUuid: 'c1', timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: output }] }, toolUseResult: { type: 'text', file: { filePath: 'D:\\x\\a.cs', content: output, numLines: 120 } } };
  await appendFile(file, `${JSON.stringify(readCall)}\n${JSON.stringify(readResult)}\n`);
  const next = await openStream(base, t);
  const lite = (await next()).data.find((/** @type {{ uuid: string }} */ entry) => entry.uuid === 'r1');

  const whole = await (await fetch(`${base}/api/entry?session=${sessionId}&at=${lite.full}`)).json();
  const inside = await fetch(`${base}/api/entry?session=${sessionId}&at=${lite.full + 1}`);

  assert.equal(lite.message.content[0].deferred.meta, '120 lines');
  assert.deepEqual([whole.toolUseResult.file.numLines, whole.message.content[0].content], [120, output]);
  assert.equal(inside.status, 404);
});
