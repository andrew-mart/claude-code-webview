// @ts-check
// The stream of transcript entries: everything already in the file, then every appended line — only those on the
// conversation's active branch (see branch.js). A rewind that shows up later rebuilds the feed from the start.
// The file is read through the transcript cache: a page that opens the session again gets what was read before.
import { setTimeout as delay } from 'node:timers/promises';
import { rewoundEntries } from './branch.js';

const batchSize = 1000;

/**
 * @typedef {(event: 'entries' | 'earlier' | 'ready' | 'reset' | 'missing', data: unknown) => void} Send
 * @typedef {(lineStart: number, n: number) => string} ImageUrl — the link to the n-th image of the entry on the line that starts at lineStart
 * @typedef {import('./transcript-cache.js').CachedEntry} CachedEntry
 * @typedef {ReturnType<typeof import('./transcript-cache.js').createTranscriptCache>} TranscriptCache
 */

/**
 * Runs until the signal is aborted. The file is looked up again on every round: after /cd it moves.
 * @param {{ locate: () => Promise<string | undefined>, scope: 'main' | 'subagent', imageUrl: ImageUrl, rewoundAt: () => string | undefined, send: Send, signal: AbortSignal, pollMs: number, transcripts: TranscriptCache, tail: number | undefined }} options
 *   rewoundAt — the prompt this page rewound the session to, if it did; tail — how many of the latest entries to send
 *   at first ("earlier" tells how many were left out); undefined — all of them
 */
export async function streamTranscript({ locate, scope, imageUrl, rewoundAt, send, signal, pollMs, transcripts, tail }) {
  /** How many of the file's entries this page has been given. */
  let sent = 0;
  /** @type {number | undefined} */
  let generation;
  // said once each: the transcript is missing — a session started just now has none before its first message — and,
  // once it is there, that the feed is ready
  let missingSaid = false;
  let readySaid = false;
  /** Entries that already have a prompt sent from them: another prompt from there means the conversation was rewound. */
  /** @type {Set<string>} */
  let promptParents = new Set();
  let point = rewoundAt();
  /** The file followed, kept read while the page follows it: reading other sessions does not push it out. */
  /** @type {{ path: string, letGo: () => void } | undefined} */
  let kept;
  const restart = () => {
    sent = 0;
    promptParents = new Set();
    send('reset', null);
  };
  try {
    while (!signal.aborted) {
      const path = await locate();
      if (path !== kept?.path) {
        kept?.letGo();
        kept = path === undefined ? undefined : { path, letGo: transcripts.keep(path, scope) };
      }
      const read = path === undefined ? undefined : await transcripts.read(path, { scope, imageUrl }).catch(() => undefined);
      if (read === undefined) {
        if (!missingSaid) send('missing', null);
        missingSaid = true;
      } else {
        const nextPoint = rewoundAt();
        // The file was rewritten, or the page rewound the session: the feed starts over.
        if ((generation !== undefined && read.generation !== generation) || (nextPoint !== point && sent > 0)) restart();
        generation = read.generation;
        point = nextPoint;
        if (read.entries.length > sent) {
          const fresh = read.entries.slice(sent);
          // A prompt from an entry that already had one, whose branch the page has already shown: rebuild the feed.
          if (fresh.some(({ link }) => link.turn && link.parent !== undefined && promptParents.has(link.parent))) {
            restart();
            continue;
          }
          for (const { link } of fresh) if (link.turn && link.parent !== undefined) promptParents.add(link.parent);
          // A long session opens with its latest entries; the page asks for the rest when the reader wants it.
          const part = sent === 0 ? openingPart(read.entries, point, tail) : { earlier: 0, entries: shownEntries(fresh, rewoundEntries(read.entries.map(({ link }) => link), point)) };
          if (part.earlier > 0) send('earlier', { count: part.earlier });
          sendBatches(part.entries, send);
          sent = read.entries.length;
        }
        if (!readySaid) send('ready', null);
        readySaid = true;
      }
      await delay(pollMs, undefined, { signal }).catch(() => undefined);
    }
  } finally {
    kept?.letGo();
  }
}

/**
 * What a page gets of a transcript when it opens it: the entries it shows, on the active branch — the latest tail of
 * them, and how many came before.
 * @param {readonly CachedEntry[]} entries — the whole transcript
 * @param {string | undefined} rewoundAt — the prompt the page rewound the session to, if it did
 * @param {number | undefined} tail — undefined: all of them
 * @returns {{ earlier: number, entries: Record<string, unknown>[] }}
 */
export function openingPart(entries, rewoundAt, tail) {
  const shown = shownEntries(entries, rewoundEntries(entries.map(({ link }) => link), rewoundAt));
  const earlier = tail === undefined ? 0 : Math.max(shown.length - tail, 0);
  return { earlier, entries: shown.slice(earlier) };
}

/**
 * What the page gets of these entries: the ones it shows, on the active branch.
 * @param {readonly CachedEntry[]} entries
 * @param {ReadonlySet<string>} hidden — entries off the active branch
 * @returns {Record<string, unknown>[]}
 */
function shownEntries(entries, hidden) {
  return entries.flatMap(({ slim, link }) => (slim === undefined || (link.uuid !== undefined && hidden.has(link.uuid)) ? [] : [slim]));
}

/**
 * @param {readonly Record<string, unknown>[]} entries
 * @param {Send} send
 */
function sendBatches(entries, send) {
  for (let start = 0; start < entries.length; start += batchSize) send('entries', entries.slice(start, start + batchSize));
}
