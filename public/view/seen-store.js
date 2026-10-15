// @ts-check
// The answers seen — herdr's finished agents whose session or terminal was opened in the page (model/lamps.js) — kept by
// the browser, so the lamps put out stay out after a reload, and told to the viewer, so they stay out on every device.

const storageKey = 'viewer.seenPanes';

/**
 * @param {Storage | undefined} storage — none where the browser keeps nothing
 * @returns {{ get: () => import('../model/lamps.js').SeenPanes, set: (seen: import('../model/lamps.js').SeenPanes) => void }}
 */
export function createSeenStore(storage) {
  let seen = read(storage);
  return {
    get: () => seen,
    set(next) {
      const kept = JSON.stringify([...next]);
      if (kept === JSON.stringify([...seen])) return;
      seen = next;
      try {
        storage?.setItem(storageKey, kept);
      } catch {
        // the browser keeps nothing now: the lamps stay out until a reload
      }
    },
  };
}

/**
 * Tells the viewer the answers the page saw since: it keeps them for every device (server/seen.js). Out of its reach,
 * the lamp is out here and lights up elsewhere until seen there too.
 * @param {import('../model/lamps.js').SeenPanes} before
 * @param {import('../model/lamps.js').SeenPanes} after
 */
export function tellSeen(before, after) {
  for (const [pane, count] of after) {
    if (before.get(pane) === count) continue;
    void fetch('/api/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Viewer': '1' },
      body: JSON.stringify({ pane, count }),
    }).catch(() => undefined);
  }
}

/**
 * @param {Storage | undefined} storage
 * @returns {import('../model/lamps.js').SeenPanes}
 */
function read(storage) {
  try {
    /** @type {unknown} */
    const json = JSON.parse(storage?.getItem(storageKey) ?? '[]');
    return new Map(Array.isArray(json) ? json.flatMap((entry) => (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number' ? [/** @type {const} */ ([entry[0], entry[1]])] : [])) : []);
  } catch {
    return new Map();
  }
}
