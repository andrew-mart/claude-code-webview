// @ts-check
// The sessions opened lately, kept as they were shown while out of sight — their feeds going on there — so one opened
// again shows at once, up to date: as many as their weight allows, the one put away longest ago let go of first.

/**
 * @template T
 * @param {{ most: number, budget: number, weigh: (part: T) => number, letGo: (part: T) => void }} options — most: how
 *   many are kept at most; budget: how much they may weigh together — the one put away last is kept whatever it
 *   weighs; weigh: what one weighs now — its feed grows while out of sight; letGo: one no longer kept
 */
export function createWarmSessions({ most, budget, weigh, letGo }) {
  /** Insertion order is the order they were put away in: the first is the one put away longest ago. */
  /** @type {Map<string, T>} */
  const kept = new Map();
  return {
    /**
     * A session put out of sight, kept; past how many or how much may be kept, the ones put away longest ago let go of.
     * @param {string} sessionId
     * @param {T} part
     */
    keep(sessionId, part) {
      kept.delete(sessionId);
      kept.set(sessionId, part);
      const held = [...kept].map(([id, one]) => ({ id, part: one, weight: weigh(one) }));
      let weight = held.reduce((sum, one) => sum + one.weight, 0);
      for (const oldest of held) {
        if (kept.size === 1 || (kept.size <= most && weight <= budget)) break;
        weight -= oldest.weight;
        kept.delete(oldest.id);
        letGo(oldest.part);
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
