// @ts-check
// What the page's diagnostics tell of the time between them (view/diagnostics.js): how busy the page was, a key's
// wait, the requests it made — summed up to be sent to the viewer.

/** A tick of the page's clock later than this, the page stood still; later than the next, a key typed visibly waits. */
const stoodStillPastMs = 50;
const waitedPastMs = 100;

/**
 * How busy the page was, by how late each tick of a clock it keeps came: how many ticks, how many late, the time the
 * page stood still in the late ones, the worst.
 * @param {readonly number[]} lateness — of each tick, past when it was due, in ms
 * @returns {{ ticks: number, over50: number, over100: number, stoodStillMs: number, worstMs: number }}
 */
export function summarizeLateness(lateness) {
  const late = lateness.filter((one) => one > stoodStillPastMs);
  return {
    ticks: lateness.length,
    over50: late.length,
    over100: lateness.filter((one) => one > waitedPastMs).length,
    stoodStillMs: Math.round(late.reduce((sum, one) => sum + one, 0)),
    worstMs: Math.round(Math.max(0, ...lateness)),
  };
}

/**
 * Waits — a key's — told by how many, the middle one and the worst; none without waits.
 * @param {readonly number[]} delays — in ms
 * @returns {{ count: number, medianMs?: number, worstMs?: number }}
 */
export function summarizeDelays(delays) {
  const sorted = [...delays].sort((one, other) => one - other);
  const middle = sorted[Math.floor(sorted.length / 2)];
  const worst = sorted[sorted.length - 1];
  if (middle === undefined || worst === undefined) return { count: 0 };
  return { count: delays.length, medianMs: Math.round(middle), worstMs: Math.round(worst) };
}

/**
 * The requests made, by path — a poll's query left out — the most made first, with the time they took together.
 * @param {readonly { name: string, duration: number }[]} entries — resource timing's
 * @param {number} most — how many paths at most
 * @returns {{ path: string, count: number, totalMs: number }[]}
 */
export function summarizeRequests(entries, most) {
  /** @type {Map<string, { count: number, totalMs: number }>} */
  const byPath = new Map();
  for (const { name, duration } of entries) {
    const path = new URL(name, 'http://page.invalid/').pathname;
    const known = byPath.get(path);
    byPath.set(path, known === undefined ? { count: 1, totalMs: duration } : { count: known.count + 1, totalMs: known.totalMs + duration });
  }
  return [...byPath]
    .map(([path, { count, totalMs }]) => ({ path, count, totalMs: Math.round(totalMs) }))
    .sort((one, other) => other.count - one.count)
    .slice(0, most);
}

