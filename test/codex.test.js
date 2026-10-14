import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCodexReading } from '../server/codex.js';

const at = (/** @type {number} */ second) => `2026-10-13T17:01:${String(second).padStart(2, '0')}.000Z`;
const meta = { timestamp: at(0), ordinal: 0, type: 'session_meta', payload: { id: '01a13634-a2b7-7c90-ae35-9f11f984db97', cwd: 'D:\\dev\\shop', originator: 'codex-tui', source: 'cli', git: { branch: 'feat/limits' } } };
const context = { timestamp: at(1), ordinal: 1, type: 'turn_context', payload: { cwd: 'D:\\dev\\shop', model: 'gpt-6-astra', effort: 'high' } };
/** @param {number} ordinal @param {'user' | 'assistant' | 'developer'} role @param {string} text */
const message = (ordinal, role, text) => ({ timestamp: at(ordinal), ordinal, type: 'response_item', payload: { type: 'message', id: `msg_${ordinal}`, role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }] } });

/** Codex's records read in turn, as the page gets them: their kind, what they say, and how they are chained. */
function read(/** @type {unknown[]} */ records) {
  const reading = createCodexReading();
  return records.flatMap((record) => reading.translate(record));
}

// A Codex conversation reads as Claude Code writes one: the prompts — Codex's own instructions and context among them
// hidden — the answers with the turn's model, every record in the session's folder and branch, each after the one before
test('codexReading_Should_TellConversationAsClaudeCodeWritesIt', () => {
  const records = read([
    meta,
    message(2, 'developer', '<permissions instructions>sandbox</permissions instructions>'),
    { ...message(3, 'user', '# AGENTS.md instructions\n\n<INSTRUCTIONS>be brief</INSTRUCTIONS>'), payload: { ...message(3, 'user', '').payload, content: [{ type: 'input_text', text: '# AGENTS.md instructions\n\nbe brief' }, { type: 'input_text', text: '<environment_context>\n  <cwd>D:\\dev\\shop</cwd>\n</environment_context>' }] } },
    context,
    message(4, 'user', 'Add a rate limit to POST /orders'),
    { timestamp: at(5), ordinal: 5, type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage' } } },
    { timestamp: at(6), ordinal: 6, type: 'response_item', payload: { type: 'reasoning', id: 'rs_6', summary: [{ type: 'summary_text', text: 'Looking for the routes' }] } },
    { timestamp: at(7), ordinal: 7, type: 'response_item', payload: { type: 'reasoning', id: 'rs_7', summary: [] } },
    message(8, 'assistant', 'The routes are in src/routes/orders.ts.'),
  ]);

  assert.deepEqual(
    records.map((record) => ({ type: record.type, isMeta: record.isMeta, message: record.message, uuid: record.uuid, parentUuid: record.parentUuid, cwd: record.cwd, gitBranch: record.gitBranch })),
    [
      { type: 'user', isMeta: true, message: { role: 'user', content: '# AGENTS.md instructions\n\nbe brief\n<environment_context>\n  <cwd>D:\\dev\\shop</cwd>\n</environment_context>' }, uuid: 'codex-3', parentUuid: null, cwd: 'D:\\dev\\shop', gitBranch: 'feat/limits' },
      { type: 'user', isMeta: undefined, message: { role: 'user', content: 'Add a rate limit to POST /orders' }, uuid: 'codex-4', parentUuid: 'codex-3', cwd: 'D:\\dev\\shop', gitBranch: 'feat/limits' },
      { type: 'assistant', isMeta: undefined, message: { id: 'rs_6', role: 'assistant', model: 'gpt-6-astra', content: [{ type: 'thinking', thinking: 'Looking for the routes' }] }, uuid: 'codex-6', parentUuid: 'codex-4', cwd: 'D:\\dev\\shop', gitBranch: 'feat/limits' },
      { type: 'assistant', isMeta: undefined, message: { id: 'msg_8', role: 'assistant', model: 'gpt-6-astra', content: [{ type: 'text', text: 'The routes are in src/routes/orders.ts.' }] }, uuid: 'codex-8', parentUuid: 'codex-6', cwd: 'D:\\dev\\shop', gitBranch: 'feat/limits' },
    ],
  );
});

// Codex runs commands as a script of tools.exec_command calls: its commands show as a terminal's, with what they
// printed; another call shows by its name, with its arguments
test('codexReading_Should_TellExecAsItsCommandsWithTheirOutput_AndOtherCallsByName', () => {
  const records = read([
    meta,
    context,
    { timestamp: at(2), ordinal: 2, type: 'response_item', payload: { type: 'custom_tool_call', id: 'ctc_2', call_id: 'call_a', name: 'exec', input: 'const r = await Promise.allSettled([tools.exec_command({cmd:"git status --short","max_output_tokens":4000}), tools.exec_command({ cmd: "npm test -- \\"limits\\"" })]);' } },
    { timestamp: at(3), ordinal: 3, type: 'response_item', payload: { type: 'custom_tool_call_output', id: 'ctco_3', call_id: 'call_a', output: [{ type: 'input_text', text: 'Script completed\n' }, { type: 'input_text', text: ' M src/routes/orders.ts' }] } },
    { timestamp: at(4), ordinal: 4, type: 'response_item', payload: { type: 'function_call', id: 'fc_4', call_id: 'call_b', name: 'spawn_agent', arguments: '{"task":"review the limits"}' } },
    { timestamp: at(5), ordinal: 5, type: 'response_item', payload: { type: 'function_call_output', id: 'fco_5', call_id: 'call_b', output: 'agent started' } },
  ]);

  assert.deepEqual(
    records.map((record) => record.message?.content),
    [
      [{ type: 'tool_use', id: 'call_a', name: 'Bash', input: { command: 'git status --short\nnpm test -- "limits"' } }],
      [{ type: 'tool_result', tool_use_id: 'call_a', content: 'Script completed\n M src/routes/orders.ts' }],
      [{ type: 'tool_use', id: 'call_b', name: 'spawn_agent', input: { task: 'review the limits' } }],
      [{ type: 'tool_result', tool_use_id: 'call_b', content: 'agent started' }],
    ],
  );
});

// A turn's end tells how long it took; a turn stopped by its user is marked as Claude Code marks one
test('codexReading_Should_MarkTurnEndWithItsDuration_And_TurnStopped', () => {
  const records = read([
    meta,
    { timestamp: at(9), ordinal: 9, type: 'event_msg', payload: { type: 'task_complete', duration_ms: 411099 } },
    { timestamp: at(10), ordinal: 10, type: 'event_msg', payload: { type: 'turn_aborted', reason: 'interrupted' } },
  ]);

  assert.deepEqual(
    records.map((record) => ({ type: record.type, subtype: record.subtype, durationMs: record.durationMs, message: record.message })),
    [
      { type: 'system', subtype: 'turn_duration', durationMs: 411099, message: undefined },
      { type: 'user', subtype: undefined, durationMs: undefined, message: { role: 'user', content: '[Request interrupted by user]' } },
    ],
  );
});

// A record read alone — a command's whole output, asked for when its row opens — is the same record as read in turn
test('codexReading_Should_GiveRecordReadAloneAsReadInTurn', () => {
  const output = { timestamp: at(3), ordinal: 3, type: 'response_item', payload: { type: 'custom_tool_call_output', id: 'ctco_3', call_id: 'call_a', output: [{ type: 'input_text', text: 'done' }] } };
  const [inTurn] = read([meta, context, output]);
  const [alone] = read([output]);

  assert.ok(inTurn !== undefined && alone !== undefined);
  assert.deepEqual({ uuid: alone.uuid, message: alone.message }, { uuid: inTurn.uuid, message: inTurn.message });
});

// The other ways Codex runs a command show as a terminal's too; a patch shows the files it changes, a plan as Claude
// Code's list of tasks
test('codexReading_Should_TellCommandsOfEveryShape_PatchByItsFiles_AndPlanAsTasks', () => {
  /** @param {number} ordinal @param {string} name @param {unknown} args */
  const call = (ordinal, name, args) => ({ timestamp: at(ordinal), ordinal, type: 'response_item', payload: { type: 'function_call', id: `fc_${ordinal}`, call_id: `call_${ordinal}`, name, arguments: JSON.stringify(args) } });
  const records = read([
    meta,
    call(2, 'exec_command', { cmd: 'git log -3', workdir: 'D:\dev\shop' }),
    call(3, 'shell_command', { command: 'npm test' }),
    call(4, 'shell', { command: ['bash', '-lc', 'ls -la'], workdir: '/home/ann/shop' }),
    { timestamp: at(5), ordinal: 5, type: 'response_item', payload: { type: 'custom_tool_call', id: 'ctc_5', call_id: 'call_5', name: 'apply_patch', input: '*** Begin Patch\n*** Update File: src/limits.ts\n@@\n-a\n+b\n*** Add File: src/burst.ts\n+x\n*** End Patch' } },
    call(6, 'update_plan', { plan: [{ step: 'Read the routes', status: 'completed' }, { step: 'Add the limit', status: 'in_progress' }] }),
  ]);

  assert.deepEqual(
    records.map((record) => {
      const [block] = Array.isArray(record.message?.content) ? record.message.content : [];
      return block?.type === 'tool_use' ? { name: block.name, input: block.name === 'apply_patch' ? { file_path: block.input.file_path } : block.input } : undefined;
    }),
    [
      { name: 'Bash', input: { command: 'git log -3' } },
      { name: 'Bash', input: { command: 'npm test' } },
      { name: 'Bash', input: { command: 'ls -la' } },
      { name: 'apply_patch', input: { file_path: 'src/limits.ts, src/burst.ts' } },
      {
        name: 'TodoWrite',
        input: {
          todos: [
            { content: 'Read the routes', status: 'completed', activeForm: 'Read the routes' },
            { content: 'Add the limit', status: 'in_progress', activeForm: 'Add the limit' },
          ],
        },
      },
    ],
  );
});

// A session no one types into — codex exec, a subagent's — is marked as Claude Code marks one run from a program; one
// a person works in, as one run in a terminal
test('codexReading_Should_TellSessionRunByProgramFromOneWorkedIn', () => {
  /** @param {unknown} source */
  const entrypointOf = (source) => read([{ ...meta, payload: { ...meta.payload, source } }, message(4, 'user', 'go')])[0]?.entrypoint;

  assert.deepEqual([entrypointOf('cli'), entrypointOf('vscode'), entrypointOf('exec'), entrypointOf({ subagent: 'review' })], ['codex-cli', 'codex-cli', 'sdk-codex', 'sdk-codex']);
});

// A subagent's session begins with its parent's, copied whole — the parent's own session_meta among it: the session
// stays the subagent's, run by a program
test('codexReading_Should_KeepSubagentsSession_ThroughParentsCopiedIn', () => {
  const subagent = { ...meta, payload: { ...meta.payload, id: '01a0a5e2-92d3-79d2-b64c-6c1c954e232f', source: { subagent: { thread_spawn: { parent_thread_id: meta.payload.id } } }, thread_source: 'subagent' } };
  const [record] = read([subagent, { ...meta, ordinal: 1 }, message(4, 'user', 'go')]);

  assert.deepEqual({ sessionId: record?.sessionId, entrypoint: record?.entrypoint }, { sessionId: '01a0a5e2-92d3-79d2-b64c-6c1c954e232f', entrypoint: 'sdk-codex' });
});
