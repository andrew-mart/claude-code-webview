import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slimEntry } from '../server/slim.js';

const at = '2026-10-09T07:02:11.686Z';

test('slimEntry_Should_DropHeavyFieldsNotShownInFeed', () => {
  const editResult = {
    type: 'user',
    uuid: 'u1',
    timestamp: at,
    isSidechain: false,
    cwd: 'D:\\dev\\x',
    wireToolInputs: { big: true },
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
    toolUseResult: { filePath: 'a.cs', originalFile: 'the whole file', structuredPatch: [] },
  };
  const thinking = {
    type: 'assistant',
    uuid: 'a1',
    timestamp: at,
    thinkingDurationMs: 900,
    message: { role: 'assistant', model: 'm', content: [{ type: 'thinking', thinking: '', signature: 'base64…' }] },
  };

  assert.deepEqual(slimEntry(editResult, 'main', linkTo), {
    type: 'user',
    uuid: 'u1',
    timestamp: at,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
    toolUseResult: { filePath: 'a.cs', structuredPatch: [] },
  });
  assert.deepEqual(slimEntry(thinking, 'main', linkTo), {
    type: 'assistant',
    uuid: 'a1',
    timestamp: at,
    thinkingDurationMs: 900,
    message: { role: 'assistant', model: 'm', content: [{ type: 'thinking', thinking: '' }] },
  });
});

/** @param {string} mediaType */
const base64Image = (mediaType) => ({ type: 'image', source: { type: 'base64', data: 'iVBORw0KGgo', media_type: mediaType } });
/** @param {number} n */
const linkTo = (n) => `/api/image?at=0&n=${n}`;
/** @param {number} n @param {string} mediaType */
const linkedImage = (n, mediaType) => ({ type: 'image', source: { type: 'webview', url: linkTo(n), media_type: mediaType } });

test('slimEntry_Should_SendImagesAsServerLinksNumberedInEntryOrder', () => {
  const pastedPrompt = {
    type: 'user',
    uuid: 'u1',
    timestamp: at,
    message: { role: 'user', content: [base64Image('image/png'), { type: 'text', text: 'two screenshots' }, base64Image('image/jpeg')] },
  };
  // Read of an image: the same bytes both in tool_result and in toolUseResult.file
  const readImage = {
    type: 'user',
    uuid: 'u2',
    timestamp: at,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: [base64Image('image/png')] }] },
    toolUseResult: { type: 'image', file: { base64: 'iVBORw0KGgo', type: 'image/png', originalSize: 143983, dimensions: { displayWidth: 1400, displayHeight: 900 } } },
  };

  assert.deepEqual(slimEntry(pastedPrompt, 'main', linkTo)?.message, {
    role: 'user',
    content: [linkedImage(0, 'image/png'), { type: 'text', text: 'two screenshots' }, linkedImage(1, 'image/jpeg')],
  });
  assert.deepEqual(slimEntry(readImage, 'main', linkTo), {
    type: 'user',
    uuid: 'u2',
    timestamp: at,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: [linkedImage(0, 'image/png')] }] },
    toolUseResult: { type: 'image', file: { type: 'image/png', originalSize: 143983, dimensions: { displayWidth: 1400, displayHeight: 900 } } },
  });
});

test('slimEntry_Should_KeepMessageSentWhileAgentWorkedAndDropOtherAttachments', () => {
  const queued = {
    type: 'attachment',
    uuid: 'q1',
    timestamp: at,
    cwd: 'D:\\dev\\x',
    attachment: { type: 'queued_command', commandMode: 'prompt', origin: { kind: 'human' }, prompt: 'Actually, do it in another folder', source_uuid: 's', delivery_id: 'd' },
  };
  const hook = { type: 'attachment', uuid: 'h1', timestamp: at, attachment: { type: 'hook_success', stdout: 'lots of text' } };

  assert.deepEqual(slimEntry(queued, 'main', linkTo), {
    type: 'attachment',
    uuid: 'q1',
    timestamp: at,
    attachment: { type: 'queued_command', commandMode: 'prompt', origin: { kind: 'human' }, prompt: 'Actually, do it in another folder' },
  });
  assert.equal(slimEntry(hook, 'main', linkTo), undefined);
});

test('slimEntry_Should_SkipServiceRecordsAndSidechainOfMainTranscript', () => {
  const sidechain = { type: 'user', uuid: 's1', timestamp: at, isSidechain: true, message: { role: 'user', content: 'hi' } };

  assert.equal(slimEntry({ type: 'file-history-snapshot', messageId: 'x' }, 'main', linkTo), undefined);
  assert.equal(slimEntry({ type: 'attachment', attachment: { type: 'prompt_snapshot' } }, 'main', linkTo), undefined);
  assert.equal(slimEntry(sidechain, 'main', linkTo), undefined);
  assert.deepEqual(slimEntry(sidechain, 'subagent', linkTo), { type: 'user', uuid: 's1', timestamp: at, message: { role: 'user', content: 'hi' } });
});

test('slimEntry_Should_KeepWhatHeaderShowsEffortAndModelsOfCosts', () => {
  const answer = { type: 'assistant', uuid: 'a1', timestamp: at, effort: 'xhigh', requestId: 'r', message: { role: 'assistant', model: 'm', content: [] } };
  const costs = { type: 'cost-state', totalCostUSD: 3.5, modelUsage: { 'claude-opus-4-6[1m]': { costUSD: 3.5 } }, sessionId: 's' };

  assert.deepEqual(slimEntry(answer, 'main', linkTo), { type: 'assistant', uuid: 'a1', timestamp: at, effort: 'xhigh', message: { role: 'assistant', model: 'm', content: [] } });
  assert.deepEqual(slimEntry(costs, 'main', linkTo), { type: 'cost-state', totalCostUSD: 3.5, modelUsage: { 'claude-opus-4-6[1m]': { costUSD: 3.5 } } });
});

test('slimEntry_Should_KeepOfMessageOnlyWhatFeedReads', () => {
  const usage = { input_tokens: 2, cache_creation_input_tokens: 300, cache_read_input_tokens: 4000, output_tokens: 90, iterations: [{ input_tokens: 2 }], service_tier: 'standard' };
  const answer = {
    type: 'assistant',
    uuid: 'a1',
    timestamp: at,
    message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'm', content: [{ type: 'text', text: 'Done' }], usage, container: null, input_transformations: [{ kind: 'huge' }], context_management: null },
  };

  assert.deepEqual(slimEntry(answer, 'main', linkTo)?.message, {
    role: 'assistant',
    model: 'm',
    content: [{ type: 'text', text: 'Done' }],
    usage: { input_tokens: 2, cache_creation_input_tokens: 300, cache_read_input_tokens: 4000 },
  });
});

// A prompt sent while Claude works waits in Claude Code's queue; the transcript notes the queue before the prompt itself
test('slimEntry_Should_KeepQueueNotesSoPageShowsPromptsWaitingInQueue', () => {
  const sessionId = '0f6c5d1e-1a2b-4c3d-8e9f-001122334455';

  assert.deepEqual(
    [
      slimEntry({ type: 'queue-operation', operation: 'enqueue', timestamp: at, sessionId, content: 'And the tests' }, 'main', linkTo),
      slimEntry({ type: 'queue-operation', operation: 'dequeue', timestamp: at, sessionId }, 'main', linkTo),
    ],
    [
      { type: 'queue-operation', operation: 'enqueue', timestamp: at, content: 'And the tests' },
      { type: 'queue-operation', operation: 'dequeue', timestamp: at },
    ],
  );
});
