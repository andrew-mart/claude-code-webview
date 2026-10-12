import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTasks, tasksSummary, taskState } from '../public/model/tasks.js';

const now = Date.parse('2026-10-12T10:10:00.000Z');
const shell = { id: 'toolu_dev', kind: 'shell', title: 'Start the dev server', detail: 'npm run dev', startedAt: '2026-10-12T10:07:00.000Z', state: 'running', taskId: 'bdev', hasOutput: true };
const agent = { id: 'toolu_routes', kind: 'agent', title: 'Find the routes', detail: 'Explore', startedAt: '2026-10-12T10:00:00.000Z', endedAt: '2026-10-12T10:02:10.000Z', state: 'completed', note: 'Agent "Find the routes" finished', taskId: 'aroutes', hasOutput: false };

// The viewer's /api/tasks reply as the page takes it: an entry it cannot read is left out
test('parseTasks_Should_TakeTasksOfReply_LeavingOutWhatItCannotRead', () => {
  assert.deepEqual(parseTasks([shell, agent, { id: 'x', kind: 'printer' }, 'junk']), [
    { ...shell, endedAt: undefined, note: undefined },
    { ...agent },
  ]);
  assert.deepEqual(parseTasks({ error: 'down' }), []);
});

// How each task stands, in a few words: how long it runs, or how it ended and how long it took
test('taskState_Should_TellHowTaskStands_AndForHowLong', () => {
  const tasks = parseTasks([
    shell,
    agent,
    { ...shell, id: 'a', state: 'failed', endedAt: '2026-10-12T10:07:40.000Z' },
    { ...shell, id: 'b', state: 'killed', endedAt: '2026-10-12T10:09:00.000Z' },
    { ...shell, id: 'c', state: 'interrupted' },
  ]);

  assert.deepEqual(tasks.map((task) => taskState(task, now)), ['running · 3m 0s', 'done · 2m 10s', 'failed · after 40s', 'stopped · after 2m 0s', 'cut short: the session closed']);
});

// The line over the input box: how many run and how many have ended; nothing for a session that started none
test('tasksSummary_Should_CountRunningAndEndedTasks', () => {
  const [running, ended] = parseTasks([shell, agent]);
  assert.ok(running !== undefined && ended !== undefined);

  assert.deepEqual([tasksSummary([running, ended]), tasksSummary([ended]), tasksSummary([])], ['1 running in the background · 1 ended', '1 background task ended', undefined]);
});
