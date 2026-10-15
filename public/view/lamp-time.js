// @ts-check
// A lamp at work wavers in its own time (style.css: lamp-waver): its pace and its moment from its key — the pane's, the
// tab's, the workspace's, the session's — the same each time it is drawn, apart from the other lamps'.

/**
 * @param {HTMLElement} lamp
 * @param {string} key
 */
export function waverInOwnTime(lamp, key) {
  // FNV-1a: keys a few letters apart get times far apart
  let hash = 0x811c9dc5;
  for (const char of key) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  const duration = 2.4 + (hash % 17) / 10;
  const delay = ((hash >>> 8) % 4000) / 1000;
  lamp.style.setProperty('--waver-duration', `${duration.toFixed(1)}s`);
  lamp.style.setProperty('--waver-delay', `-${delay.toFixed(2)}s`);
}
