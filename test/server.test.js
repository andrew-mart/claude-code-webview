import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { appendFile, mkdir, mkdtemp, readdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { palettes } from '../public/model/palettes.js';
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
        return { state: 'live', status: 'idle', pane: 'w3D:p1', dialog: undefined };
      },
      /** @param {string} id @param {string} text @returns {Promise<import('../server/composer.js').SendOutcome>} */
      send: async (id, text) => {
        calls.push(['send', id, text]);
        return { ok: true, pane: 'w3D:p1' };
      },
      /** @param {string} id @param {string} text @returns {Promise<import('../server/composer.js').SendOutcome>} */
      sendNow: async (id, text) => {
        calls.push(['sendNow', id, text]);
        return { ok: true, pane: 'w3D:p1' };
      },
      /** @param {string} id @returns {Promise<import('../server/composer.js').StopReply>} */
      interrupt: async (id) => {
        calls.push(['interrupt', id]);
        return { ok: true, pane: 'w3D:p1', prompt: takenBack };
      },
      /** @param {string} id @param {readonly import('../public/model/dialog.js').DialogStep[]} steps @returns {Promise<import('../public/model/dialog.js').DialogReply>} */
      answer: async (id, steps) => {
        calls.push(['answer', id, JSON.stringify(steps)]);
        return { ok: true };
      },
      /** @param {string} id @param {string} question @returns {Promise<import('../server/composer.js').BtwReply>} */
      btw: async (id, question) => {
        calls.push(['btw', id, question]);
        return { ok: true, answer: 'In src/config.ts.' };
      },
      /** @param {string} id @param {import('../server/composer.js').RewindRequest} request @returns {Promise<import('../server/composer.js').RewindReply>} */
      rewind: async (id, request) => {
        calls.push(['rewind', id, JSON.stringify(request)]);
        return { ok: true, restoredPrompt: true };
      },
    },
  };
}

/** Where the session ran in herdr: the viewer tab of web, closed since. @type {import('../public/model/history.js').Place} */
const closedPlace = { workspace: 'web', tab: 'viewer', earlierTabs: [], folder: 'D:/dev/x', firstSeen: 1, lastSeen: 2, open: false, note: undefined };

/**
 * A command Claude ran in the background, as the transcript has it: the call, and the result naming its output file.
 * @param {string} output
 */
const backgroundCommand = (output) =>
  [
    { type: 'assistant', uuid: 'a2', timestamp: '2026-10-09T07:03:00.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_dev', name: 'Bash', input: { command: 'npm run dev', description: 'Start the dev server', run_in_background: true } }] } },
    { type: 'user', uuid: 'u3', timestamp: '2026-10-09T07:03:01.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_dev', content: `Command running in background with ID: bdev. Output is being written to: ${output}` }] }, toolUseResult: { stdout: '', backgroundTaskId: 'bdev' } },
  ]
    .map((entry) => `${JSON.stringify(entry)}\n`)
    .join('');

/** The account's usage as the viewer reads it: the 5-hour window and the week. */
const accountUsage = { fiveHour: { percent: 22, resetsAt: 1_000_000 }, sevenDay: { percent: 91, resetsAt: 2_000_000 }, readAt: 500 };

/** @type {import('../public/model/herdr.js').HerdrWorkspace} */
const webWorkspace = {
  id: 'w1',
  number: 1,
  label: 'web',
  status: 'working',
  activeTab: 'w1:t1',
  tabs: [{ id: 'w1:t1', number: 1, label: 'viewer', status: 'working', panes: [{ id: 'w1:p1', agent: 'claude', status: 'working', title: 'First question', session: sessionId, size: { cols: 120, rows: 40 }, activity: 7 }] }],
};

/**
 * @param {import('node:test').TestContext} t
 * @param {{ takenBack?: string, palette?: import('../public/model/palettes.js').Palette, publicAddresses?: readonly import('../server/app.js').PublicAddress[], sessionRunning?: boolean, editor?: 'set' | 'none' }} [options] - takenBack: see
 *   fakeComposer; palette, publicAddresses: what the viewer is started with; sessionRunning: whether Claude Code has the
 *   session open; editor: whether the viewer opens files in an editor — the files it is asked to open are recorded
 */
async function withServer(t, { takenBack, palette = 'clay', publicAddresses = [], sessionRunning = true, editor = 'set' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'csv-'));
  const project = join(root, 'D--dev-x');
  await mkdir(project);
  const file = join(project, `${sessionId}.jsonl`);
  await writeFile(file, promptLine('u1', 'First question'));
  const { composer, calls } = fakeComposer(takenBack);
  // herdr puts every listed session into the workspace "web", whose one tab runs the session
  // tabs renamed and closed are recorded
  /** @type {string[][]} */
  const tabChanges = [];
  /** @type {Pick<ReturnType<typeof import('../server/herdr-view.js').createHerdrView>, 'workspacesOf' | 'layout' | 'renameTab' | 'closeTab' | 'createTab' | 'createWorkspace' | 'history' | 'reopen'>} */
  const herdrView = {
    workspacesOf: async (listed) => ({ herdr: true, sessions: Object.fromEntries(listed.map(({ id }) => [id, 'web'])) }),
    layout: async () => ({ herdr: true, workspaces: [webWorkspace] }),
    history: async () => ({ [sessionId]: closedPlace }),
    reopen: async (session, cwd) => {
      tabChanges.push(['reopen', session, String(cwd)]);
      return { ok: true, target: `#/${session}` };
    },
    renameTab: async (tab, label) => {
      tabChanges.push(['rename', tab, label]);
      return { ok: true };
    },
    closeTab: async (tab) => {
      tabChanges.push(['close', tab]);
      return { ok: true };
    },
    createTab: async (beside, start, label) => {
      tabChanges.push(['create', beside, start, String(label)]);
      return { ok: true, target: '#/pane/w1:p2' };
    },
    createWorkspace: async (label, folder, start) => {
      tabChanges.push(['workspace', label, folder, start]);
      return { ok: true, target: '#/pane/w5:p1' };
    },
  };
  // A pane's terminal shows one screen and closes; the keys typed into a pane are recorded
  /** @type {string[][]} */
  const typed = [];
  /** @type {Pick<ReturnType<typeof import('../server/terminal.js').createTerminals>, 'stream' | 'type'>} */
  const terminals = {
    stream: async (pane, send) => {
      send('screen', { text: `\u001b[32m${pane}\u001b[0m $` });
      send('gone', { missing: false });
    },
    type: async (pane, data) => {
      typed.push([pane, data]);
      return { ok: true };
    },
  };
  // the editor opens what is asked; a file named missing.cs is not there
  /** @type {(string | number)[][]} */
  const opened = [];
  /** @type {import('../server/app.js').OpenEditor} */
  const openEditor = async (path, line) => {
    if (path.endsWith('missing.cs')) return { ok: false, error: 'not-a-file' };
    opened.push([path, line]);
    return { ok: true };
  };
  const server = await startServer({ root, host: '127.0.0.1', port: 0, pollMs: 30, composer, bookmarks: createBookmarkFile(join(root, 'bookmarks.json')), uploads: createUploads(join(root, 'uploads')), about: { name: 'claude-code-webview', version: '9.9.9' }, palette, publicAddresses, herdrView, terminals, usage: async () => accountUsage, isRunning: async (/** @type {string} */ id) => sessionRunning && id === sessionId, editor: editor === 'set' ? openEditor : undefined });
  t.after(() => server.close());
  return { file, root, base: `http://127.0.0.1:${server.port}`, port: server.port, calls, typed, tabChanges, opened };
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

// Sent now — Ctrl+Enter on the page while Claude works — the text and what waits in the queue go at once, an empty box
// sending the queue alone
test('send_Should_SendNow_WhenPageAsks', async (t) => {
  const { port, calls } = await withServer(t);

  const replies = await Promise.all([
    post(port, '/api/send', pageHeaders(port), JSON.stringify({ session: sessionId, text: 'Stop and check the logs', now: true })),
    post(port, '/api/send', pageHeaders(port), JSON.stringify({ session: sessionId, text: '', now: true })),
  ]);

  assert.deepEqual({ statuses: replies.map(({ status }) => status), calls: calls.toSorted() }, { statuses: [200, 200], calls: [['sendNow', sessionId, ''], ['sendNow', sessionId, 'Stop and check the logs']] });
});

// A side question from the page goes to the session's terminal, and its answer comes back to the page
test('btw_Should_PassSideQuestionFromViewerPage_And_GiveAnswerBack', async (t) => {
  const { port, calls } = await withServer(t);

  const response = await post(port, '/api/btw', pageHeaders(port), JSON.stringify({ session: sessionId, question: 'Where is the retry limit?' }));

  assert.deepEqual({ status: response.status, body: JSON.parse(response.body) }, { status: 200, body: { ok: true, answer: 'In src/config.ts.' } });
  assert.deepEqual(calls, [['btw', sessionId, 'Where is the retry limit?']]);
});

// A herdr tab named or closed from the page is named or closed in herdr; what is no tab id is refused before herdr
test('tabs_Should_PassRenameAndCloseFromViewerPage_And_RefuseWhatIsNoTab', async (t) => {
  const { port, tabChanges } = await withServer(t);

  const renamed = await post(port, '/api/tab/rename', pageHeaders(port), JSON.stringify({ tab: 'w1:t1', label: 'viewer' }));
  const closed = await post(port, '/api/tab/close', pageHeaders(port), JSON.stringify({ tab: 'w1:t1' }));
  const strange = await post(port, '/api/tab/close', pageHeaders(port), JSON.stringify({ tab: '../w1 t1' }));
  const nameless = await post(port, '/api/tab/rename', pageHeaders(port), JSON.stringify({ tab: 'w1:t1' }));

  assert.deepEqual(
    { replies: [renamed, closed].map((reply) => [reply.status, JSON.parse(reply.body)]), refused: [strange.status, nameless.status], tabChanges },
    { replies: [[200, { ok: true }], [200, { ok: true }]], refused: [400, 400], tabChanges: [['rename', 'w1:t1', 'viewer'], ['close', 'w1:t1']] },
  );
});

// An answer to Claude Code's question goes to the session's terminal as the keys and words the page sent; anything but
// a dialog's keys and one line of words is refused before the terminal
test('dialog_Should_PassAnswerFromViewerPage_And_RefuseOtherKeys', async (t) => {
  const { port, calls } = await withServer(t);
  const answer = [{ key: '3' }, { text: 'Purple' }, { key: 'enter' }];
  // beside previews an answer is gone to with the arrows
  const arrowed = [{ key: 'down' }, { key: 'up' }, { key: 'down' }, { key: 'enter' }];

  const answered = await post(port, '/api/dialog', pageHeaders(port), JSON.stringify({ session: sessionId, steps: answer }));
  const walked = await post(port, '/api/dialog', pageHeaders(port), JSON.stringify({ session: sessionId, steps: arrowed }));
  const refused = await Promise.all(
    [[{ key: 'ctrl+c' }], [{ text: 'two\nlines' }], []].map((steps) => post(port, '/api/dialog', pageHeaders(port), JSON.stringify({ session: sessionId, steps }))),
  );

  assert.deepEqual(
    { answered: [answered.status, JSON.parse(answered.body)], walked: walked.status, refused: refused.map((reply) => reply.status), calls },
    { answered: [200, { ok: true }], walked: 200, refused: [400, 400, 400], calls: [['answer', sessionId, JSON.stringify(answer)], ['answer', sessionId, JSON.stringify(arrowed)]] },
  );
});

// A new workspace is asked for with its name and folder, and a shell or Claude Code in it; anything else is refused
// before herdr
test('workspaces_Should_OpenNewWorkspace_And_RefuseUnknownStart', async (t) => {
  const { port, tabChanges } = await withServer(t);
  const ask = (/** @type {unknown} */ body) => post(port, '/api/workspace/new', pageHeaders(port), JSON.stringify(body));

  const opened = await ask({ label: 'billing', folder: 'D:/dev/billing', start: 'shell' });
  const strange = await Promise.all([ask({ label: 'billing', folder: 'D:/dev/billing', start: 'rm -rf' }), ask({ label: 'billing', start: 'shell' })]);

  assert.deepEqual(
    { opened: [opened.status, JSON.parse(opened.body)], strange: strange.map(({ status }) => status), tabChanges },
    { opened: [200, { ok: true, target: '#/pane/w5:p1' }], strange: [400, 400], tabChanges: [['workspace', 'billing', 'D:/dev/billing', 'shell']] },
  );
});

// A new tab is asked for beside the open one, under a name or none, with a shell or Claude Code in it; anything else is refused before herdr
test('tabs_Should_OpenNewTabBesideOne_And_RefuseUnknownStart', async (t) => {
  const { port, tabChanges } = await withServer(t);

  const opened = await post(port, '/api/tab/new', pageHeaders(port), JSON.stringify({ tab: 'w1:t1', start: 'claude', label: 'api' }));
  const unnamed = await post(port, '/api/tab/new', pageHeaders(port), JSON.stringify({ tab: 'w1:t1', start: 'shell' }));
  const strange = await post(port, '/api/tab/new', pageHeaders(port), JSON.stringify({ tab: 'w1:t1', start: 'rm -rf' }));

  assert.deepEqual(
    { opened: [opened.status, JSON.parse(opened.body)], unnamed: unnamed.status, strange: strange.status, tabChanges },
    { opened: [200, { ok: true, target: '#/pane/w1:p2' }], unnamed: 200, strange: 400, tabChanges: [['create', 'w1:t1', 'claude', 'api'], ['create', 'w1:t1', 'shell', 'undefined']] },
  );
});

// The page learns where sessions ran in herdr, closed ones included, to find them and open them again
test('history_Should_TellWhereSessionsRanInHerdr', async (t) => {
  const { base } = await withServer(t);

  const response = await fetch(`${base}/api/history`);

  assert.deepEqual({ status: response.status, history: await response.json() }, { status: 200, history: { [sessionId]: { workspace: 'web', tab: 'viewer', earlierTabs: [], folder: 'D:/dev/x', firstSeen: 1, lastSeen: 2, open: false } } });
});

// The page learns what a session runs in the background; what still ran when Claude Code closed the session was cut
// short with it
test('tasks_Should_TellWhatSessionRunsInBackground', async (t) => {
  const open = await withServer(t);
  const output = join(open.root, 'bdev.output');
  await writeFile(output, 'ready on :3000\n');
  await appendFile(open.file, backgroundCommand(output));
  const closed = await withServer(t, { sessionRunning: false });
  await appendFile(closed.file, backgroundCommand(join(closed.root, 'gone.output')));

  const replies = await Promise.all([open, closed].map(async ({ base }) => (await fetch(`${base}/api/tasks?session=${sessionId}`)).json()));

  const started = { id: 'toolu_dev', kind: 'shell', title: 'Start the dev server', detail: 'npm run dev', startedAt: '2026-10-09T07:03:00.000Z', taskId: 'bdev' };
  assert.deepEqual(replies, [[{ ...started, state: 'running', hasOutput: true }], [{ ...started, state: 'interrupted', hasOutput: false }]]);
});

// A subagent at work tells when it last wrote to its transcript: one silent for long has likely stopped without a word
test('tasks_Should_TellWhenSubagentLastWrote', async (t) => {
  const { file, base } = await withServer(t);
  const subagents = join(file.replace(/[.]jsonl$/, ''), 'subagents');
  await mkdir(subagents, { recursive: true });
  const transcript = join(subagents, 'agent-aroutes.jsonl');
  await writeFile(transcript, '{}');
  await utimes(transcript, new Date('2026-10-09T07:10:00.000Z'), new Date('2026-10-09T07:10:00.000Z'));
  const call = { type: 'assistant', uuid: 'a3', timestamp: '2026-10-09T07:04:00.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_routes', name: 'Agent', input: { description: 'Find the routes', subagent_type: 'Explore', prompt: 'Find them' } }] } };
  const launched = { type: 'user', uuid: 'u4', timestamp: '2026-10-09T07:04:01.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_routes', content: 'Async agent launched successfully.' }] }, toolUseResult: { status: 'async_launched', isAsync: true, agentId: 'aroutes' } };
  await appendFile(file, [call, launched].map((entry) => JSON.stringify(entry)).join(String.fromCharCode(10)) + String.fromCharCode(10));

  const tasks = await (await fetch(`${base}/api/tasks?session=${sessionId}`)).json();

  assert.deepEqual(tasks, [{ id: 'toolu_routes', kind: 'agent', title: 'Find the routes', detail: 'Explore', startedAt: '2026-10-09T07:04:00.000Z', state: 'running', taskId: 'aroutes', hasOutput: false, lastActiveAt: '2026-10-09T07:10:00.000Z' }]);
});

// A command's output in the background, as it grows: the page reads on from where it stopped; only the session's own
// background commands are read
test('taskOutput_Should_ReadCommandOutputOnFromWherePageStopped', async (t) => {
  const { root, file, base } = await withServer(t);
  const output = join(root, 'bdev.output');
  await writeFile(output, 'compiling\n');
  await appendFile(file, backgroundCommand(output));

  const first = await (await fetch(`${base}/api/tasks/output?session=${sessionId}&task=toolu_dev`)).json();
  await appendFile(output, 'ready on :3000\n');
  const next = await (await fetch(`${base}/api/tasks/output?session=${sessionId}&task=toolu_dev&from=10`)).json();
  const other = await fetch(`${base}/api/tasks/output?session=${sessionId}&task=toolu_other`);

  assert.deepEqual([first, next, other.status], [{ text: 'compiling\n', from: 0, size: 10 }, { text: 'ready on :3000\n', from: 10, size: 25 }, 404]);
});

// The page tells whether it is opened on the viewer's own computer: it asks the viewer at 127.0.0.1 which instance
// answers there — from its public address as well — and learns whether the viewer has an editor to open files in
test('machine_Should_NameViewerInstance_ToItsOwnPagesOnly', async (t) => {
  const publicAddresses = [{ origin: 'https://viewer.example.com', host: 'viewer.example.com' }];
  const { port } = await withServer(t, { publicAddresses });
  const bare = await withServer(t, { editor: 'none' });

  const [own, again, foreign, plain] = await Promise.all([
    rawGet(port, '/api/machine', { origin: 'https://viewer.example.com' }),
    rawGet(port, '/api/machine', {}),
    rawGet(port, '/api/machine', { origin: 'https://evil.example.com' }),
    rawGet(bare.port, '/api/machine', {}),
  ]);

  const told = JSON.parse(own.body.toString());
  assert.deepEqual(
    { told, sameAgain: JSON.parse(again.body.toString()).instance === told.instance, allowed: own.headers['access-control-allow-origin'], foreign: foreign.headers['access-control-allow-origin'], plain: JSON.parse(plain.body.toString()).editor },
    { told: { instance: told.instance, port, editor: true }, sameAgain: true, allowed: 'https://viewer.example.com', foreign: undefined, plain: false },
  );
  assert.match(told.instance, /^[0-9a-f-]{36}$/);
});

// A file of the panel opens in the editor at its line; a file that is gone, or a viewer without an editor, opens nothing
test('openInEditor_Should_OpenFileAtLine_WhenViewerHasEditor', async (t) => {
  const { port, opened } = await withServer(t);
  const bare = await withServer(t, { editor: 'none' });
  const ask = (/** @type {number} */ at, /** @type {unknown} */ body) => post(at, '/api/open-in-editor', pageHeaders(at), JSON.stringify(body));

  const replies = await Promise.all([ask(port, { path: 'D:/dev/x/App.cs', line: 21 }), ask(port, { path: 'D:/dev/x/missing.cs', line: 1 }), ask(port, { path: 'D:/dev/x/App.cs' }), ask(bare.port, { path: 'D:/dev/x/App.cs', line: 3 })]);

  assert.deepEqual({ replies: replies.map(({ status, body }) => [status, status === 200 ? JSON.parse(body) : body]), opened }, {
    replies: [[200, { ok: true }], [200, { ok: false, error: 'not-a-file' }], [400, 'Bad file or line'], [200, { ok: false, error: 'no-editor' }]],
    opened: [['D:/dev/x/App.cs', 21]],
  });
});

// The page shows the account's usage the viewer reads: the 5-hour window and the week
test('usage_Should_TellAccountUsage', async (t) => {
  const { base } = await withServer(t);

  const response = await fetch(`${base}/api/usage`);

  assert.deepEqual({ status: response.status, usage: await response.json() }, { status: 200, usage: { fiveHour: { percent: 22, resetsAt: 1_000_000 }, sevenDay: { percent: 91, resetsAt: 2_000_000 }, readAt: 500 } });
});

// A session closed in herdr is opened there again from the page, in the folder its transcript names
test('history_Should_OpenClosedSessionAgain_InItsFolder', async (t) => {
  const { port, tabChanges } = await withServer(t);

  const reply = await post(port, '/api/history/reopen', pageHeaders(port), JSON.stringify({ session: sessionId }));

  assert.deepEqual({ status: reply.status, body: JSON.parse(reply.body), tabChanges }, { status: 200, body: { ok: true, target: `#/${sessionId}` }, tabChanges: [['reopen', sessionId, 'D:\\dev\\x']] });
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

// The panel shows a linked picture as an <img>: its bytes come with their type, and a file that is no picture is refused
test('fileImage_Should_SendPictureWithItsType_And_RefuseFileThatIsNoPicture', async (t) => {
  const { file, root, base } = await withServer(t);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const picture = join(root, 'shot.png');
  await writeFile(picture, png);

  const found = await fetch(`${base}/api/file/image?path=${encodeURIComponent(picture)}`);
  const transcript = await fetch(`${base}/api/file/image?path=${encodeURIComponent(file)}`);

  assert.deepEqual(
    { status: found.status, type: found.headers.get('content-type'), nosniff: found.headers.get('x-content-type-options'), bytes: Buffer.from(await found.arrayBuffer()) },
    { status: 200, type: 'image/png', nosniff: 'nosniff', bytes: png },
  );
  assert.deepEqual({ status: transcript.status, body: await transcript.json() }, { status: 415, body: { ok: false, error: 'not-image' } });
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

// Behind a tunnel (Cloudflare Tunnel, say) the page is opened at a public address: its requests carry that Host and Origin
test('server_Should_ServePageOpenedAtPublicAddress_And_TakeItsPrompts', async (t) => {
  const { port, calls } = await withServer(t, { publicAddresses: [{ origin: 'https://viewer.example.com', host: 'viewer.example.com' }] });
  const fromPublicPage = { ...pageHeaders(port), host: 'viewer.example.com', origin: 'https://viewer.example.com' };

  const list = await rawGet(port, '/api/sessions', { host: 'viewer.example.com' });
  const sent = await post(port, '/api/send', fromPublicPage, JSON.stringify({ session: sessionId, text: 'Go on' }));

  assert.deepEqual({ list: list.status, sent: sent.status }, { list: 200, sent: 200 });
  assert.deepEqual(calls, [['send', sessionId, 'Go on']]);
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
  for (const file of ['style.css', 'app.js', 'favicons/clay.svg', 'vendor/marked.js', 'vendor/purify.js', 'vendor/highlight.js']) {
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

// A session started just now has no transcript until its first message: the page hears it is missing, then — once
// Claude Code writes it — its entries, and that the feed is ready to be shown
test('stream_Should_ShowTranscriptThatAppearsAfterItWasMissing', async (t) => {
  const { root, base } = await withServer(t);
  const fresh = '9b1d2c30-5555-4666-8777-988899990000';
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${base}/api/stream?session=${fresh}`, { signal: controller.signal });
  assert.ok(response.body);
  const next = sseEvents(response.body);

  const before = (await next()).event;
  await writeFile(join(root, 'D--dev-x', `${fresh}.jsonl`), promptLine('f1', 'Hello'));
  const entries = await next();
  // a ready that never comes is waited for two seconds, not forever
  const after = (await Promise.race([next(), new Promise((done) => setTimeout(() => done({ event: 'nothing' }), 2000))])).event;

  assert.deepEqual([before, entries.event, uuids(entries), after], ['missing', 'entries', ['f1'], 'ready']);
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
  const { file, base, port } = await withServer(t, { takenBack: 'Now test it' });
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

test('snapshot_Should_GiveLatestEntriesOfSessionAtOnceToKeepForReadingOffline', async (t) => {
  const { file, base } = await withServer(t);
  await appendFile(file, answerLine('a1', 'u1') + childPrompt('p2', 'a1', 'Second question') + answerLine('a2', 'p2'));

  const snapshot = await (await fetch(`${base}/api/snapshot?session=${sessionId}&tail=2`)).json();

  assert.deepEqual({ earlier: snapshot.earlier, uuids: snapshot.entries.map((/** @type {{ uuid: string }} */ entry) => entry.uuid) }, { earlier: 2, uuids: ['p2', 'a2'] });
});

test('page_Should_WearPaletteTheViewerWasStartedWith', async (t) => {
  const { base } = await withServer(t, { palette: 'sea' });

  const page = await (await fetch(`${base}/`)).text();

  assert.match(page, /<html lang="en" data-palette="sea">/);
  assert.match(page, /<link rel="icon" href="\/b\/[0-9a-f]+\/favicons\/sea\.svg"/);
});

// iOS puts no SVG on the home screen: without a PNG of its own it takes a shot of the page instead
test('page_Should_OfferHomeScreenIconInItsPalette_ForEveryPalette', async (t) => {
  for (const palette of palettes) {
    const { base } = await withServer(t, { palette });

    const page = await (await fetch(`${base}/`)).text();
    const href = /<link rel="apple-touch-icon" href="([^"]+)">/.exec(page)?.[1];
    assert.match(String(href), new RegExp(`^/b/[0-9a-f]+/favicons/${palette}\\.png$`));
    const icon = await fetch(`${base}${href}`);
    const body = Buffer.from(await icon.arrayBuffer());

    assert.equal(icon.headers.get('content-type'), 'image/png');
    // PNG header: the size iOS asks for, and colour type 2 — no alpha channel, since iOS paints transparent corners black
    assert.deepEqual(
      { signature: body.subarray(1, 4).toString('ascii'), width: body.readUInt32BE(16), height: body.readUInt32BE(20), colourType: body.readUInt8(25) },
      { signature: 'PNG', width: 180, height: 180, colourType: 2 },
      palette,
    );
  }
});

// The herdr workspaces of the listed sessions, for the page to group and search by; asked every few seconds
test('workspaces_Should_ServeWorkspacesOfListedSessions_And_AnswerUnchangedReplyWithNotModified', async (t) => {
  const { port } = await withServer(t);

  const first = await rawGet(port, '/api/workspaces', {});
  const again = await rawGet(port, '/api/workspaces', { 'if-none-match': String(first.headers.etag) });

  assert.equal(first.status, 200);
  assert.deepEqual({ reply: JSON.parse(first.body.toString('utf8')), again: again.status }, { reply: { herdr: true, sessions: { [sessionId]: 'web' } }, again: 304 });
});

// herdr as it is — workspaces, tabs, panes — for the sidebar and the tabs in the session header; asked every few seconds
test('herdr_Should_ServeWhatHerdrShows_And_AnswerUnchangedReplyWithNotModified', async (t) => {
  const { port } = await withServer(t);

  const first = await rawGet(port, '/api/herdr', {});
  const again = await rawGet(port, '/api/herdr', { 'if-none-match': String(first.headers.etag) });

  assert.equal(first.status, 200);
  assert.deepEqual({ reply: JSON.parse(first.body.toString('utf8')), again: again.status }, { reply: { herdr: true, workspaces: [webWorkspace] }, again: 304 });
});

// A herdr pane's terminal on the page: its screen as it changes, until the pane is gone
test('pane_Should_StreamScreenOfPaneUntilItIsGone', async (t) => {
  const { port } = await withServer(t);

  const reply = await rawGet(port, '/api/pane/stream?pane=w1:p2', {});

  assert.equal(reply.status, 200);
  assert.equal(reply.body.toString('utf8'), `event: screen\ndata: ${JSON.stringify({ text: '\u001b[32mw1:p2\u001b[0m $' })}\n\nevent: gone\ndata: {"missing":false}\n\n`);
});

// Keys go into a terminal — with the power of whoever sits at it — only from the viewer's own page
test('pane_Should_TypeKeysFromViewerPage_And_RefuseOtherSites', async (t) => {
  const { port, typed } = await withServer(t);
  const body = JSON.stringify({ pane: 'w1:p2', data: 'ls\r' });

  const typedFromPage = await post(port, '/api/pane/input', pageHeaders(port), body);
  const forged = await post(port, '/api/pane/input', { ...pageHeaders(port), origin: 'https://evil.example' }, body);

  assert.deepEqual([typedFromPage.status, JSON.parse(typedFromPage.body), forged.status], [200, { ok: true }, 403]);
  assert.deepEqual(typed, [['w1:p2', 'ls\r']]);
});

// The page imports the terminal as an ES module: a CommonJS file would leave the whole page script unloaded
test('page_Should_GetTerminalLibraryAsModuleItCanImport', async (t) => {
  const { port } = await withServer(t);

  const library = await rawGet(port, '/vendor/xterm.js', {});

  assert.equal(library.status, 200);
  assert.match(library.body.toString('utf8'), /export\s*\{[^}]*\bas Terminal\b/);
});
