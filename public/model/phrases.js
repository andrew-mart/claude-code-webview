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

/**
 * @typedef {{ known: () => readonly { text: string, count: number }[] | undefined, reread: () => Promise<void>, watch: (listener: () => void) => () => void }} PhraseCount
 *   — the page's count of the phrases sent most, the same for every tab's box: known — as the viewer told it last,
 *   none till it has; reread — the viewer asked again, the watchers told once it answers — of readings crossing, the
 *   last asked counts; watch — told so, till let go of
 */

/**
 * The phrases sent most, kept for the whole page: a tab's box opened draws them from here at once, and the viewer is
 * asked again when a prompt is sent — the count changed — every tab's row drawn from its answer.
 * @param {() => Promise<readonly { text: string, count: number }[]>} read — the viewer's count
 * @returns {PhraseCount}
 */
export function createPhraseCount(read) {
  /** @type {readonly { text: string, count: number }[] | undefined} */
  let known;
  let asked = 0;
  /** @type {Set<() => void>} */
  const listeners = new Set();
  return {
    known: () => known,
    async reread() {
      const mine = ++asked;
      const phrases = await read();
      // a later reading is under way: its answer counts
      if (mine !== asked) return;
      known = phrases;
      for (const listener of listeners) listener();
    },
    watch(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
