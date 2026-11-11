// @ts-check
// What every page asked about every few seconds — herdr's workspaces and tabs, the answers seen and kept, the sessions —
// the viewer looks at itself, once for all of them, and tells them over their streams what changed (app.js): a page asks
// then, where it asked every few seconds whether anything had — a request every half second at rest, over a slow link.
import { createHash } from 'node:crypto';

/**
 * @param {{ topics: Readonly<Record<string, () => Promise<unknown>>>, tell: (topics: readonly string[]) => void }} parts
 *   — topics: what each is now, by its name; tell: the names of those changed since the look before
 * @returns {{ look: () => Promise<void> }} — a look; the first only notes what each is. One that cannot be read now — herdr
 *   not running — is taken for unchanged
 */
export function createChanges({ topics, tell }) {
  /** What each was at the look before, by its name: a hash of it. */
  /** @type {Map<string, string>} */
  const tags = new Map();
  return {
    async look() {
      /** @type {string[]} */
      const changed = [];
      for (const [name, read] of Object.entries(topics)) {
        const now = await read().then(
          // wrapped: a topic that is nothing now is a tag too
          (value) => createHash('sha256').update(JSON.stringify({ value })).digest('base64url'),
          () => undefined,
        );
        if (now === undefined) continue;
        const before = tags.get(name);
        tags.set(name, now);
        if (before !== undefined && before !== now) changed.push(name);
      }
      if (changed.length > 0) tell(changed);
    },
  };
}
