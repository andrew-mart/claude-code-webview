import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretEntry } from '../public/model/entry.js';

const at = '2026-10-09T07:02:11.686Z';

test('interpretEntry_Should_TurnTypedUserTextIntoPrompt', () => {
  const entry = {
    type: 'user',
    uuid: 'u1',
    timestamp: at,
    promptSource: 'typed',
    message: { role: 'user', content: 'Build a session viewer' },
  };

  assert.deepEqual(interpretEntry(entry), [
    { kind: 'prompt', id: 'u1', at, text: 'Build a session viewer', images: [], queued: false },
  ]);
});

test('interpretEntry_Should_CollectPromptTextAndImagesWithoutSystemReminders', () => {
  const entry = {
    type: 'user',
    uuid: 'u4',
    timestamp: at,
    promptSource: 'queued',
    message: {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } },
        { type: 'text', text: '[Image #1] the legend overlaps' },
        { type: 'text', text: '<system-reminder>\ninternal\n</system-reminder>' },
      ],
    },
  };

  assert.deepEqual(interpretEntry(entry), [
    {
      kind: 'prompt',
      id: 'u4',
      at,
      text: '[Image #1] the legend overlaps',
      images: [{ url: 'data:image/png;base64,iVBOR' }],
      queued: true,
    },
  ]);
});

/** @param {string} uuid @param {unknown} content @param {Record<string, unknown>} [extra] */
const userEntry = (uuid, content, extra = {}) => ({ type: 'user', uuid, timestamp: at, message: { role: 'user', content }, ...extra });

test('interpretEntry_Should_ShowSlashCommandWithArgsAndItsOutput', () => {
  const command = userEntry(
    'c1',
    '<command-name>/cd</command-name>\n            <command-message>cd</command-message>\n            <command-args>D:/dev/x</command-args>',
  );
  const output = userEntry('c2', '<local-command-stdout>Moved to \u001b[1mD:\\dev\\x\u001b[22m</local-command-stdout>');

  assert.deepEqual(
    [...interpretEntry(command), ...interpretEntry(output)],
    [
      { kind: 'command', id: 'c1', at, text: '/cd D:/dev/x' },
      { kind: 'command-output', id: 'c2', at, text: 'Moved to D:\\dev\\x', isError: false },
    ],
  );
});

test('interpretEntry_Should_ShowShellModeInputAndStderrAsError', () => {
  const input = userEntry('b1', '<bash-input>git status</bash-input>');
  const output = userEntry('b2', '<bash-stdout></bash-stdout><bash-stderr>fatal: not a git repository</bash-stderr>');

  assert.deepEqual(
    [...interpretEntry(input), ...interpretEntry(output)],
    [
      { kind: 'command', id: 'b1', at, text: '! git status' },
      { kind: 'command-output', id: 'b2', at, text: 'fatal: not a git repository', isError: true },
    ],
  );
});

test('interpretEntry_Should_MarkInterruptionInsteadOfPrompt', () => {
  const plain = userEntry('i1', [{ type: 'text', text: '[Request interrupted by user]' }]);
  const forTool = userEntry('i2', [{ type: 'text', text: '[Request interrupted by user for tool use]' }]);

  assert.deepEqual(
    [...interpretEntry(plain), ...interpretEntry(forTool)],
    [
      { kind: 'interrupted', id: 'i1', at },
      { kind: 'interrupted', id: 'i2', at },
    ],
  );
});

test('interpretEntry_Should_ReadBackgroundTaskNotification', () => {
  const entry = userEntry(
    't1',
    '<task-notification>\n<task-id>by7</task-id>\n<tool-use-id>toolu_9</tool-use-id>\n<status>completed</status>\n<summary>Background command "Run tests" completed (exit code 0)</summary>\n</task-notification>',
    { origin: { kind: 'task-notification' }, promptSource: 'system' },
  );

  assert.deepEqual(interpretEntry(entry), [
    {
      kind: 'task-notification',
      id: 't1',
      at,
      toolUseId: 'toolu_9',
      status: 'completed',
      summary: 'Background command "Run tests" completed (exit code 0)',
    },
  ]);
});

test('interpretEntry_Should_TurnSubagentHandBackIntoReportWithoutHarnessPreamble', () => {
  const entry = userEntry(
    'p1',
    '[Subagent hand-back] The text below is the final report. The report follows:\n  ## Status\n  \n  All done.',
    { origin: { kind: 'peer', from: 'a0957', name: 'general-purpose' } },
  );

  assert.deepEqual(interpretEntry(entry), [
    { kind: 'subagent-report', id: 'p1', at, name: 'general-purpose', text: '## Status\n\nAll done.' },
  ]);
});

test('interpretEntry_Should_SeparateServiceTextFromPrompts', () => {
  const summary = userEntry('s1', 'This session is being continued from a previous conversation.', { isCompactSummary: true });
  const meta = userEntry('m1', [{ type: 'text', text: '# Skill body' }], { isMeta: true });

  assert.deepEqual(
    [...interpretEntry(summary), ...interpretEntry(meta)],
    [
      { kind: 'context-summary', id: 's1', at, text: 'This session is being continued from a previous conversation.' },
      { kind: 'meta', id: 'm1', at, text: '# Skill body' },
    ],
  );
});

/** @param {string} uuid @param {unknown[]} content @param {Record<string, unknown>} [extra] @param {Record<string, unknown>} [message] */
const assistantEntry = (uuid, content, extra = {}, message = {}) => ({
  type: 'assistant',
  uuid,
  timestamp: at,
  message: { role: 'assistant', model: 'claude-opus-5-5', content, ...message },
  ...extra,
});

test('interpretEntry_Should_KeepThinkingDurationEvenWhenTextIsNotStored', () => {
  const visible = assistantEntry('th1', [{ type: 'thinking', thinking: 'Format first.', signature: 'x' }], { thinkingDurationMs: 4200 });
  const redacted = assistantEntry('th2', [{ type: 'thinking', thinking: '', signature: 'x' }]);

  assert.deepEqual(
    [...interpretEntry(visible), ...interpretEntry(redacted)],
    [
      { kind: 'thinking', id: 'th1:0', at, text: 'Format first.', durationMs: 4200 },
      { kind: 'thinking', id: 'th2:0', at, text: '', durationMs: undefined },
    ],
  );
});

test('interpretEntry_Should_ReportContextSizeFromUsage', () => {
  const entry = assistantEntry('us1', [], {}, { usage: { input_tokens: 2, cache_creation_input_tokens: 400, cache_read_input_tokens: 28600, output_tokens: 90 } });

  assert.deepEqual(interpretEntry(entry), [{ kind: 'usage', id: 'us1', at, model: 'claude-opus-5-5', contextTokens: 29002 }]);
});

test('interpretEntry_Should_ShowApiErrorAndSkipSyntheticNoResponse', () => {
  const apiError = assistantEntry('e1', [{ type: 'text', text: 'API Error: Connection dropped (ECONNRESET)' }], { isApiErrorMessage: true }, { model: '<synthetic>' });
  const noResponse = assistantEntry('e2', [{ type: 'text', text: 'No response requested.' }], {}, { model: '<synthetic>' });
  const empty = assistantEntry('e3', [{ type: 'text', text: '' }], {}, { model: '<synthetic>' });

  assert.deepEqual(
    [...interpretEntry(apiError), ...interpretEntry(noResponse), ...interpretEntry(empty)],
    [{ kind: 'notice', id: 'e1', at, tone: 'error', text: 'API Error: Connection dropped (ECONNRESET)' }],
  );
});

/** @param {string} uuid @param {string} subtype @param {Record<string, unknown>} extra */
const systemEntry = (uuid, subtype, extra) => ({ type: 'system', subtype, uuid, timestamp: at, ...extra });

test('interpretEntry_Should_MarkTurnEndAndCompaction', () => {
  const turnEnd = systemEntry('sy1', 'turn_duration', { durationMs: 350844, messageCount: 176 });
  const compacted = systemEntry('sy2', 'compact_boundary', { content: 'Conversation compacted', compactMetadata: { trigger: 'auto', preTokens: 971196 } });

  assert.deepEqual(
    [...interpretEntry(turnEnd), ...interpretEntry(compacted)],
    [
      { kind: 'turn-end', id: 'sy1', at, durationMs: 350844 },
      { kind: 'compacted', id: 'sy2', at, trigger: 'auto', preTokens: 971196 },
    ],
  );
});

test('interpretEntry_Should_ShowLocalCommandRecordedBySystem', () => {
  const entry = systemEntry('sy3', 'local_command', {
    content: '<command-name>/remote-control</command-name>\n            <command-message>remote-control</command-message>\n            <command-args></command-args>',
  });

  assert.deepEqual(interpretEntry(entry), [{ kind: 'command', id: 'sy3', at, text: '/remote-control' }]);
});

for (const [level, tone] of [
  ['notice', 'info'],
  ['warning', 'warning'],
  ['error', 'error'],
]) {
  test(`interpretEntry_Should_ShowSystemTextWithLevel_${level}_AsTone_${tone}`, () => {
    const entry = systemEntry('sy4', 'informational', { content: 'Reusing xhigh effort', level });

    assert.deepEqual(interpretEntry(entry), [{ kind: 'notice', id: 'sy4', at, tone, text: 'Reusing xhigh effort' }]);
  });
}

test('interpretEntry_Should_StaySilentOnStopHookWithoutErrors', () => {
  const quiet = systemEntry('sy5', 'stop_hook_summary', { hookCount: 1, hookErrors: [], preventedContinuation: false, level: 'suggestion' });
  const failed = systemEntry('sy6', 'stop_hook_summary', { hookCount: 1, hookErrors: ['hook exited with 2'], preventedContinuation: false, level: 'suggestion' });

  assert.deepEqual(
    [...interpretEntry(quiet), ...interpretEntry(failed)],
    [{ kind: 'notice', id: 'sy6', at, tone: 'warning', text: 'hook exited with 2' }],
  );
});

test('interpretEntry_Should_ReadSessionTitleAndCost', () => {
  assert.deepEqual(
    [
      ...interpretEntry({ type: 'ai-title', aiTitle: 'Session web view', sessionId: 's' }),
      ...interpretEntry({ type: 'custom-title', customTitle: 'Viewer', sessionId: 's' }),
      ...interpretEntry({ type: 'cost-state', totalCostUSD: 161.27, sessionId: 's' }),
    ],
    [
      { kind: 'title', title: 'Session web view', custom: false },
      { kind: 'title', title: 'Viewer', custom: true },
      { kind: 'cost', usd: 161.27 },
    ],
  );
});

test('interpretEntry_Should_IgnoreUnknownAndMalformedEntries', () => {
  assert.deepEqual(
    [
      ...interpretEntry(null),
      ...interpretEntry('text'),
      ...interpretEntry({ type: 'file-history-snapshot', messageId: 'x' }),
      ...interpretEntry({ type: 'user', uuid: 'u', timestamp: at }),
    ],
    [],
  );
});

/** @param {string} uuid @param {Record<string, unknown>} attachment */
const queuedEntry = (uuid, attachment) => ({ type: 'attachment', uuid, timestamp: at, attachment: { type: 'queued_command', ...attachment } });

test('interpretEntry_Should_ShowMessagesSentWhileAgentWorked', () => {
  const human = queuedEntry('q1', { commandMode: 'prompt', origin: { kind: 'human' }, prompt: 'Do it in another folder under dev, though.' });
  const peer = queuedEntry('q2', { commandMode: 'prompt', origin: { kind: 'peer', name: 'Explore' }, prompt: '[Subagent hand-back] The report follows:\n  Found the session.' });
  const notification = queuedEntry('q3', { commandMode: 'task-notification', prompt: '<task-notification>…</task-notification>' });

  assert.deepEqual(
    [...interpretEntry(human), ...interpretEntry(peer), ...interpretEntry(notification)],
    [
      { kind: 'prompt', id: 'q1', at, text: 'Do it in another folder under dev, though.', images: [], queued: true },
      { kind: 'subagent-report', id: 'q2', at, name: 'Explore', text: 'Found the session.' },
    ],
  );
});

test('interpretEntry_Should_TurnAssistantBlocksIntoTextAndToolCall', () => {
  const entry = {
    type: 'assistant',
    uuid: 'a1',
    timestamp: at,
    message: {
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [
        { type: 'text', text: 'Let me check the format.' },
        { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls', description: 'List files' } },
      ],
    },
  };

  assert.deepEqual(interpretEntry(entry), [
    { kind: 'text', id: 'a1:0', at, text: 'Let me check the format.' },
    { kind: 'tool-call', id: 'toolu_1', at, name: 'Bash', input: { command: 'ls', description: 'List files' } },
  ]);
});

test('interpretEntry_Should_TurnToolResultIntoPartsLinkedToCall', () => {
  const entry = {
    type: 'user',
    uuid: 'u2',
    timestamp: at,
    toolUseResult: { stdout: 'a.txt', stderr: '', interrupted: false },
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          is_error: true,
          content: [
            { type: 'text', text: 'a.txt' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } },
          ],
        },
      ],
    },
  };

  assert.deepEqual(interpretEntry(entry), [
    {
      kind: 'tool-result',
      id: 'u2:0',
      at,
      toolUseId: 'toolu_1',
      isError: true,
      parts: [
        { type: 'text', text: 'a.txt' },
        { type: 'image', image: { url: 'data:image/png;base64,iVBOR' } },
      ],
      details: { stdout: 'a.txt', stderr: '', interrupted: false },
    },
  ]);
});

test('interpretEntry_Should_ReadStringToolResultAsSingleTextPart', () => {
  const entry = {
    type: 'user',
    uuid: 'u3',
    timestamp: at,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'Exit code 4' }] },
  };

  assert.deepEqual(interpretEntry(entry), [
    {
      kind: 'tool-result',
      id: 'u3:0',
      at,
      toolUseId: 'toolu_2',
      isError: false,
      parts: [{ type: 'text', text: 'Exit code 4' }],
      details: undefined,
    },
  ]);
});

test('interpretEntry_Should_ShowImagesTheServerLinksToAndNoImagesFromOtherSites', () => {
  const entry = {
    type: 'user',
    uuid: 'u5',
    timestamp: at,
    message: {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'webview', url: '/api/image?session=s1&at=0&n=0', media_type: 'image/png' } },
        // an image the API fetched by URL: showing it would tell that site who opened the session and when
        { type: 'image', source: { type: 'url', url: 'https://tracker.example/pixel.png' } },
        { type: 'image', source: { type: 'webview', url: 'https://tracker.example/pixel.png', media_type: 'image/png' } },
        { type: 'text', text: 'two screenshots' },
      ],
    },
  };

  const [prompt] = interpretEntry(entry);

  assert.deepEqual(prompt?.kind === 'prompt' ? prompt.images : undefined, [{ url: '/api/image?session=s1&at=0&n=0' }]);
});
