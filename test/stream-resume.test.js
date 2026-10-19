import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../test-support/temp-dir.js';
import { createFeedCopy } from '../public/model/feed-copy.js';
import { openingPart, streamTranscript } from '../server/stream.js';
import { createTranscriptCache } from '../server/transcript-cache.js';

/** @param {number} seed — the same seed, the same numbers */
function randomFrom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {number} n */
const stamp = (n) => new Date(Date.UTC(2026, 9, 16, 8, 0, 0) + n * 1000).toISOString();

/**
 * A transcript written as Claude Code writes one, step by step at random: prompts, answers, tool calls and their
 * results, records of no conversation, prompts sent again from an earlier point — a rewind in the terminal — and the
 * file rewritten shorter, or the session going on in another file.
 * @param {() => number} random
 */
function transcriptAt(random) {
  const dir = tempDir('ccw-resume-');
  let files = 0;
  let path = join(dir, `session-${files}.jsonl`);
  /** @type {string[]} */
  let lines = [];
  /** @type {{ uuid: string, parent: string | undefined }[]} */
  let turns = [];
  /** The entry the next one follows. @type {string | undefined} */
  let leaf;
  let made = 0;
  const pick = (/** @type {readonly any[]} */ list) => list[Math.floor(random() * list.length)];
  /** @param {Record<string, unknown>} record */
  const line = (record) => `${JSON.stringify(record)}\n`;
  /** @param {Record<string, unknown>} record @returns {string} */
  const entry = (record) => {
    const uuid = `e${++made}`;
    lines.push(line({ ...record, uuid, parentUuid: leaf ?? null, timestamp: stamp(made), sessionId: 's1', cwd: 'D:\\dev\\x' }));
    leaf = uuid;
    return uuid;
  };
  const prompt = () => {
    const parent = leaf;
    const uuid = entry({ type: 'user', message: { role: 'user', content: `question ${made}` } });
    turns.push({ uuid, parent });
  };
  const answer = () => entry({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `answer ${made}` }] } });
  const tool = () => {
    const id = `tool${made}`;
    entry({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: 'D:/dev/x/a.ts' } }] } });
    entry({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'file text' }] } });
  };
  const aside = () => {
    // records of no conversation: no uuid, or not shown
    if (random() < 0.5) lines.push(line({ type: 'summary', summary: `summary ${++made}`, leafUuid: leaf ?? null }));
    else entry({ type: 'user', isMeta: true, message: { role: 'user', content: `<meta ${made}>` } });
  };

  return {
    path: () => path,
    turns: () => turns,
    /** One step of writing: what was written, for the record. */
    async step() {
      const kind = random();
      const before = lines.length;
      if (kind < 0.45) {
        for (let n = 1 + Math.floor(random() * 4); n > 0; n--) pick([prompt, answer, answer, tool, aside])();
      } else if (kind < 0.62 && turns.length > 0) {
        // a rewind in the terminal: a prompt sent again from where an earlier one was sent
        leaf = pick(turns).parent;
        prompt();
        answer();
      } else if (kind < 0.7 && lines.length > 2) {
        // the file rewritten shorter, then going on
        const keep = Math.floor(random() * lines.length);
        lines = lines.slice(0, keep);
        turns = turns.filter((turn) => lines.some((written) => written.includes(`"uuid":"${turn.uuid}"`)));
        leaf = undefined;
        prompt();
        await writeFile(path, lines.join(''));
        return 'rewritten';
      } else if (kind < 0.75) {
        // the session goes on in another file, what it held copied over
        path = join(dir, `session-${++files}.jsonl`);
        answer();
        await writeFile(path, lines.join(''));
        return 'moved';
      } else {
        answer();
      }
      await appendFile(path, lines.slice(before).join(''));
      return 'appended';
    },
  };
}

/** @param {number} lineStart @param {number} n */
const imageUrl = (lineStart, n) => `/api/image?at=${lineStart}&n=${n}`;

/**
 * A page following the session: its copy of the feed as the stream's events keep it, from a copy it goes on from.
 * @param {{ transcripts: ReturnType<typeof createTranscriptCache>, locate: () => Promise<string>, rewoundAt: () => string | undefined, tail: number | undefined, version: string }} viewer
 * @param {import('../public/model/feed-copy.js').KeptFeed | undefined} from
 */
function follow(viewer, from) {
  const controller = new AbortController();
  const copy = createFeedCopy(from);
  /** @type {string[]} */
  const outOfStep = [];
  /** The events sent, by name. @type {string[]} */
  const events = [];
  const done = streamTranscript({
    locate: viewer.locate,
    running: async () => true,
    scope: 'main',
    imageUrl,
    rewoundAt: viewer.rewoundAt,
    send: (event, data) => {
      events.push(event);
      if (copy.take(event, data) === 'out-of-step') outOfStep.push(`${event} ${JSON.stringify(data).slice(0, 200)}`);
    },
    signal: controller.signal,
    pollMs: 3,
    transcripts: viewer.transcripts,
    tail: viewer.tail,
    version: viewer.version,
    from: from?.token,
  });
  return {
    copy,
    outOfStep,
    events,
    async stop() {
      controller.abort();
      await done;
    },
  };
}

/**
 * The feed a page opening the session now gets whole: what every copy is to match.
 * @param {string} path
 * @param {string | undefined} point
 */
async function wholeFeed(path, point) {
  const read = await createTranscriptCache({ maxFiles: 1 }).read(path, { scope: 'main', imageUrl });
  return openingPart(read.entries, point, undefined).entries;
}

/**
 * Whether the copy holds the latest of the whole feed, all of them from where it starts.
 * @param {ReturnType<typeof createFeedCopy>} copy
 * @param {readonly unknown[]} whole
 */
const matches = (copy, whole) => copy.earlier() + copy.entries().length === whole.length && JSON.stringify(copy.entries()) === JSON.stringify(whole.slice(copy.earlier()));

/**
 * Waits until the copy matches the whole feed — the stream reads the file every few milliseconds.
 * @param {ReturnType<typeof createFeedCopy>} copy
 * @param {readonly unknown[]} whole
 */
async function caughtUp(copy, whole) {
  for (const started = Date.now(); Date.now() - started < 3000; ) {
    if (matches(copy, whole)) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return matches(copy, whole);
}

// Over many sessions written at random — prompts and answers, tool calls, rewinds in the terminal and on the page, the
// file rewritten or moved — a page that stays and a page that leaves now and then and goes on later from the copy it
// kept, trimmed as a browser keeps it, hold the latest of what a page opening the session anew gets whole, entry for
// entry, after every step; the viewer's checks never find them out of step
test('streamTranscript_Should_KeepEveryCopyTheSameAsTheWholeFeed_ThroughRandomSessionsAndResumes', async () => {
  for (let seed = 1; seed <= 40; seed++) {
    const random = randomFrom(seed);
    const transcript = transcriptAt(random);
    await writeFile(transcript.path(), '');
    /** @type {string | undefined} */
    let point;
    const tail = random() < 0.3 ? undefined : 2 + Math.floor(random() * 8);
    const viewer = { transcripts: createTranscriptCache({ maxFiles: 4 }), locate: async () => transcript.path(), rewoundAt: () => point, tail, version: 'v1' };
    const staying = follow(viewer, undefined);
    /** @type {ReturnType<typeof follow> | undefined} */
    let leaving = follow(viewer, undefined);
    /** @type {import('../public/model/feed-copy.js').KeptFeed | undefined} */
    let keptAway;
    try {
      for (let step = 0; step < 14; step++) {
        const turns = transcript.turns();
        const what = random() < 0.12 ? ((point = random() < 0.4 || turns.length === 0 ? undefined : turns[Math.floor(random() * turns.length)]?.uuid), 'rewound on the page') : await transcript.step();
        if (leaving !== undefined && random() < 0.35) {
          // the page leaves, keeping its copy as a browser keeps it: the latest few entries the token covers
          keptAway = leaving.copy.kept(3 + Math.floor(random() * 12));
          await leaving.stop();
          assert.deepEqual(leaving.outOfStep, [], `seed ${seed} step ${step}: out of step before leaving`);
          leaving = undefined;
        } else if (leaving === undefined && random() < 0.5) {
          leaving = follow(viewer, keptAway);
        }
        const whole = await wholeFeed(transcript.path(), point);
        for (const [name, page] of [['staying', staying], ['leaving', leaving]]) {
          if (page === undefined || typeof page === 'string') continue;
          assert.ok(await caughtUp(page.copy, whole), `seed ${seed} step ${step} (${what}): the ${name} page holds ${page.copy.earlier()} + ${JSON.stringify(page.copy.entries().map((one) => (one && typeof one === 'object' && 'uuid' in one ? one.uuid : '?')))}, the whole feed ${JSON.stringify(whole.map((one) => ('uuid' in one ? one.uuid : '?')))}`);
          assert.deepEqual(page.outOfStep, [], `seed ${seed} step ${step} (${what}): the ${name} page out of step`);
        }
      }
    } finally {
      await staying.stop();
      await leaving?.stop();
    }
  }
});

// A page coming back with its copy is sent what came since alone — with nothing new, no entry at all; a copy made by
// another build of the viewer — whose feed may be cut otherwise — or with a token that is none is not gone on from: the
// viewer resets it and sends the session whole
test('streamTranscript_Should_SendNothingAgain_ButResetCopyOfAnotherBuildOrWithNoToken', async () => {
  const path = join(tempDir('ccw-resume-'), 'session.jsonl');
  const line = (/** @type {string} */ uuid, /** @type {string | null} */ parent) => `${JSON.stringify({ type: 'user', uuid, parentUuid: parent, timestamp: stamp(1), message: { role: 'user', content: `question ${uuid}` } })}\n`;
  await writeFile(path, line('u1', null) + line('u2', 'u1') + line('u3', 'u2'));
  const viewer = { transcripts: createTranscriptCache({ maxFiles: 4 }), locate: async () => path, rewoundAt: () => undefined, tail: undefined, version: 'v1' };
  const whole = await wholeFeed(path, undefined);
  const first = follow(viewer, undefined);
  await caughtUp(first.copy, whole);
  await first.stop();
  const kept = first.copy.kept(100);

  const pages = { same: follow(viewer, kept), otherBuild: follow({ ...viewer, version: 'v2' }, kept), noToken: follow(viewer, { ...kept, token: 'not~a~token' }) };
  for (const page of Object.values(pages)) assert.ok(await caughtUp(page.copy, whole));
  for (const page of Object.values(pages)) await page.stop();

  assert.deepEqual(
    { same: pages.same.events, otherBuild: pages.otherBuild.events.slice(0, 2), noToken: pages.noToken.events.slice(0, 2) },
    { same: ['cursor', 'ready'], otherBuild: ['reset', 'entries'], noToken: ['reset', 'entries'] },
  );
});
