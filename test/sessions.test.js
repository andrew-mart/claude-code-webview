import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../test-support/temp-dir.js';
import { createSessionIndex, summarizeSession } from '../server/sessions.js';

const at = '2026-10-09T07:02:11.686Z';
/** @param {unknown} value */
const line = (value) => JSON.stringify(value);
const prompt = (/** @type {string} */ text, /** @type {string} */ cwd) =>
  line({ type: 'user', uuid: text, timestamp: at, cwd, gitBranch: 'master', promptSource: 'typed', message: { role: 'user', content: text } });

test('summarizeSession_Should_PreferCustomTitleThenLatestAiTitle', () => {
  const lines = [
    prompt('First question', 'D:\\dev\\a'),
    line({ type: 'ai-title', aiTitle: 'Old title' }),
    line({ type: 'custom-title', customTitle: 'My title' }),
    line({ type: 'ai-title', aiTitle: 'New title' }),
  ];

  assert.equal(summarizeSession(lines).title, 'My title');
  assert.equal(summarizeSession(lines.filter((l) => !l.includes('custom-title'))).title, 'New title');
});

test('summarizeSession_Should_FallBackToFirstPromptLineAndTakeLatestCwd', () => {
  const lines = [
    line({ type: 'user', uuid: 'm', timestamp: at, isMeta: true, message: { role: 'user', content: 'internal' } }),
    prompt('Build a viewer\ndetails below', 'C:\\projects\\shop'),
    prompt('Second question', 'C:\\projects\\blog'),
    '{"broken line',
  ];

  assert.deepEqual(summarizeSession(lines), { title: 'Build a viewer', cwd: 'C:\\projects\\blog', branch: 'master', kind: 'interactive', lastActivity: Date.parse(at) });
});

test('summarizeSession_Should_TakeLastActivityFromMessagesNotFromServiceRecords', () => {
  const lines = [
    line({ type: 'user', uuid: 'q', timestamp: '2026-10-05T10:00:00.000Z', cwd: 'D:\\dev\\a', message: { role: 'user', content: 'Question' } }),
    line({ type: 'assistant', uuid: 'r', timestamp: '2026-10-05T10:02:00.000Z', cwd: 'D:\\dev\\a', message: { role: 'assistant', model: 'm', content: [] } }),
    // Claude Code adds records like these to old sessions days later, when it restarts
    line({ type: 'system', subtype: 'away_summary', timestamp: '2026-10-10T17:21:00.000Z', cwd: 'D:\\dev\\a', content: 'Summary' }),
    line({ type: 'bridge-session', timestamp: '2026-10-10T17:21:01.000Z' }),
  ];

  assert.equal(summarizeSession(lines).lastActivity, Date.parse('2026-10-05T10:02:00.000Z'));
});

/**
 * @param {string} text
 * @param {string} entrypoint — how Claude Code was started: cli, sdk-cli, sdk-ts…
 */
const promptFrom = (text, entrypoint) =>
  line({ type: 'user', uuid: text, timestamp: at, cwd: 'D:\\dev\\notes', entrypoint, promptSource: entrypoint === 'cli' ? 'typed' : 'sdk', message: { role: 'user', content: text } });

test('summarizeSession_Should_TellSessionsDrivenOnlyThroughSdk', () => {
  assert.equal(summarizeSession([promptFrom('Name this document', 'sdk-cli')]).kind, 'sdk');
  assert.equal(summarizeSession([promptFrom('Build a viewer', 'cli')]).kind, 'interactive');
  assert.equal(summarizeSession([promptFrom('Name this document', 'sdk-ts'), promptFrom('Now explain it', 'cli')]).kind, 'interactive', 'resumed in a terminal');
});

test('list_Should_FindLatestFolderBehindHugeLastLine', async () => {
  const root = tempDir('csv-');
  await mkdir(join(root, 'D--dev-a'));
  const filler = Array.from({ length: 400 }, (_, index) => prompt(`Question ${index} ${'x'.repeat(700)}`, 'D:\\dev\\a'));
  const screenshot = line({ type: 'user', uuid: 'img', timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'y'.repeat(300_000) }] } });
  const lines = [...filler, prompt('After the move', 'D:\\dev\\b'), screenshot];
  await writeFile(join(root, 'D--dev-a', '3f2c9a50-1111-4222-8333-944455556666.jsonl'), `${lines.join('\n')}\n`);

  const [session] = await createSessionIndex(root, { summaryBudgetMs: 1000, missRetryMs: 0 }).list();

  assert.equal(session?.cwd, 'D:\\dev\\b');
});

test('list_Should_ListEverySessionAndSummarizeRestOnLaterCalls', async () => {
  const root = tempDir('csv-');
  await mkdir(join(root, 'D--dev-a'));
  for (let index = 0; index < 20; index++) {
    const id = `3f2c9a50-1111-4222-8333-${String(index).padStart(12, '0')}`;
    await writeFile(join(root, 'D--dev-a', `${id}.jsonl`), `${prompt(`Question ${index}`, 'D:\\dev\\a')}\n`);
  }
  const index = createSessionIndex(root, { summaryBudgetMs: 0, missRetryMs: 0 });

  const first = await index.list();
  const second = await index.list();

  assert.equal(first.length, 20);
  assert.equal(first.filter((session) => session.title !== undefined).length, 16);
  assert.equal(second.filter((session) => session.title !== undefined).length, 20);
});

test('changes_Should_GiveOnlySessionsWrittenSinceVersionCallerHas', async () => {
  const root = tempDir('csv-');
  await mkdir(join(root, 'D--dev-a'));
  const quiet = join(root, 'D--dev-a', '3f2c9a50-1111-4222-8333-000000000001.jsonl');
  const busy = join(root, 'D--dev-a', '3f2c9a50-1111-4222-8333-000000000002.jsonl');
  await writeFile(quiet, `${prompt('Quiet one', 'D:\\dev\\a')}\n`);
  await writeFile(busy, `${prompt('Busy one', 'D:\\dev\\a')}\n`);
  const index = createSessionIndex(root, { summaryBudgetMs: 1000, missRetryMs: 0 });
  await new Promise((resolve) => setTimeout(resolve, 5));

  const first = await index.changes(undefined);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await appendFile(busy, `${prompt('Next question', 'D:\\dev\\a')}\n`);
  const second = await index.changes(first.version);

  assert.deepEqual(first.sessions.map((session) => session.title).sort(), ['Busy one', 'Quiet one']);
  assert.deepEqual(second.sessions.map((session) => session.title), ['Busy one']);
  assert.equal(second.total, 2);
});

test('changes_Should_BringSummariesMadeOnLaterCallsAndOnlyThem', async () => {
  const root = tempDir('csv-');
  await mkdir(join(root, 'D--dev-a'));
  for (let index = 0; index < 20; index++) {
    const id = `3f2c9a50-1111-4222-8333-${String(index).padStart(12, '0')}`;
    await writeFile(join(root, 'D--dev-a', `${id}.jsonl`), `${prompt(`Question ${index}`, 'D:\\dev\\a')}\n`);
  }
  const index = createSessionIndex(root, { summaryBudgetMs: 0, missRetryMs: 0 });
  // a file written in the very millisecond the version is taken comes once more — harmless, but not what is tested
  await new Promise((resolve) => setTimeout(resolve, 5));

  const first = await index.changes(undefined);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await index.changes(first.version);

  // the first call summarizes one batch of 16; the other four come with the second, titled
  assert.equal(first.sessions.filter((session) => session.title !== undefined).length, 16);
  assert.equal(second.sessions.length, 4);
  assert.ok(second.sessions.every((session) => session.title !== undefined));
});

test('list_Should_PutSessionWithLatestMessageFirstWhateverTheFileTime', async () => {
  const root = tempDir('csv-');
  await mkdir(join(root, 'D--dev-a'));
  const message = (/** @type {string} */ text, /** @type {string} */ timestamp) => line({ type: 'user', uuid: text, timestamp, cwd: 'D:\\dev\\a', message: { role: 'user', content: text } });
  // written to today, but by service records: its last message is five days old, behind a long talk before it and a
  // screenful of service records after it
  const touched = join(root, 'D--dev-a', '3f2c9a50-1111-4222-8333-000000000001.jsonl');
  const earlier = Array.from({ length: 300 }, (_, index) => message(`Old talk ${index} ${'y'.repeat(1000)}`, '2026-10-01T10:00:00.000Z'));
  const service = Array.from({ length: 300 }, () => line({ type: 'system', subtype: 'away_summary', timestamp: '2026-10-10T17:21:00.000Z', cwd: 'D:\\dev\\a', content: 'x'.repeat(400) }));
  await writeFile(touched, `${[...earlier, message('Last word', '2026-10-05T10:00:00.000Z'), ...service].join('\n')}\n`);
  // its file is older, its last message newer
  const recent = join(root, 'D--dev-a', '3f2c9a50-1111-4222-8333-000000000002.jsonl');
  await writeFile(recent, `${message('Recent talk', '2026-10-08T10:00:00.000Z')}\n`);
  await utimes(recent, new Date('2026-10-08T10:00:00Z'), new Date('2026-10-08T10:00:00Z'));

  const sessions = await createSessionIndex(root, { summaryBudgetMs: 1000, missRetryMs: 0 }).list();

  assert.deepEqual(
    sessions.map((session) => [session.title?.slice(0, 10), session.activeAt]),
    [
      ['Recent tal', Date.parse('2026-10-08T10:00:00.000Z')],
      ['Old talk 0', Date.parse('2026-10-05T10:00:00.000Z')],
    ],
  );
});

// A session started just now has no transcript until its first message: it is listed as Claude Code has it open — in
// its folder, untitled, since it started — and a session open with a transcript is listed by the transcript, once
test('list_Should_ListStartedSessionInItsFolder_BeforeItsTranscriptIsWritten', async () => {
  const root = tempDir('csv-');
  await mkdir(join(root, 'D--dev-a'));
  const talked = '3f2c9a50-1111-4222-8333-000000000001';
  const fresh = '3f2c9a50-1111-4222-8333-000000000002';
  await writeFile(join(root, 'D--dev-a', `${talked}.jsonl`), `${line({ type: 'user', uuid: 'q', timestamp: '2026-10-08T10:00:00.000Z', cwd: 'D:\\dev\\a', message: { role: 'user', content: 'Talked already' } })}\n`);
  const started = async () => [
    { id: talked, cwd: 'D:\\dev\\a', startedAt: Date.parse('2026-10-08T09:00:00.000Z') },
    { id: fresh, cwd: 'D:\\dev\\shop', startedAt: Date.parse('2026-10-09T08:00:00.000Z') },
  ];

  const sessions = await createSessionIndex(root, { summaryBudgetMs: 1000, missRetryMs: 0, started }).list();

  assert.deepEqual(
    sessions.map((session) => [session.id, session.agent, session.title, session.cwd, session.activeAt]),
    [
      [fresh, 'claude', undefined, 'D:\\dev\\shop', Date.parse('2026-10-09T08:00:00.000Z')],
      [talked, 'claude', 'Talked already', 'D:\\dev\\a', Date.parse('2026-10-08T10:00:00.000Z')],
    ],
  );
});

// Claude Code tells it has a session open a while after the session started: a page that asked before learns of it
// with the next changes, and once only
test('changes_Should_BringStartedSessionOnce_ToCallerThatAskedBeforeItWasListed', async () => {
  const fresh = '3f2c9a50-1111-4222-8333-000000000002';
  /** @type {import('../server/sessions.js').StartedSession[]} */
  let open = [];
  const index = createSessionIndex(tempDir('csv-'), { summaryBudgetMs: 1000, missRetryMs: 0, started: async () => open });

  const before = await index.changes(undefined);
  await new Promise((resolve) => setTimeout(resolve, 5));
  open = [{ id: fresh, cwd: 'D:\\dev\\shop', startedAt: before.version - 1000 }];
  const first = await index.changes(before.version);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const next = await index.changes(first.version);

  assert.deepEqual([first.sessions.map((session) => session.id), next.sessions.map((session) => session.id), next.total], [[fresh], [], 1]);
});

// Codex's sessions are listed beside Claude Code's — ~/.codex/sessions/<year>/<month>/<day>/rollout-<time>-<id>.jsonl —
// with their title, folder and branch, told apart by their agent; a run of codex exec is one run by a program. Each is
// found by its id, and is known for a Codex one by its file
test('list_Should_ListCodexSessionsBesideClaudeCodesOnes_ToldApartByAgent', async () => {
  const root = tempDir('csv-');
  await mkdir(join(root, 'D--dev-a'));
  await writeFile(join(root, 'D--dev-a', '3f2c9a50-1111-4222-8333-944455556666.jsonl'), `${prompt('Claude question', 'D:\dev\a')}\n`);
  const codexRoot = tempDir('csv-codex-');
  const day = join(codexRoot, '2026', '10', '13');
  await mkdir(day, { recursive: true });
  /** @param {string} id @param {string} source @param {string} said */
  const rollout = (id, source, said) =>
    [
      line({ timestamp: at, ordinal: 0, type: 'session_meta', payload: { id, cwd: 'D:\dev\shop', source, git: { branch: 'feat/limits' } } }),
      line({ timestamp: at, ordinal: 1, type: 'turn_context', payload: { cwd: 'D:\dev\shop', model: 'gpt-6-astra' } }),
      line({ timestamp: at, ordinal: 2, type: 'response_item', payload: { type: 'message', id: 'msg_2', role: 'user', content: [{ type: 'input_text', text: said }] } }),
      line({ timestamp: at, ordinal: 3, type: 'response_item', payload: { type: 'message', id: 'msg_3', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] } }),
    ].join('\n');
  const worked = '01a13634-a2b7-7c90-ae35-9f11f984db97';
  const run = '01a13634-a2b7-7c90-ae35-000000000002';
  await writeFile(join(day, `rollout-2026-10-13T21-59-41-${worked}.jsonl`), `${rollout(worked, 'cli', 'Add a rate limit\nto POST /orders')}\n`);
  await writeFile(join(day, `rollout-2026-10-13T22-10-00-${run}.jsonl`), `${rollout(run, 'exec', 'Summarize the log')}\n`);
  const index = createSessionIndex(root, { summaryBudgetMs: 1000, missRetryMs: 0, codexRoot });

  const sessions = await index.list();
  const found = await index.find(worked);

  assert.deepEqual(
    {
      sessions: sessions.map(({ id, agent, title, cwd, branch, kind }) => ({ id, agent, title, cwd, branch, kind })).sort((a, b) => a.id.localeCompare(b.id)),
      codexFile: found === undefined ? undefined : index.agentOf(found),
    },
    {
      sessions: [
        { id: run, agent: 'codex', title: 'Summarize the log', cwd: 'D:\dev\shop', branch: 'feat/limits', kind: 'sdk' },
        { id: worked, agent: 'codex', title: 'Add a rate limit', cwd: 'D:\dev\shop', branch: 'feat/limits', kind: 'interactive' },
        { id: '3f2c9a50-1111-4222-8333-944455556666', agent: 'claude', title: 'Claude question', cwd: 'D:\dev\a', branch: 'master', kind: 'interactive' },
      ],
      codexFile: 'codex',
    },
  );
});

// A Codex session its user edited a prompt of and sent again goes on in another file — maybe of another day — named by
// the session's id and its own: one session, its title from where it began, its activity from where it goes on; it is
// read as its files in turn, the one before up to the point the next goes on from
test('list_Should_ListCodexSessionGoingOnInAnotherFileOnce_ReadAsItsFilesInTurn', async () => {
  const root = tempDir('csv-');
  const codexRoot = tempDir('csv-codex-');
  const id = '01a0d69a-fc7e-7fe1-9d40-9392029cb8a5';
  const later = '2026-10-14T08:00:00.000Z';
  /** @param {number} ordinal @param {'user' | 'assistant'} role @param {string} said @param {string} [when] */
  const said = (ordinal, role, said, when = at) =>
    line({ timestamp: when, ordinal, type: 'response_item', payload: { type: 'message', id: `msg_${ordinal}`, role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text: said }] } });
  const kept = [line({ timestamp: at, ordinal: 0, type: 'session_meta', payload: { id, cwd: 'D:\dev\shop', source: 'cli' } }), said(1, 'user', 'Add a rate limit'), said(2, 'assistant', 'Added.')].map((one) => `${one}\n`).join('');
  const first = join(codexRoot, '2026', '10', '13', `rollout-2026-10-13T21-59-41-${id}.jsonl`);
  const next = join(codexRoot, '2026', '10', '14', `rollout-2026-10-14T07-59-00-${id}_01a0d6a1-6035-7851-ac0d-fba569172c88.jsonl`);
  await mkdir(join(codexRoot, '2026', '10', '13'), { recursive: true });
  await mkdir(join(codexRoot, '2026', '10', '14'), { recursive: true });
  await writeFile(first, `${kept}${said(3, 'user', 'Make it 10 a second')}\n`);
  await writeFile(
    next,
    [line({ timestamp: later, ordinal: 3, type: 'session_meta', payload: { id, cwd: 'D:\dev\shop', source: 'cli', history_base: { thread_id: id, end_ordinal_exclusive: 3, end_byte_offset: Buffer.byteLength(kept) } } }), said(4, 'user', 'Make it 20 a second', later), said(5, 'assistant', 'Made it 20.', later)].map((one) => `${one}\n`).join(''),
  );
  const index = createSessionIndex(root, { summaryBudgetMs: 1000, missRetryMs: 0, codexRoot });

  const sessions = await index.list();
  const found = await index.find(id);

  assert.deepEqual(
    {
      sessions: sessions.map(({ id, title, activeAt }) => ({ id, title, activeAt })),
      parts: found === undefined ? undefined : await index.partsOf(found),
    },
    {
      sessions: [{ id, title: 'Add a rate limit', activeAt: Date.parse(later) }],
      parts: [
        { path: first, end: Buffer.byteLength(kept) },
        { path: next, end: undefined },
      ],
    },
  );
});

// A session's folder, who runs it and when it was last active, told by its id — the list not asked for first; none for
// a session not found
test('summaryOf_Should_TellSessionsFolderKindAndActivity_ById', async () => {
  const codexRoot = tempDir('csv-codex-');
  const id = '01a13a06-5376-7481-9aa7-ec19297d2f7c';
  const day = join(codexRoot, '2026', '10', '14');
  await mkdir(day, { recursive: true });
  const meta = line({ timestamp: at, ordinal: 0, type: 'session_meta', payload: { id, cwd: 'D:/dev/shop', source: 'cli' } });
  const asked = line({ timestamp: at, ordinal: 1, type: 'response_item', payload: { type: 'message', id: 'msg_1', role: 'user', content: [{ type: 'input_text', text: 'Add a rate limit' }] } });
  await writeFile(join(day, `rollout-2026-10-14T15-47-35-${id}.jsonl`), `${meta}\n${asked}\n`);
  const index = createSessionIndex(tempDir('csv-'), { summaryBudgetMs: 1000, missRetryMs: 0, codexRoot });

  assert.deepEqual([await index.summaryOf(id), await index.summaryOf('01a13a06-0000-7481-9aa7-000000000000')], [{ cwd: 'D:/dev/shop', kind: 'interactive', activeAt: Date.parse(at) }, undefined]);
});

// A session copied under another project's folder — its project being moved, the copy made while it ran — has two files
// of one id: the one written last is the session going on, the copy stays as it was made. The session is listed once, as
// the file written last tells it, and found there: its feed follows it, not the copy
test('list_And_find_Should_TakeFileWrittenLast_When_SessionHasCopyElsewhere', async () => {
  const root = tempDir('csv-');
  const id = '3f2c9a50-1111-4222-8333-00000000000a';
  await mkdir(join(root, 'D--dev-shop'));
  await mkdir(join(root, 'D--dev-shop-new'));
  const live = join(root, 'D--dev-shop', `${id}.jsonl`);
  const copy = join(root, 'D--dev-shop-new', `${id}.jsonl`);
  await writeFile(copy, `${prompt('Move the shop', 'D:\\dev\\shop-new')}\n`);
  await utimes(copy, new Date('2026-10-16T16:23:00Z'), new Date('2026-10-16T16:23:00Z'));
  await writeFile(live, `${prompt('Move the shop', 'D:\\dev\\shop')}\n${prompt('Still at it?', 'D:\\dev\\shop')}\n`);
  await utimes(live, new Date('2026-10-16T17:51:00Z'), new Date('2026-10-16T17:51:00Z'));
  const index = createSessionIndex(root, { summaryBudgetMs: 1000, missRetryMs: 0 });

  const listed = await index.list();
  const found = await index.find(id);

  assert.deepEqual({ listed: listed.map((session) => [session.id, session.cwd]), found }, { listed: [[id, 'D:\\dev\\shop']], found: live });
});

// An id with no transcript — a session opened before its first message, a Codex thread not written yet — is looked for
// among all the files at most once in a while, not on every ask, which polls it often: a transcript written meanwhile is
// found once the while is over
test('find_Should_LookForUnknownIdAmongTheFilesOnceInAWhile', async () => {
  const root = tempDir('csv-');
  await mkdir(join(root, 'D--dev-a'));
  const index = createSessionIndex(root, { summaryBudgetMs: 0, missRetryMs: 300 });
  const id = '3f2c9a50-1111-4222-8333-000000000009';
  const path = join(root, 'D--dev-a', `${id}.jsonl`);

  const before = await index.find(id);
  await writeFile(path, `${prompt('Late one', 'D:\dev\a')}\n`);
  const meanwhile = await index.find(id);
  await new Promise((resolve) => setTimeout(resolve, 350));
  const after = await index.find(id);

  assert.deepEqual([before, meanwhile, after], [undefined, undefined, path]);
});
