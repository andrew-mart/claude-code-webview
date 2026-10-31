import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUploadOutcome } from '../public/model/project.js';

// The viewer's /api/file/upload reply as the page takes it: what the panel tells apart kept — a file there by the name
// with the name it is there by — anything else the viewer did not do — a folder gone, a folder by the file's name, a
// refusal that is no JSON — as one failure
test('parseUploadOutcome_Should_TellUploadedAndWhyNot_AndTakeAnyOtherReplyAsFailed', () => {
  const replies = [
    { ok: true, path: 'D:/dev/shop/notes.txt' },
    { ok: false, error: 'exists', name: 'README.md' },
    { ok: false, error: 'exists' },
    { ok: false, error: 'too-large' },
    { ok: false, error: 'bad-name' },
    { ok: false, error: 'not-found' },
    { ok: false, error: 'not-a-file' },
    undefined,
    { ok: 'yes' },
  ];

  assert.deepEqual(replies.map(parseUploadOutcome), [
    { ok: true },
    { ok: false, error: 'exists', name: 'README.md' },
    { ok: false, error: 'failed' },
    { ok: false, error: 'too-large' },
    { ok: false, error: 'bad-name' },
    { ok: false, error: 'failed' },
    { ok: false, error: 'failed' },
    { ok: false, error: 'failed' },
    { ok: false, error: 'failed' },
  ]);
});
