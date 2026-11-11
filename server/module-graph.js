// @ts-check
// The modules reached from some by their imports outright, over and over: the page's at its start, to be named for the
// browser to ask for at once (app.js: servePage), and the files that read a transcript into entries (feed-version.js).
// An import() is not one: it waits until asked.

/** An import or re-export outright, its module as written. */
const importOutright = /(?:^|[;\n])\s*(?:import|export)\s+(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]/g;

/**
 * @param {readonly string[]} starts — the modules' addresses to start from
 * @param {{ read: (address: string) => Promise<string>, follow: (specifier: string, importer: string) => string | undefined }} where
 *   — read: what the module at an address holds; follow: the address an import names, from the module importing it —
 *   none: one not followed, a package of the viewer's own, say
 * @returns {Promise<Map<string, string>>} — what each module reached holds, by its address, each read once
 */
export async function moduleGraph(starts, { read, follow }) {
  /** @type {Map<string, string>} */
  const held = new Map();
  /** @param {string} address */
  const visit = async (address) => {
    if (held.has(address)) return;
    const text = await read(address);
    held.set(address, text);
    for (const [, specifier] of text.matchAll(importOutright)) {
      const next = specifier === undefined ? undefined : follow(specifier, address);
      if (next !== undefined) await visit(next);
    }
  };
  for (const start of starts) await visit(start);
  return held;
}
