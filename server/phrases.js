// @ts-check
// The commands and phrases sent from the page's box, counted (public/model/phrases.js), kept by the viewer so every
// device has the same ones at hand: sent from the phone, at hand on the computer too. In a file of their own, over a
// restart.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isRecord } from '../public/model/narrow.js';
import { phraseOf, topPhrases, withPhraseSent } from '../public/model/phrases.js';

/**
 * @typedef {import('../public/model/phrases.js').Phrase} Phrase
 */

/**
 * @param {string} file — ~/.claude-code-webview/phrases.json
 * @returns {{ top: (count: number) => Promise<Phrase[]>, sent: (prompt: string, at: number) => Promise<void> }} — top:
 *   the phrases sent most, the most first; sent: a prompt the terminal took, counted if it is a phrase
 */
export function createPhrasesFile(file) {
  /** Counts run one after another, each on what the one before wrote. */
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();
  return {
    top: (count) => queue.then(async () => topPhrases(await readPhrases(file), count)),
    sent(prompt, at) {
      const phrase = phraseOf(prompt);
      if (phrase === undefined) return Promise.resolve();
      const changed = queue.then(async () => {
        const phrases = withPhraseSent(await readPhrases(file), phrase, at);
        await mkdir(dirname(file), { recursive: true });
        const temporary = `${file}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(phrases));
        await rename(temporary, file);
      });
      queue = changed.catch(() => undefined);
      return changed;
    },
  };
}

/**
 * No file, or one not of phrases: none counted yet.
 * @param {string} file
 * @returns {Promise<Phrase[]>}
 */
async function readPhrases(file) {
  const text = await readFile(file, 'utf8').catch(() => undefined);
  if (text === undefined) return [];
  try {
    const json = JSON.parse(text);
    return Array.isArray(json) ? json.flatMap(phraseRecord) : [];
  } catch {
    return [];
  }
}

/**
 * @param {unknown} json — a phrase as kept
 * @returns {Phrase[]} — none for anything else
 */
function phraseRecord(json) {
  if (!isRecord(json) || typeof json.text !== 'string' || typeof json.count !== 'number' || typeof json.at !== 'number') return [];
  return [{ text: json.text, count: json.count, at: json.at }];
}
