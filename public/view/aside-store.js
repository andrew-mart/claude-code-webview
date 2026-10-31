// @ts-check
// Side questions (/btw) and their answers, kept per session for as long as the page is open: the terminal no longer
// shows an answer once the viewer has read it, so it must not go with the box when another session is opened. An
// answer outlives a reload of the tab, and so does a question still being answered: the page reloaded asks for its
// answer again (composer-view.js). The questions answered are kept besides, in the browser, to be read again.

/**
 * @typedef {{ question: string, answer: string | undefined }} Aside — answer: none while Claude answers
 * @typedef {ReturnType<typeof createAsideStore>} AsideStore
 */

const storageKey = (/** @type {string} */ sessionId) => `viewer.btw.${sessionId}`;
const answeredKey = (/** @type {string} */ sessionId) => `viewer.btw-answered.${sessionId}`;
/** The side questions answered kept for a session: the latest. */
const answeredKept = 20;

export function createAsideStore() {
  /** @type {Map<string, Aside>} */
  const asides = new Map();
  /** @type {Map<string, Set<(aside: Aside | undefined) => void>>} */
  const listeners = new Map();
  /**
   * The session's side question as it stands: this page's, or one a page before it left in the tab.
   * @param {string} sessionId
   * @returns {Aside | undefined}
   */
  const current = (sessionId) => asides.get(sessionId) ?? keptAside(sessionId);

  return {
    /**
     * @param {string} sessionId
     * @returns {Aside | undefined}
     */
    get: current,
    /**
     * A question still being answered that a page before this one asked — reloaded, its request gone with it: none
     * once this page has it.
     * @param {string} sessionId
     * @returns {string | undefined} — the question
     */
    leftAsking(sessionId) {
      if (asides.has(sessionId)) return undefined;
      const kept = keptAside(sessionId);
      return kept !== undefined && kept.answer === undefined ? kept.question : undefined;
    },
    /**
     * The session's side questions answered, the earliest first: kept past the browser closed, to be read again.
     * @param {string} sessionId
     * @returns {readonly Aside[]}
     */
    answered: (sessionId) => keptAnswered(sessionId),
    /**
     * A question asked, answered, or closed (none); whoever shows the session's box hears of it.
     * @param {string} sessionId
     * @param {Aside | undefined} aside
     */
    set(sessionId, aside) {
      // an answer closed is kept to read again: one a page before this one showed may not be yet
      const closed = aside === undefined ? current(sessionId) : undefined;
      if (closed?.answer !== undefined) keepAnswered(sessionId, closed);
      if (aside === undefined) asides.delete(sessionId);
      else asides.set(sessionId, aside);
      keep(sessionId, aside);
      if (aside?.answer !== undefined) keepAnswered(sessionId, aside);
      for (const listener of listeners.get(sessionId) ?? []) listener(aside);
    },
    /**
     * @param {string} sessionId
     * @param {(aside: Aside | undefined) => void} listener
     * @returns {() => void} — stops listening
     */
    watch(sessionId, listener) {
      const known = listeners.get(sessionId) ?? new Set();
      known.add(listener);
      listeners.set(sessionId, known);
      return () => known.delete(listener);
    },
  };
}

/**
 * @param {string} sessionId
 * @returns {Aside | undefined}
 */
function keptAside(sessionId) {
  try {
    const kept = JSON.parse(sessionStorage.getItem(storageKey(sessionId)) ?? 'null');
    if (typeof kept?.question !== 'string') return undefined;
    return typeof kept.answer === 'string' ? { question: kept.question, answer: kept.answer } : { question: kept.question, answer: undefined };
  } catch {
    return undefined; // storage is unavailable or holds something else: nothing kept
  }
}

/**
 * @param {string} sessionId
 * @param {Aside | undefined} aside — none to forget it
 */
function keep(sessionId, aside) {
  try {
    if (aside === undefined) sessionStorage.removeItem(storageKey(sessionId));
    else sessionStorage.setItem(storageKey(sessionId), JSON.stringify(aside));
  } catch {
    // storage is unavailable: the answer lasts until the page reloads
  }
}

/**
 * @param {string} sessionId
 * @returns {Aside[]}
 */
function keptAnswered(sessionId) {
  try {
    /** @type {unknown} */
    const kept = JSON.parse(localStorage.getItem(answeredKey(sessionId)) ?? '[]');
    return Array.isArray(kept) ? kept.flatMap((one) => (typeof one?.question === 'string' && typeof one.answer === 'string' ? [{ question: one.question, answer: one.answer }] : [])) : [];
  } catch {
    return []; // storage is unavailable or holds something else: nothing kept
  }
}

/**
 * A side question answered kept with those before it — the latest shown again not twice — the earliest going past
 * the latest twenty.
 * @param {string} sessionId
 * @param {Aside} aside
 */
function keepAnswered(sessionId, aside) {
  const kept = keptAnswered(sessionId);
  const last = kept.at(-1);
  if (last !== undefined && last.question === aside.question && last.answer === aside.answer) return;
  try {
    localStorage.setItem(answeredKey(sessionId), JSON.stringify([...kept, aside].slice(-answeredKept)));
  } catch {
    // storage is unavailable: the answers before this one are not there to read again
  }
}
