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

  assert.deepEqual(slimEntry(editResult, 'main'), {
    type: 'user',
    uuid: 'u1',
    timestamp: at,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
    toolUseResult: { filePath: 'a.cs', structuredPatch: [] },
  });
  assert.deepEqual(slimEntry(thinking, 'main'), {
    type: 'assistant',
    uuid: 'a1',
    timestamp: at,
    thinkingDurationMs: 900,
    message: { role: 'assistant', model: 'm', content: [{ type: 'thinking', thinking: '' }] },
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

  assert.deepEqual(slimEntry(queued, 'main'), {
    type: 'attachment',
    uuid: 'q1',
    timestamp: at,
    attachment: { type: 'queued_command', commandMode: 'prompt', origin: { kind: 'human' }, prompt: 'Actually, do it in another folder' },
  });
  assert.equal(slimEntry(hook, 'main'), undefined);
});

test('slimEntry_Should_SkipServiceRecordsAndSidechainOfMainTranscript', () => {
  const sidechain = { type: 'user', uuid: 's1', timestamp: at, isSidechain: true, message: { role: 'user', content: 'hi' } };

  assert.equal(slimEntry({ type: 'file-history-snapshot', messageId: 'x' }, 'main'), undefined);
  assert.equal(slimEntry({ type: 'attachment', attachment: { type: 'prompt_snapshot' } }, 'main'), undefined);
  assert.equal(slimEntry(sidechain, 'main'), undefined);
  assert.deepEqual(slimEntry(sidechain, 'subagent'), { type: 'user', uuid: 's1', timestamp: at, message: { role: 'user', content: 'hi' } });
});
