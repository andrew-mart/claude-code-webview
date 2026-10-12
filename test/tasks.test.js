import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTaskTracker } from '../server/tasks.js';

/**
 * @param {string} at
 * @param {string} id
 * @param {string} name
 * @param {Record<string, unknown>} input
 */
const call = (at, id, name, input) => ({ type: 'assistant', timestamp: at, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
/**
 * @param {string} at
 * @param {string} id
 * @param {string} content
 * @param {unknown} toolUseResult
 * @param {boolean} [isError]
 */
const result = (at, id, content, toolUseResult, isError = false) => ({
  type: 'user',
  timestamp: at,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
  toolUseResult,
});
/**
 * @param {string} task
 * @param {string} toolUse
 * @param {string} status
 * @param {string} summary
 */
const notification = (task, toolUse, status, summary) =>
  `<task-notification>\n<task-id>${task}</task-id>\n<tool-use-id>${toolUse}</tool-use-id>\n<output-file>C:\\Temp\\claude\\s1\\tasks\\${task}.output</output-file>\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>`;

// A command runs in the background when Claude starts it there or it outruns its timeout; it runs until Claude Code
// tells it finished — the note comes as a message, or folded into a turn that was going on — or Claude stops it
test('tasks_Should_FollowBackgroundCommands_FromStartToTheirEnd', () => {
  const tracker = createTaskTracker();
  for (const entry of [
    call('2026-10-12T09:00:00.000Z', 'toolu_dev', 'Bash', { command: 'npm run dev', description: 'Start the dev server', run_in_background: true }),
    result('2026-10-12T09:00:01.000Z', 'toolu_dev', 'Command running in background with ID: bdev. Output is being written to: C:\\Temp\\claude\\s1\\tasks\\bdev.output', { stdout: '', backgroundTaskId: 'bdev' }),
    call('2026-10-12T09:01:00.000Z', 'toolu_quick', 'Bash', { command: 'git status', description: 'Show status' }),
    result('2026-10-12T09:01:01.000Z', 'toolu_quick', 'On branch main', { stdout: 'On branch main' }),
    call('2026-10-12T09:02:00.000Z', 'toolu_tests', 'Bash', { command: 'npm test', description: 'Run the tests', timeout: 120000 }),
    result('2026-10-12T09:04:00.000Z', 'toolu_tests', 'Command did not complete within its 120s timeout and was moved to the background (ID: btests). Output is being written to: C:\\Temp\\claude\\s1\\tasks\\btests.output.', { stdout: '', backgroundTaskId: 'btests', timedOutAfterMs: 120000 }),
    { type: 'attachment', timestamp: '2026-10-12T09:06:00.000Z', attachment: { type: 'queued_command', commandMode: 'task-notification', prompt: notification('btests', 'toolu_tests', 'completed', 'Background command "Run the tests" completed (exit code 0)') } },
    call('2026-10-12T09:07:00.000Z', 'toolu_watch', 'Bash', { command: 'npm run watch', run_in_background: true }),
    result('2026-10-12T09:07:01.000Z', 'toolu_watch', 'Command running in background with ID: bwatch. Output is being written to: C:\\Temp\\claude\\s1\\tasks\\bwatch.output', { stdout: '', backgroundTaskId: 'bwatch' }),
    { type: 'user', timestamp: '2026-10-12T09:09:00.000Z', message: { role: 'user', content: notification('bwatch', 'toolu_watch', 'killed', 'Background command "npm run watch" was stopped') } },
    call('2026-10-12T09:10:00.000Z', 'toolu_serve', 'Bash', { command: 'npx serve', description: 'Serve the build', run_in_background: true }),
    result('2026-10-12T09:10:01.000Z', 'toolu_serve', 'Command running in background with ID: bserve. Output is being written to: C:\\Temp\\claude\\s1\\tasks\\bserve.output', { stdout: '', backgroundTaskId: 'bserve' }),
    call('2026-10-12T09:12:00.000Z', 'toolu_stop', 'TaskStop', { task_id: 'bserve' }),
    result('2026-10-12T09:12:01.000Z', 'toolu_stop', '{"message":"Successfully stopped task: bserve (npx serve)"}', { message: 'Successfully stopped task: bserve (npx serve)', task_id: 'bserve', task_type: 'local_bash' }),
  ]) {
    tracker.note(entry);
  }

  assert.deepEqual(tracker.list(), [
    { id: 'toolu_dev', kind: 'shell', title: 'Start the dev server', detail: 'npm run dev', startedAt: '2026-10-12T09:00:00.000Z', endedAt: undefined, state: 'running', note: undefined, taskId: 'bdev', output: 'C:\\Temp\\claude\\s1\\tasks\\bdev.output' },
    { id: 'toolu_tests', kind: 'shell', title: 'Run the tests', detail: 'npm test', startedAt: '2026-10-12T09:02:00.000Z', endedAt: '2026-10-12T09:06:00.000Z', state: 'completed', note: 'Background command "Run the tests" completed (exit code 0)', taskId: 'btests', output: 'C:\\Temp\\claude\\s1\\tasks\\btests.output' },
    { id: 'toolu_watch', kind: 'shell', title: 'npm run watch', detail: 'npm run watch', startedAt: '2026-10-12T09:07:00.000Z', endedAt: '2026-10-12T09:09:00.000Z', state: 'killed', note: 'Background command "npm run watch" was stopped', taskId: 'bwatch', output: 'C:\\Temp\\claude\\s1\\tasks\\bwatch.output' },
    { id: 'toolu_serve', kind: 'shell', title: 'Serve the build', detail: 'npx serve', startedAt: '2026-10-12T09:10:00.000Z', endedAt: '2026-10-12T09:12:01.000Z', state: 'killed', note: 'Stopped by Claude', taskId: 'bserve', output: 'C:\\Temp\\claude\\s1\\tasks\\bserve.output' },
  ]);
});

// A subagent works from its call: one launched to the background until Claude Code tells it finished, and again while
// a message sent to it is being answered; one Claude waits for until its result comes, failed if that is an error
test('tasks_Should_FollowSubagents_WhileTheyWork', () => {
  const tracker = createTaskTracker();
  /** @param {string} agentId */
  const launched = (agentId) => ({ status: 'async_launched', isAsync: true, agentId, description: 'x', outputFile: `C:\\Temp\\claude\\s1\\tasks\\${agentId}.output` });
  for (const entry of [
    call('2026-10-12T10:00:00.000Z', 'toolu_routes', 'Agent', { description: 'Find the routes', subagent_type: 'Explore', prompt: 'Find every route' }),
    result('2026-10-12T10:00:01.000Z', 'toolu_routes', 'Async agent launched successfully.', launched('aroutes')),
    call('2026-10-12T10:01:00.000Z', 'toolu_review', 'Agent', { description: 'Review the change', prompt: 'Review it', run_in_background: false }),
    result('2026-10-12T10:03:00.000Z', 'toolu_review', 'No findings.', { status: 'completed', agentId: 'areview', totalDurationMs: 120000 }),
    call('2026-10-12T10:04:00.000Z', 'toolu_audit', 'Agent', { description: 'Audit the deps', subagent_type: 'general-purpose', prompt: 'Audit' }),
    result('2026-10-12T10:05:00.000Z', 'toolu_audit', 'Agent stopped: the API errored', { status: 'error', agentId: 'aaudit' }, true),
    { type: 'user', timestamp: '2026-10-12T10:06:00.000Z', message: { role: 'user', content: notification('aroutes', 'toolu_routes', 'completed', 'Agent "Find the routes" finished') } },
    call('2026-10-12T10:07:00.000Z', 'toolu_ask', 'SendMessage', { to: 'aroutes', message: 'And the redirects?' }),
    call('2026-10-12T10:08:00.000Z', 'toolu_docs', 'Agent', { description: 'Read the docs', prompt: 'Read' }),
    result('2026-10-12T10:08:01.000Z', 'toolu_docs', 'Async agent launched successfully.', launched('adocs')),
    call('2026-10-12T10:09:00.000Z', 'toolu_plan', 'Agent', { description: 'Plan the fix', subagent_type: 'Plan', prompt: 'Plan' }),
  ]) {
    tracker.note(entry);
  }

  assert.deepEqual(tracker.list(), [
    { id: 'toolu_routes', kind: 'agent', title: 'Find the routes', detail: 'Explore', startedAt: '2026-10-12T10:00:00.000Z', endedAt: undefined, state: 'running', note: undefined, taskId: 'aroutes', output: 'C:\\Temp\\claude\\s1\\tasks\\aroutes.output' },
    { id: 'toolu_review', kind: 'agent', title: 'Review the change', detail: undefined, startedAt: '2026-10-12T10:01:00.000Z', endedAt: '2026-10-12T10:03:00.000Z', state: 'completed', note: undefined, taskId: 'areview', output: undefined },
    { id: 'toolu_audit', kind: 'agent', title: 'Audit the deps', detail: 'general-purpose', startedAt: '2026-10-12T10:04:00.000Z', endedAt: '2026-10-12T10:05:00.000Z', state: 'failed', note: undefined, taskId: 'aaudit', output: undefined },
    { id: 'toolu_docs', kind: 'agent', title: 'Read the docs', detail: undefined, startedAt: '2026-10-12T10:08:00.000Z', endedAt: undefined, state: 'running', note: undefined, taskId: 'adocs', output: 'C:\\Temp\\claude\\s1\\tasks\\adocs.output' },
    { id: 'toolu_plan', kind: 'agent', title: 'Plan the fix', detail: 'Plan', startedAt: '2026-10-12T10:09:00.000Z', endedAt: undefined, state: 'running', note: undefined, taskId: undefined, output: undefined },
  ]);
});
