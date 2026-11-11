// @ts-check
// The prompts a page sent under an id of its own: one sent again under it — its reply lost on the way while the page was
// out of reach, or two tabs sending what one kept waiting — is typed once, the reply it had given back, and one being
// sent is waited for. A prompt refused is let go: nothing was typed, so it may go again. The latest are kept.

/**
 * @typedef {import('../public/model/composer.js').SendOutcome} SendOutcome
 * @typedef {{ once: (session: string, id: string, send: () => Promise<SendOutcome>) => Promise<SendOutcome> }} SentPrompts
 */

/**
 * @param {number} limit — how many are kept, the oldest let go past it
 * @returns {SentPrompts}
 */
export function createSentPrompts(limit) {
  /** @type {Map<string, Promise<SendOutcome>>} */
  const kept = new Map();
  /** @param {string} key */
  const letGo = (key) => void kept.delete(key);
  return {
    once(session, id, send) {
      const key = `${session}\n${id}`;
      const known = kept.get(key);
      if (known !== undefined) return known;
      const sending = send().then(
        (outcome) => {
          if (!outcome.ok) letGo(key);
          return outcome;
        },
        (error) => {
          letGo(key);
          throw error;
        },
      );
      kept.set(key, sending);
      for (const old of kept.keys()) {
        if (kept.size <= limit) break;
        letGo(old);
      }
      return sending;
    },
  };
}
