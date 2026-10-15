import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRecord } from '../public/model/narrow.js';
import { streamTranscript } from '../server/stream.js';
import { createTranscriptCache } from '../server/transcript-cache.js';

const at = '2026-10-10T07:02:11.686Z';
/** @param {string} uuid @param {string} text */
const promptLine = (uuid, text) => `${JSON.stringify({ type: 'user', uuid, timestamp: at, cwd: 'D:\\dev\\x', message: { role: 'user', content: text } })}\n`;
/** @param {number} lineStart @param {number} n */
const imageUrl = (lineStart, n) => `/api/image?at=${lineStart}&n=${n}`;

/** A transcript of one prompt, in a folder of its own. @param {string} uuid @param {string} text */
async function transcript(uuid, text) {
  const path = join(await mkdtemp(join(tmpdir(), 'ccw-stream-')), 'session.jsonl');
  await writeFile(path, promptLine(uuid, text));
  return path;
}

/**
 * A page following the transcript: the events it is sent, each entries event as the uuids it brings.
 * @param {ReturnType<typeof createTranscriptCache>} transcripts
 * @param {string} path
 */
function following(transcripts, path) {
  const controller = new AbortController();
  /** @type {{ event: string, uuids?: unknown[] }[]} */
  const events = [];
  /** @type {import('../server/stream.js').Send} */
  const send = (event, data) => {
    events.push(event === 'entries' && Array.isArray(data) ? { event, uuids: data.map((entry) => (isRecord(entry) ? entry.uuid : undefined)) } : { event });
  };
  const done = streamTranscript({ locate: async () => path, scope: 'main', imageUrl, rewoundAt: () => undefined, send, signal: controller.signal, pollMs: 10, transcripts, tail: undefined });
  return {
    events,
    /** @param {(sent: typeof events) => boolean} seen */
    async until(seen) {
      for (const started = Date.now(); !seen(events); ) {
        if (Date.now() - started > 5000) throw new Error(`Not sent in time: ${JSON.stringify(events)}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
    async close() {
      controller.abort();
      await done;
    },
  };
}

// A page follows a session while the viewer reads more others than it keeps read — the latest sessions saved for
// reading offline, another page's — the feed goes on from where it was, not over from the start
test('streamTranscript_Should_GoOnFromWhereItWas_When_MoreFilesReadMeanwhileThanCacheKeeps', async (t) => {
  const followed = await transcript('u1', 'Followed question');
  const transcripts = createTranscriptCache({ maxFiles: 1 });
  const page = following(transcripts, followed);
  t.after(page.close);
  await page.until((sent) => sent.some(({ event }) => event === 'ready'));

  await transcripts.read(await transcript('o1', 'Another question'), { scope: 'main', imageUrl });
  await appendFile(followed, promptLine('u2', 'Next question'));
  await page.until((sent) => sent.some(({ uuids }) => uuids?.includes('u2')));

  assert.deepEqual(page.events, [{ event: 'entries', uuids: ['u1'] }, { event: 'ready' }, { event: 'entries', uuids: ['u2'] }]);
});

// A page that closes the feed lets the file go: reading others pushes it out again
test('streamTranscript_Should_LetFileGo_When_PageCloses', async () => {
  const followed = await transcript('u1', 'Followed question');
  const transcripts = createTranscriptCache({ maxFiles: 1 });
  const page = following(transcripts, followed);
  await page.until((sent) => sent.some(({ event }) => event === 'ready'));
  const before = await transcripts.read(followed, { scope: 'main', imageUrl });

  await page.close();
  await transcripts.read(await transcript('o1', 'Another question'), { scope: 'main', imageUrl });
  const after = await transcripts.read(followed, { scope: 'main', imageUrl });

  assert.notEqual(after.generation, before.generation);
});
