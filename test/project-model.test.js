import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUploadOutcome, receiveDownload } from '../public/model/project.js';

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

/**
 * A download's body, coming in these parts — then cut, if asked: the viewer gone midway, a zip it could not finish.
 * @param {readonly string[]} parts @param {'whole' | 'cut'} end
 */
const bodyOf = (parts, end) =>
  new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
      if (end === 'cut') controller.error(new Error('connection reset'));
      else controller.close();
    },
  });

// The viewer's /api/file/download and /api/folder/download as the page takes them: the file, its bytes counted as they
// come — out of its length when the viewer tells it; a zip being made has none
test('receiveDownload_Should_CountBytesAsTheyCome_OutOfLengthWhenTold_AndGiveFile', async () => {
  /** @param {Response} response */
  const received = async (response) => {
    /** @type {[number, number | undefined][]} */
    const counted = [];
    const outcome = await receiveDownload(response, (bytes, total) => counted.push([bytes, total]));
    return { counted, text: outcome.ok ? await outcome.file.text() : outcome };
  };

  assert.deepEqual(
    {
      file: await received(new Response(bodyOf(['Hello, ', 'shop!'], 'whole'), { headers: { 'Content-Length': '12' } })),
      zip: await received(new Response(bodyOf(['PK', 'zip'], 'whole'), { headers: { 'Content-Type': 'application/zip' } })),
    },
    {
      file: { counted: [[7, 12], [12, 12]], text: 'Hello, shop!' },
      zip: { counted: [[2, undefined], [5, undefined]], text: 'PKzip' },
    },
  );
});

// What the panel tells apart: a file or folder no longer there, a folder too big to zip; anything else — no answer,
// another refusal, a download cut midway — is one failure
test('receiveDownload_Should_TellWhyNot_When_ViewerRefusedOrCutIt', async () => {
  const replies = [
    new Response('Cannot download: not-found', { status: 404 }),
    new Response('Cannot download the folder: too-large', { status: 413 }),
    new Response('Cannot download: not-a-file', { status: 400 }),
    undefined,
    new Response(bodyOf(['PK'], 'cut')),
  ];

  const outcomes = [];
  for (const reply of replies) outcomes.push(await receiveDownload(reply, () => {}));

  assert.deepEqual(outcomes, [
    { ok: false, error: 'not-found' },
    { ok: false, error: 'too-large' },
    { ok: false, error: 'failed' },
    { ok: false, error: 'failed' },
    { ok: false, error: 'failed' },
  ]);
});
