import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const root = await mkdtemp(join(tmpdir(), 'csv-'));
  await mkdir(join(root, 'D--dev-a'));
  const filler = Array.from({ length: 400 }, (_, index) => prompt(`Question ${index} ${'x'.repeat(700)}`, 'D:\\dev\\a'));
  const screenshot = line({ type: 'user', uuid: 'img', timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'y'.repeat(300_000) }] } });
  const lines = [...filler, prompt('After the move', 'D:\\dev\\b'), screenshot];
  await writeFile(join(root, 'D--dev-a', '3f2c9a50-1111-4222-8333-944455556666.jsonl'), `${lines.join('\n')}\n`);

  const [session] = await createSessionIndex(root, { summaryBudgetMs: 1000 }).list();

  assert.equal(session?.cwd, 'D:\\dev\\b');
});

test('list_Should_ListEverySessionAndSummarizeRestOnLaterCalls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'csv-'));
  await mkdir(join(root, 'D--dev-a'));
  for (let index = 0; index < 20; index++) {
    const id = `3f2c9a50-1111-4222-8333-${String(index).padStart(12, '0')}`;
    await writeFile(join(root, 'D--dev-a', `${id}.jsonl`), `${prompt(`Question ${index}`, 'D:\\dev\\a')}\n`);
  }
  const index = createSessionIndex(root, { summaryBudgetMs: 0 });

  const first = await index.list();
  const second = await index.list();

  assert.equal(first.length, 20);
  assert.equal(first.filter((session) => session.title !== undefined).length, 16);
  assert.equal(second.filter((session) => session.title !== undefined).length, 20);
});

test('changes_Should_GiveOnlySessionsWrittenSinceVersionCallerHas', async () => {
  const root = await mkdtemp(join(tmpdir(), 'csv-'));
  await mkdir(join(root, 'D--dev-a'));
  const quiet = join(root, 'D--dev-a', '3f2c9a50-1111-4222-8333-000000000001.jsonl');
  const busy = join(root, 'D--dev-a', '3f2c9a50-1111-4222-8333-000000000002.jsonl');
  await writeFile(quiet, `${prompt('Quiet one', 'D:\\dev\\a')}\n`);
  await writeFile(busy, `${prompt('Busy one', 'D:\\dev\\a')}\n`);
  const index = createSessionIndex(root, { summaryBudgetMs: 1000 });
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
  const root = await mkdtemp(join(tmpdir(), 'csv-'));
  await mkdir(join(root, 'D--dev-a'));
  for (let index = 0; index < 20; index++) {
    const id = `3f2c9a50-1111-4222-8333-${String(index).padStart(12, '0')}`;
    await writeFile(join(root, 'D--dev-a', `${id}.jsonl`), `${prompt(`Question ${index}`, 'D:\\dev\\a')}\n`);
  }
  const index = createSessionIndex(root, { summaryBudgetMs: 0 });
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
  const root = await mkdtemp(join(tmpdir(), 'csv-'));
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

  const sessions = await createSessionIndex(root, { summaryBudgetMs: 1000 }).list();

  assert.deepEqual(
    sessions.map((session) => [session.title?.slice(0, 10), session.activeAt]),
    [
      ['Recent tal', Date.parse('2026-10-08T10:00:00.000Z')],
      ['Old talk 0', Date.parse('2026-10-05T10:00:00.000Z')],
    ],
  );
});
