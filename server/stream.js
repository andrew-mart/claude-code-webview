// @ts-check
// The stream of transcript entries: everything already in the file, then every appended line — only those on the
// conversation's active branch (see branch.js). A rewind that shows up later rebuilds the feed from the start.
// The file is read through the transcript cache: a page that opens the session again gets what was read before.
// After what it sends each time the stream tells the page where its reading stands — a token — with the count of entries
// the page should hold and a hash of the latest of them, for the page to check its copy by (feed-check.js). A page that
// comes back with a copy and its token is sent what came since alone: the stream goes on as if it had never stopped.
// The token holds the entries read for the page chained one on another, the rewind it was read under and the viewer's
// build: a file rewritten or moved since, a rewind or another build, and the copy is dropped — the feed starts over.
import { setTimeout as delay } from 'node:timers/promises';
import { checkedEntries, chainOn, chainStart, tailCheck } from '../public/model/feed-check.js';
import { rewoundEntries } from './branch.js';

const batchSize = 1000;

/**
 * @typedef {(event: 'entries' | 'earlier' | 'ready' | 'reset' | 'missing' | 'cursor' | 'session-status', data: unknown) => void} Send
 * @typedef {{ version: string, sent: number, chain: string, point: string | undefined }} Place — where a page's reading of
 *   the transcript stands: how many of its entries were read for it, chained, under which rewind, by which build
 * @typedef {(lineStart: number, n: number) => string} ImageUrl — the link to the n-th image of the entry on the line that starts at lineStart
 * @typedef {import('./transcript-cache.js').CachedEntry} CachedEntry
 * @typedef {ReturnType<typeof import('./transcript-cache.js').createTranscriptCache>} TranscriptCache
 */

/**
 * Runs until the signal is aborted. The file is looked up again on every round: after /cd it moves.
 * @param {{ locate: () => Promise<string | undefined>, running: () => Promise<boolean>, scope: 'main' | 'subagent', imageUrl: ImageUrl, rewoundAt: () => string | undefined, send: Send, signal: AbortSignal, pollMs: number, transcripts: TranscriptCache, tail: number | undefined, version: string, from: string | undefined, sessionStatus?: (() => Promise<import('../public/model/session-status.js').SessionStatus | undefined>) | undefined }} options
 *   running — whether Claude Code has the session open; rewoundAt — the prompt this page rewound the session to, if it
 *   did; tail — how many of the latest entries to send at first ("earlier" tells how many were left out); undefined —
 *   all of them; version: the viewer's build — a token of another is not gone on from; from — the token of the copy the
 *   page holds: what came since is sent alone, or — the token not to be gone on from — "reset" and the feed from its
 *   start
 */
export async function streamTranscript({ locate, running, scope, imageUrl, rewoundAt, send, signal, pollMs, transcripts, tail, version, from, sessionStatus = async () => undefined }) {
  /** How many of the file's entries this page has been given. */
  let sent = 0;
  /** Those entries chained (feed-check.js). */
  let chain = chainStart;
  /** The page's copy to go on from, until the file is read: then gone on from, or dropped. */
  let goOnFrom = from;
  /** The token the page was told last. @type {string | undefined} */
  let told;
  /** @type {number | undefined} */
  let generation;
  // said once each: the transcript is missing, and that the feed is ready — once the transcript is there, or while the
  // session runs without one: a session started just now has none before its first message, and waits for it
  let missingSaid = false;
  let readySaid = false;
  let statusTold = '';
  /** Entries that already have a prompt sent from them: another prompt from there means the conversation was rewound. */
  /** @type {Set<string>} */
  let promptParents = new Set();
  let point = rewoundAt();
  /** The file followed, kept read while the page follows it: reading other sessions does not push it out. */
  /** @type {{ path: string, letGo: () => void } | undefined} */
  let kept;
  const restart = () => {
    sent = 0;
    chain = chainStart;
    promptParents = new Set();
    send('reset', null);
  };
  try {
    while (!signal.aborted) {
      const status = scope === 'main' ? await sessionStatus().catch(() => undefined) : undefined;
      if (status !== undefined && JSON.stringify(status) !== statusTold) {
        statusTold = JSON.stringify(status);
        send('session-status', status);
      }
      const path = await locate();
      if (path !== kept?.path) {
        kept?.letGo();
        kept = path === undefined ? undefined : { path, letGo: transcripts.keep(path, scope) };
      }
      const read = path === undefined ? undefined : await transcripts.read(path, { scope, imageUrl }).catch(() => undefined);
      if (read === undefined) {
        if (await running()) {
          if (!readySaid) send('ready', null);
          readySaid = true;
        } else {
          if (!missingSaid) send('missing', null);
          missingSaid = true;
        }
      } else {
        if (goOnFrom !== undefined) {
          // the page's copy: gone on from where its token says, if the file still holds what was read for it then
          const place = placeOf(goOnFrom);
          goOnFrom = undefined;
          if (place !== undefined && place.version === version && place.sent <= read.entries.length && chainOver(read.entries, 0, place.sent, chainStart) === place.chain) {
            sent = place.sent;
            chain = place.chain;
            point = place.point;
            promptParents = parentsOfPrompts(read.entries.slice(0, sent));
            generation = read.generation;
          } else send('reset', null);
        }
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
          chain = chainOver(read.entries, sent, read.entries.length, chain);
          sent = read.entries.length;
        }
        const token = tokenOf({ version, sent, chain, point });
        if (token !== told) {
          send('cursor', { token, ...heldBy(read.entries.slice(0, sent), point) });
          told = token;
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
 * @param {Place} place
 * @returns {string}
 */
function tokenOf({ version, sent, chain, point }) {
  return [version, String(sent), chain, point ?? ''].map(encodeURIComponent).join('~');
}

/**
 * A token read back; none for one that is not.
 * @param {string} token
 * @returns {Place | undefined}
 */
function placeOf(token) {
  const parts = token.split('~');
  if (parts.length !== 4) return undefined;
  /** @type {string[]} */
  const read = [];
  for (const part of parts) {
    try {
      read.push(decodeURIComponent(part));
    } catch {
      return undefined; // a % that escapes nothing: no token of the viewer's
    }
  }
  const [version = '', count = '', chain = '', point = ''] = read;
  const sent = Number(count);
  return /^\d+$/.test(count) && Number.isSafeInteger(sent) && chain !== '' ? { version, sent, chain, point: point === '' ? undefined : point } : undefined;
}

/**
 * The chain on with these entries of the transcript.
 * @param {readonly CachedEntry[]} entries
 * @param {number} start
 * @param {number} end
 * @param {string} chain — over the entries before start
 * @returns {string}
 */
function chainOver(entries, start, end, chain) {
  let on = chain;
  for (let at = start; at < end; at++) {
    const entry = entries[at];
    if (entry !== undefined) on = chainOn(on, entry.at, entry.link.uuid);
  }
  return on;
}

/**
 * The entries prompts were sent from, as the stream gathers them while it sends these entries: another prompt from
 * one of them is a rewind.
 * @param {readonly CachedEntry[]} entries
 * @returns {Set<string>}
 */
function parentsOfPrompts(entries) {
  return new Set(entries.flatMap(({ link }) => (link.turn && link.parent !== undefined ? [link.parent] : [])));
}

/**
 * What a page given these entries holds, for it to check its copy by: how many it shows, and the hash of the latest.
 * @param {readonly CachedEntry[]} entries — those read for it
 * @param {string | undefined} point — the rewind it was read under
 * @returns {{ shown: number, check: string }}
 */
function heldBy(entries, point) {
  const shown = shownEntries(entries, rewoundEntries(entries.map(({ link }) => link), point));
  return { shown: shown.length, check: tailCheck(shown.slice(Math.max(0, shown.length - checkedEntries))) };
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
