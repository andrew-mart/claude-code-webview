// @ts-check
// The sessions opened lately, kept as they were shown while out of sight — their feeds paused (session-view.js) — so
// one opened again shows at once, as it was: the latest so many, the one put away longest ago let go of first.

/**
 * @template T
 * @param {{ limit: number, letGo: (part: T) => void }} options — limit: how many are kept; letGo: one no longer kept
 */
export function createWarmSessions({ limit, letGo }) {
  /** Insertion order is the order they were put away in: the first is the one put away longest ago. */
  /** @type {Map<string, T>} */
  const kept = new Map();
  return {
    /**
     * A session put out of sight, kept; past the limit, the one put away longest ago let go of.
     * @param {string} sessionId
     * @param {T} part
     */
    keep(sessionId, part) {
      kept.delete(sessionId);
      kept.set(sessionId, part);
      for (const [oldest, oldPart] of kept) {
        if (kept.size <= limit) break;
        kept.delete(oldest);
        letGo(oldPart);
      }
    },
    /**
     * The session kept, taken out to show: no longer kept. None for one not kept.
     * @param {string} sessionId
     * @returns {T | undefined}
     */
    takeOut(sessionId) {
      const part = kept.get(sessionId);
      kept.delete(sessionId);
      return part;
    },
    /** @param {string} sessionId */
    has: (sessionId) => kept.has(sessionId),
    /**
     * A session no longer to be kept as it was shown: let go of.
     * @param {string} sessionId
     */
    drop(sessionId) {
      const part = kept.get(sessionId);
      if (part === undefined) return;
      kept.delete(sessionId);
      letGo(part);
    },
  };
}
