// @ts-check
// Outline: which prompt is being read right now and where to jump to a neighbouring one.
// tops — the top of each prompt relative to the top of the scroll area, in feed order (ascending).

/** Tolerance for fractional pixels: a prompt top slightly above where a jump puts it is still "at the start". */
const landingTolerance = 8;

/**
 * The last prompt whose start is already above the reading line; -1 — the line is above the first prompt.
 * @param {readonly number[]} tops
 * @param {number} readingLine
 * @returns {number}
 */
export function currentIndex(tops, readingLine) {
  let low = 0;
  let high = tops.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((tops[middle] ?? Infinity) <= readingLine) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/**
 * Where Alt+↑ / Alt+↓ jumps to. Going back from the middle of an answer — first to the start of the current prompt;
 * if the prompt already stands where a jump puts it — to the previous one.
 * @param {readonly number[]} tops
 * @param {{ readingLine: number, landing: number }} view — landing: where a prompt's top ends up after a jump
 * @param {'previous' | 'next'} direction
 * @returns {number | undefined} — the prompt index, or undefined if there is nowhere to go
 */
export function stepTarget(tops, { readingLine, landing }, direction) {
  const current = currentIndex(tops, readingLine);
  if (direction === 'next') return current + 1 < tops.length ? current + 1 : undefined;
  if (current < 0) return undefined;
  if ((tops[current] ?? landing) < landing - landingTolerance) return current;
  return current > 0 ? current - 1 : undefined;
}
