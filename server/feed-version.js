// @ts-check
// The version of what a session's feed is — the entries the viewer reads a transcript into — named by the token of
// a page's copy of a feed (stream.js): the files that read them, and what they import, hashed by what they hold. An
// update of the viewer that leaves those as they were leaves the pages' copies good — entries, which a page draws anew
// whatever its own build — where the page's build, the version before, dropped them all at every update: every session
// opened next was read anew, "Updating…" over it all the while.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { moduleGraph } from './module-graph.js';

/**
 * @param {readonly string[]} starts — the files that read a transcript into entries; what they import, over and over,
 *   counts too
 * @returns {Promise<string>}
 */
export async function feedVersion(starts) {
  // the viewer's own files, imported by a relative path; a package's are not followed
  const held = await moduleGraph(starts, { read: (file) => readFile(file, 'utf8'), follow: (specifier, file) => (specifier.startsWith('.') ? resolve(dirname(file), specifier) : undefined) });
  // in an order of their own, not of where they lie: a viewer in a container has them elsewhere
  const hash = createHash('sha256');
  for (const text of [...held.values()].sort()) hash.update(text).update('\0');
  return hash.digest('hex').slice(0, 12);
}
