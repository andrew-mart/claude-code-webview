// @ts-check
// The colour of a herdr workspace: its rows in the sidebar, and the rows of the sessions that run or ran in it, are
// marked with it on their left edge. Only the hue is the workspace's own; how light and strong, the theme decides
// (style.css).
import { splitTabIcon } from './tab-icon.js';

/**
 * The name's FNV-1a hash, its bits mixed through (MurmurHash3's finish), spread over the colour wheel: names that
 * differ a little get hues far apart. An icon put ahead of the name by hand is not the name's: it changes nothing.
 * @param {string} label — the workspace's name, as herdr has it
 * @returns {number} — degrees, 0 to 359
 */
export function workspaceHue(label) {
  let hash = 0x811c9dc5;
  for (const char of splitTabIcon(label).name) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) >>> 0) % 360;
}
