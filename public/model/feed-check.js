// @ts-check
// What a feed the page holds is checked by, the same on both ends (server/stream.js, model/feed-copy.js): the
// transcript's entries chained one on another — where each is in its file and its uuid — to tell a copy's place in the
// transcript; and the count of entries the page should hold with the last few of them hashed, to tell that it holds
// them. What does not match is read anew from the session's start.

/** How many of a feed's latest entries its check covers. */
export const checkedEntries = 16;

/** The chain before the first entry. */
export const chainStart = '0';

/**
 * A 53-bit hash of the text, from a seed (cyrb53, public domain).
 * @param {string} text
 * @param {number} seed
 * @returns {number}
 */
function hash53(text, seed) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * The chain with one more entry of the transcript on it.
 * @param {string} chain — over the entries before it
 * @param {number} at — where its line starts in the transcript
 * @param {string | undefined} uuid
 * @returns {string}
 */
export function chainOn(chain, at, uuid) {
  return hash53(`${chain}|${at}|${uuid ?? ''}`, 0).toString(36);
}

/**
 * An entry the page is sent, as the check knows it: its uuid, kind and time.
 * @param {unknown} entry
 * @returns {string}
 */
function entryKey(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return '';
  const field = (/** @type {string} */ name) => {
    const value = Reflect.get(entry, name);
    return typeof value === 'string' ? value : '';
  };
  return `${field('uuid')}/${field('type')}/${field('timestamp')}`;
}

/**
 * The hash of these entries — a feed's latest, as many as checkedEntries or all there are.
 * @param {readonly unknown[]} entries
 * @returns {string}
 */
export function tailCheck(entries) {
  return hash53(entries.map(entryKey).join('\n'), 7).toString(36);
}
