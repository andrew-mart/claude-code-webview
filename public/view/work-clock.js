// @ts-check
// How long each thing on the page — an agent, a session — has been at work, by its key: counted from when the page first
// saw it at work. Its robots' story (robot.js) goes on from there when its row is drawn again, rather than from the start.

/**
 * @param {() => number} now — milliseconds
 * @returns {{ elapsed: (key: string, working: boolean) => number }} — elapsed: how long the thing has been at work,
 *   noting it; not at work, it is let go and counts from its next start
 */
export function createWorkClock(now) {
  /** @type {Map<string, number>} */
  const since = new Map();
  return {
    elapsed(key, working) {
      if (!working) {
        since.delete(key);
        return 0;
      }
      const started = since.get(key) ?? now();
      since.set(key, started);
      return now() - started;
    },
  };
}
