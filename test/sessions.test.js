import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
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

  assert.deepEqual(summarizeSession(lines), { title: 'Build a viewer', cwd: 'C:\\projects\\blog', branch: 'master', kind: 'interactive' });
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
