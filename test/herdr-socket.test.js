import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHerdrSocket, socketAddress, socketRunner } from '../server/herdr-socket.js';

/**
 * A server that answers as herdr does: one JSON line in, one JSON line out, and the connection closed. Remembers the
 * requests and the most connections that were open at once.
 * @param {import('node:test').TestContext} t
 * @param {(request: { id: string, method: string, params: Record<string, unknown> }) => Record<string, unknown>} answer —
 *   the reply line, without the id
 */
async function fakeHerdr(t, answer) {
  const socketPath = join(await mkdtemp(join(tmpdir(), 'ccw-herdr-')), 'herdr.sock');
  /** @type {{ method: string, params: Record<string, unknown> }[]} */
  const requests = [];
  let open = 0;
  let mostOpen = 0;
  const server = createServer((socket) => {
    open++;
    mostOpen = Math.max(mostOpen, open);
    socket.on('close', () => open--);
    let text = '';
    socket.on('data', (chunk) => {
      text += chunk.toString('utf8');
      if (!text.includes('\n')) return;
      const request = JSON.parse(text);
      requests.push({ method: request.method, params: request.params });
      // herdr takes a moment to answer
      setTimeout(() => socket.end(`${JSON.stringify({ id: request.id, ...answer(request) })}\n`), 5);
    });
  });
  await new Promise((resolve) => server.listen(socketAddress(socketPath), () => resolve(undefined)));
  t.after(() => server.close());
  return { socketPath, requests, mostOpen: () => mostOpen };
}

test('request_Should_SendMethodAndParams_AndGiveResult', async (t) => {
  const herdr = await fakeHerdr(t, () => ({ result: { type: 'ok' } }));

  const reply = await createHerdrSocket(herdr.socketPath).request('pane.send_text', { pane_id: 'w2:p2', text: 'ls\r' });

  assert.deepEqual(reply, { ok: true, result: { type: 'ok' } });
  assert.deepEqual(herdr.requests, [{ method: 'pane.send_text', params: { pane_id: 'w2:p2', text: 'ls\r' } }]);
});

// herdr serves one connection at a time: a second one opened meanwhile waits for it (a tenth of a second on Windows)
test('request_Should_AskOneAtATime_InOrderAsked', async (t) => {
  const herdr = await fakeHerdr(t, (request) => ({ result: { echo: request.params.n } }));
  const socket = createHerdrSocket(herdr.socketPath);

  const replies = await Promise.all([1, 2, 3].map((n) => socket.request('ping', { n })));

  assert.deepEqual(
    replies.map((reply) => reply.ok && reply.result),
    [{ echo: 1 }, { echo: 2 }, { echo: 3 }],
  );
  assert.equal(herdr.mostOpen(), 1);
});

test('request_Should_TellHerdrsErrorAndAbsentHerdr', async (t) => {
  const herdr = await fakeHerdr(t, () => ({ error: { code: 'pane_not_found', message: 'no pane w9:p9' } }));

  const refused = await createHerdrSocket(herdr.socketPath).request('pane.read', { pane_id: 'w9:p9' });
  const nobody = await createHerdrSocket(join(tmpdir(), 'no-herdr-here', 'herdr.sock')).request('ping', {});

  assert.deepEqual(refused, { ok: false, error: 'pane_not_found: no pane w9:p9' });
  assert.equal(nobody.ok, false);
});

// The viewer's herdr commands go through the socket — a millisecond or two each, where starting the herdr program takes a
// tenth of a second — and come back as the program prints them: its JSON, or the screen's text for pane read
test('socketRunner_Should_AskSocketForViewersCommands_AnsweringAsProgramPrints', async (t) => {
  const herdr = await fakeHerdr(t, (request) => (request.method === 'pane.read' ? { result: { type: 'pane_read', read: { text: `screen in ${request.params.format}` } } } : { result: { type: 'ok', asked: request.method } }));
  const run = socketRunner(createHerdrSocket(herdr.socketPath), async () => ({ ok: false, error: 'the program was started', missing: false }));

  const replies = [
    await run(['api', 'snapshot']),
    await run(['pane', 'list']),
    await run(['pane', 'process-info', '--pane', 'w2:p1']),
    await run(['pane', 'send-text', 'w2:p1', 'Go on']),
    await run(['pane', 'send-keys', 'w2:p1', 'esc', 'enter']),
    await run(['pane', 'read', 'w2:p1', '--source', 'visible', '--format', 'text']),
    await run(['pane', 'read', 'w2:p2', '--source', 'visible', '--format', 'ansi']),
  ];

  assert.deepEqual(herdr.requests, [
    { method: 'session.snapshot', params: {} },
    { method: 'pane.list', params: {} },
    { method: 'pane.process_info', params: { pane_id: 'w2:p1' } },
    { method: 'pane.send_text', params: { pane_id: 'w2:p1', text: 'Go on' } },
    { method: 'pane.send_keys', params: { pane_id: 'w2:p1', keys: ['esc', 'enter'] } },
    { method: 'pane.read', params: { pane_id: 'w2:p1', source: 'visible', format: 'text', strip_ansi: true } },
    { method: 'pane.read', params: { pane_id: 'w2:p2', source: 'visible', format: 'ansi', strip_ansi: false } },
  ]);
  assert.deepEqual(replies, [
    { ok: true, json: { result: { type: 'ok', asked: 'session.snapshot' } }, text: '' },
    { ok: true, json: { result: { type: 'ok', asked: 'pane.list' } }, text: '' },
    { ok: true, json: { result: { type: 'ok', asked: 'pane.process_info' } }, text: '' },
    { ok: true, json: { result: { type: 'ok', asked: 'pane.send_text' } }, text: '' },
    { ok: true, json: { result: { type: 'ok', asked: 'pane.send_keys' } }, text: '' },
    { ok: true, json: undefined, text: 'screen in text' },
    { ok: true, json: undefined, text: 'screen in ansi' },
  ]);
});

test('socketRunner_Should_LeaveOtherCommandsToProgram_AndTellRefusal', async (t) => {
  const herdr = await fakeHerdr(t, () => ({ error: { code: 'pane_not_found', message: 'no pane w9:p9' } }));
  /** @type {string[][]} */
  const started = [];
  const run = socketRunner(createHerdrSocket(herdr.socketPath), async (args) => {
    started.push([...args]);
    return { ok: true, json: { result: { type: 'ok' } }, text: '' };
  });

  const other = await run(['tab', 'create', '--workspace', 'w2']);
  const refused = await run(['pane', 'send-text', 'w9:p9', 'x']);

  assert.deepEqual(started, [['tab', 'create', '--workspace', 'w2']]);
  assert.deepEqual([other.ok, refused], [true, { ok: false, error: 'pane_not_found: no pane w9:p9', missing: false }]);
});

// The page's terminal waits for nothing: its reads and keys go before the requests queued for the sidebar
test('request_Should_AskForScreenAndKeysFirst_BeforeQueuedBackgroundRequests', async (t) => {
  const herdr = await fakeHerdr(t, () => ({ result: { type: 'ok' } }));
  const socket = createHerdrSocket(herdr.socketPath);

  await Promise.all([
    socket.request('session.snapshot', {}),
    socket.request('pane.process_info', { pane_id: 'w2:p1' }),
    socket.request('pane.process_info', { pane_id: 'w2:p2' }),
    socket.request('pane.send_text', { pane_id: 'w3:p1', text: 'l' }),
    socket.request('pane.read', { pane_id: 'w3:p1' }),
  ]);

  assert.deepEqual(
    herdr.requests.map((request) => request.method),
    ['session.snapshot', 'pane.send_text', 'pane.read', 'pane.process_info', 'pane.process_info'],
  );
});
