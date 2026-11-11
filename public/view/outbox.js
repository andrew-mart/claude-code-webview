// @ts-check
// The prompts sent from the box while the viewer is out of reach — or whose reply did not come back — waiting to go:
// kept by the browser, so that a page opened anew still has them, and sent in the order sent once the viewer answers,
// each gone only once the viewer says it went. One refused stops those behind it and says why, to be sent again or
// taken back to the box. The page's tabs send what the browser keeps one after another, under one of its locks, so each
// goes once — and the viewer types a prompt sent again under its id once as well (server/sent-prompts.js). Where the
// browser keeps nothing — a private window — the page holds them.
import { outcomeMessage } from '../model/composer.js';
import { isRecord, text } from '../model/narrow.js';

/**
 * @typedef {import('../model/composer.js').SendOutcome} SendOutcome
 * @typedef {{ id: string, text: string, at: string, refused?: string }} Waiting — a prompt waiting to go: its id — the
 *   viewer types one sent again under it once; refused: why the viewer did not take it
 * @typedef {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>} KeptStorage
 * @typedef {{ request: <T>(name: string, work: () => Promise<T>) => Promise<T> }} Locks — the browser's: one holder of a
 *   name at a time, across its tabs
 * @typedef {{ waiting: () => readonly Waiting[], add: (id: string, text: string) => void, flush: () => Promise<void>, sendAgain: (id: string) => Promise<void>, takeBack: (id: string) => string | undefined }} Outbox
 */

/**
 * @param {string} sessionId
 * @param {{ storage: KeptStorage, locks: Locks, send: (waiting: Waiting) => Promise<SendOutcome | undefined>, onChange: (waiting: readonly Waiting[]) => void }} parts
 *   — send: a prompt to the viewer — none when it did not answer; onChange: the prompts waiting as they are now
 * @returns {Outbox} — add: a prompt waiting, kept before anything else is done with it; flush: those waiting sent, in
 *   order, until one is refused or the viewer does not answer; sendAgain: a refused one sent again, those behind it
 *   after it; takeBack: one taken out — its words, for the box
 */
export function createOutbox(sessionId, { storage, locks, send, onChange }) {
  const key = `${keyStart}${sessionId}`;
  /** Whether the browser keeps them: once it refuses, the page holds them. */
  let browserKeeps = true;
  /** @type {readonly Waiting[]} */
  let inPage = [];
  /** @returns {readonly Waiting[]} */
  const read = () => {
    if (!browserKeeps) return inPage;
    try {
      return parseWaiting(JSON.parse(storage.getItem(key) ?? '[]'));
    } catch {
      browserKeeps = false;
      return inPage;
    }
  };
  /** @param {readonly Waiting[]} next */
  const write = (next) => {
    inPage = next;
    if (browserKeeps) {
      try {
        if (next.length === 0) storage.removeItem(key);
        else storage.setItem(key, JSON.stringify(next));
      } catch {
        // the browser keeps nothing now: the page holds them from here on
        browserKeeps = false;
      }
    }
    onChange(next);
  };
  let flushing = false;
  const flush = async () => {
    if (flushing) return;
    flushing = true;
    try {
      await locks.request(key, async () => {
        /** The ones sent this time: one still there after it went is not sent round again. */
        const sentNow = new Set();
        // read anew before each: another tab may have sent some meanwhile
        for (let [next] = read(); next !== undefined && next.refused === undefined && !sentNow.has(next.id); [next] = read()) {
          const sending = next;
          sentNow.add(sending.id);
          const outcome = await send(sending);
          // the viewer out of reach still: they wait on
          if (outcome === undefined) return;
          if (!outcome.ok) {
            write(read().map((one) => (one.id === sending.id ? { ...one, refused: refusalOf(outcome) } : one)));
            return;
          }
          write(read().filter((one) => one.id !== sending.id));
        }
      });
    } finally {
      flushing = false;
    }
  };
  return {
    waiting: read,
    add(id, words) {
      write([...read(), { id, text: words, at: new Date().toISOString() }]);
    },
    flush,
    sendAgain(id) {
      write(read().map((one) => (one.id === id ? withoutRefusal(one) : one)));
      return flush();
    },
    takeBack(id) {
      const kept = read();
      const taken = kept.find((one) => one.id === id);
      if (taken === undefined) return undefined;
      write(kept.filter((one) => one.id !== id));
      return taken.text;
    },
  };
}

/**
 * Why the viewer did not take a prompt, as the outbox tells it: the prompt is not in the box, so not that it stays there.
 * @param {SendOutcome} outcome
 * @returns {string}
 */
function refusalOf(outcome) {
  return outcomeMessage(outcome).replace(/ The text stays in the box\.$/, '');
}

/** @param {Waiting} waiting @returns {Waiting} */
function withoutRefusal({ refused: _was, ...waiting }) {
  return waiting;
}

/**
 * The prompts waiting as the browser keeps them; one of another shape left out.
 * @param {unknown} stored
 * @returns {readonly Waiting[]}
 */
function parseWaiting(stored) {
  if (!Array.isArray(stored)) return [];
  return stored.filter(isRecord).flatMap((item) => {
    const id = text(item.id);
    const words = text(item.text);
    const at = text(item.at);
    const refused = text(item.refused);
    if (id === undefined || words === undefined || at === undefined) return [];
    return [refused === undefined ? { id, text: words, at } : { id, text: words, at, refused }];
  });
}

/** Where the browser keeps a session's prompts waiting: under this and the session's id. */
const keyStart = 'viewer.outbox.';

/**
 * The sessions with prompts waiting, as the browser keeps them: for the page to send those of sessions not open too.
 * @param {Pick<Storage, 'length' | 'key'>} storage
 * @returns {string[]}
 */
export function waitingSessions(storage) {
  /** @type {string[]} */
  const sessions = [];
  try {
    for (let at = 0; at < storage.length; at++) {
      const key = storage.key(at);
      if (key !== null && key.startsWith(keyStart)) sessions.push(key.slice(keyStart.length));
    }
  } catch {
    // the browser keeps nothing: what waits is held by the page of its session
  }
  return sessions;
}

/** The browser's storage, reached only when asked: where it is refused the outbox holds its prompts in the page. */
/** @type {KeptStorage & Pick<Storage, 'length' | 'key'>} */
export const browserStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
  get length() {
    return localStorage.length;
  },
  key: (at) => localStorage.key(at),
};

/**
 * The browser's locks, one holder of a name across its tabs; a browser without them — a page not served securely — has
 * each tab send on its own, the viewer typing a prompt sent twice under its id once.
 * @returns {Locks}
 */
export function browserLocks() {
  return 'locks' in navigator ? { request: async (name, work) => await navigator.locks.request(name, work) } : { request: (_name, work) => work() };
}
