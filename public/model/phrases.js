// @ts-check
// The commands and phrases sent from the page's box most often — "/clear", "давай", "проверь" — counted by the viewer
// for every device (server/phrases.js), the most sent at hand over the box to be put into it again (phrase-bar.js).
import { isRecord } from './narrow.js';

/**
 * @typedef {{ text: string, count: number, at: number }} Phrase — a phrase as it was typed last, how many times it was
 *   sent, and when last, ms
 */

/** A phrase is short: a command, a word or a few. */
const longest = 120;
/** How many phrases are counted: the most sent kept, the others let go. */
const counted = 200;

/**
 * The phrase a prompt counts as: one line, short, its spaces as one; none for a long prompt, one of several lines, or
 * nothing at all.
 * @param {string} prompt — as sent
 * @returns {string | undefined}
 */
export function phraseOf(prompt) {
  const text = prompt.trim().replace(/[ \t]+/g, ' ');
  return text === '' || text.length > longest || text.includes('\n') ? undefined : text;
}

/**
 * The phrases counted with this one sent now: one more time, as typed now — a phrase's case aside; so many kept, the
 * least sent let go.
 * @param {readonly Phrase[]} phrases
 * @param {string} text — a phrase (phraseOf)
 * @param {number} at — now, ms
 * @returns {Phrase[]}
 */
export function withPhraseSent(phrases, text, at) {
  const key = text.toLowerCase();
  const known = phrases.find((phrase) => phrase.text.toLowerCase() === key);
  const sent = { text, count: known === undefined ? 1 : known.count + 1, at };
  return [sent, ...phrases.filter((phrase) => phrase !== known)].sort(byUse).slice(0, counted);
}

/**
 * The phrases sent most, the most first — of as many, the one sent last first.
 * @param {readonly Phrase[]} phrases
 * @param {number} count — how many
 * @returns {Phrase[]}
 */
export function topPhrases(phrases, count) {
  return [...phrases].sort(byUse).slice(0, count);
}

/**
 * The phrase sent more first; of as many, the one sent last.
 * @param {Phrase} a
 * @param {Phrase} b
 */
function byUse(a, b) {
  return b.count - a.count || b.at - a.at;
}

/**
 * The phrases sent most as the viewer tells them (/api/phrases), the most first: a text and how many times it was sent;
 * anything else left out.
 * @param {unknown} json
 * @returns {{ text: string, count: number }[]}
 */
export function parsePhrases(json) {
  if (!Array.isArray(json)) return [];
  return json.flatMap((one) => (isRecord(one) && typeof one.text === 'string' && typeof one.count === 'number' ? [{ text: one.text, count: one.count }] : []));
}
