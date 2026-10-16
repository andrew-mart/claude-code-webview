// @ts-check
// A session's feed as the page holds it, kept up to date by the viewer's stream: the entries it was sent, how many came
// before them, and the viewer's token for where its reading of the transcript stood when it sent them — a copy that
// goes on later from there asks for what came since alone. Each token comes with the count of entries the page should
// hold and a hash of the latest of them (feed-check.js): a copy that does not match is out of step, dropped, and the
// session read anew from its start. Entries sent after the last token are not part of what is kept: a copy that went on
// from that token would be sent them again.
import { checkedEntries, tailCheck } from './feed-check.js';
import { isRecord } from './narrow.js';

/**
 * @typedef {{ entries: readonly unknown[], earlier: number, token: string | undefined }} KeptFeed — earlier: how many
 *   entries came before these; token: where the viewer's reading stood when it sent the last of them — none: the copy
 *   cannot go on, it is read anew
 * @typedef {'ok' | 'out-of-step'} Step
 */

/**
 * @param {KeptFeed | undefined} from — the copy it goes on from; none — or one with no token to go on from — from nothing
 */
export function createFeedCopy(from) {
  const goesOn = from?.token === undefined ? undefined : from;
  /** @type {unknown[]} */
  let entries = goesOn === undefined ? [] : [...goesOn.entries];
  let earlier = goesOn === undefined ? 0 : goesOn.earlier;
  let token = goesOn?.token;
  /** How many of the entries the token covers. */
  let settled = entries.length;

  return {
    /** The entries held now, the last ones sent after the token too. */
    entries: () => entries,
    earlier: () => earlier,
    /** The viewer's last token: none before it sent one. */
    token: () => token,
    /** The token to go on from: none while entries past it are held — they would be sent again — nor before one came. */
    goOnFrom: () => (entries.length === settled ? token : undefined),
    /**
     * An event of the viewer's stream taken in.
     * @param {string} event — reset, earlier, entries, cursor; any other leaves the copy as it is
     * @param {unknown} data
     * @returns {Step}
     */
    take(event, data) {
      switch (event) {
        case 'reset':
          entries = [];
          earlier = 0;
          token = undefined;
          settled = 0;
          return 'ok';
        case 'earlier': {
          const count = isRecord(data) ? data.count : undefined;
          if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return 'out-of-step';
          earlier = count;
          return 'ok';
        }
        case 'entries':
          if (!Array.isArray(data)) return 'out-of-step';
          entries.push(...data);
          return 'ok';
        case 'cursor':
          return takeCursor(data);
        default:
          return 'ok';
      }
    },
    /**
     * What is kept of it: the entries the token covers, the latest so many of them.
     * @param {number} max
     * @returns {KeptFeed}
     */
    kept(max) {
      const covered = entries.slice(0, settled);
      const dropped = Math.max(covered.length - max, 0);
      return { entries: covered.slice(dropped), earlier: earlier + dropped, token };
    },
  };

  /**
   * The viewer's token, once the copy matches what the viewer says it should hold.
   * @param {unknown} data — { token, shown, check }
   * @returns {Step}
   */
  function takeCursor(data) {
    const told = isRecord(data) ? data : {};
    const { shown, check } = told;
    if (typeof told.token !== 'string' || typeof shown !== 'number' || !Number.isSafeInteger(shown) || typeof check !== 'string') return 'out-of-step';
    if (earlier + entries.length !== shown) return 'out-of-step';
    const checked = Math.min(checkedEntries, shown);
    // a copy holding fewer than the check covers is checked by its count alone
    if (entries.length >= checked && tailCheck(entries.slice(entries.length - checked)) !== check) return 'out-of-step';
    token = told.token;
    settled = entries.length;
    return 'ok';
  }
}
