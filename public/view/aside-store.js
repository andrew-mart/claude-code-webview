// @ts-check
// Side questions (/btw) and their answers, kept per session for as long as the page is open: the terminal no longer
// shows an answer once the viewer has read it, so it must not go with the box when another session is opened. An
// answer — not a question still being answered, whose request goes with the page — also outlives a reload of the tab.

/**
 * @typedef {{ question: string, answer: string | undefined }} Aside — answer: none while Claude answers
 * @typedef {ReturnType<typeof createAsideStore>} AsideStore
 */

const storageKey = (/** @type {string} */ sessionId) => `viewer.btw.${sessionId}`;

export function createAsideStore() {
  /** @type {Map<string, Aside>} */
  const asides = new Map();
  /** @type {Map<string, Set<(aside: Aside | undefined) => void>>} */
  const listeners = new Map();

  return {
    /**
     * @param {string} sessionId
     * @returns {Aside | undefined}
     */
    get(sessionId) {
      return asides.get(sessionId) ?? keptAside(sessionId);
    },
    /**
     * A question asked, answered, or closed (none); whoever shows the session's box hears of it.
     * @param {string} sessionId
     * @param {Aside | undefined} aside
     */
    set(sessionId, aside) {
      if (aside === undefined) asides.delete(sessionId);
      else asides.set(sessionId, aside);
      keep(sessionId, aside?.answer === undefined ? undefined : aside);
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
    return typeof kept?.question === 'string' && typeof kept?.answer === 'string' ? { question: kept.question, answer: kept.answer } : undefined;
  } catch {
    return undefined; // storage is unavailable or holds something else: nothing kept
  }
}

/**
 * @param {string} sessionId
 * @param {Aside | undefined} aside — an answered one, or none to forget it
 */
function keep(sessionId, aside) {
  try {
    if (aside === undefined) sessionStorage.removeItem(storageKey(sessionId));
    else sessionStorage.setItem(storageKey(sessionId), JSON.stringify(aside));
  } catch {
    // storage is unavailable: the answer lasts until the page reloads
  }
}
