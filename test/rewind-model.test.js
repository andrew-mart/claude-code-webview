import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRewindReply, rewindMessage } from '../public/model/rewind.js';

test('parseRewindReply_Should_AcceptOnlyServerReplies', () => {
  assert.deepEqual(parseRewindReply({ ok: true, prompt: 'Now test it' }), { ok: true, prompt: 'Now test it' });
  assert.deepEqual(parseRewindReply({ ok: true }), { ok: true, prompt: undefined });
  assert.deepEqual(parseRewindReply({ ok: false, error: 'busy' }), { ok: false, error: 'busy' });
  assert.equal(parseRewindReply('Forbidden host'), undefined);
});

test('rewindMessage_Should_SayWhatHappenedAndWhatToDoNext', () => {
  assert.equal(rewindMessage({ ok: true, prompt: 'Now test it' }), 'Rewound. The message is back in the box — edit it and send.');
  assert.equal(rewindMessage({ ok: true, prompt: undefined }), 'Rewound.');
  assert.equal(rewindMessage({ ok: false, error: 'busy' }), 'Claude is working — press Stop or wait, then rewind.');
  assert.equal(rewindMessage({ ok: false, error: 'no-code-changes' }), 'This message has no code changes to restore.');
  assert.equal(rewindMessage({ ok: false, error: 'something new' }), 'The rewind did not go through (something new) — check the terminal.');
});
