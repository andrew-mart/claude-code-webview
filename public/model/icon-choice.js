// @ts-check
// A workspace's icon as the viewer keeps it — for its folder (server/workspace-icons.js) — one word: an emoji as it is,
// or one of Lucide's icons by its name, "lucide:wallet", in a colour of the palette after @, "lucide:wallet@green";
// without one, in its workspace's colour. And how Lucide's icons are found, as md-keeper finds them: by their names,
// then by the words each is tagged with.
import { splitTabIcon } from './tab-icon.js';

/**
 * @typedef {typeof iconColors[number]} IconColor
 * @typedef {{ kind: 'emoji', emoji: string } | { kind: 'lucide', name: string, color: IconColor | undefined }} Icon
 */

/** The colours a Lucide icon is drawn in (style.css: .lucide-icon). */
export const iconColors = /** @type {const} */ (['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']);

/** A Lucide icon's name — letters, digits, dashes — and its colour. */
const lucide = /^lucide:([a-z0-9]+(?:-[a-z0-9]+)*)(?:@([a-z]+))?$/;

/**
 * @param {string} value — as kept
 * @returns {Icon | undefined} — none for what is neither
 */
export function parseIcon(value) {
  // an emoji alone, as one leads a name
  const alone = splitTabIcon(value);
  if (alone.icon !== undefined && alone.name === '') return { kind: 'emoji', emoji: alone.icon };
  const found = lucide.exec(value);
  if (found === null || found[1] === undefined) return undefined;
  // a colour not of the palette: the workspace's own
  const color = iconColors.find((known) => known === found[2]);
  return { kind: 'lucide', name: found[1], color };
}

/**
 * @param {Icon} icon
 * @returns {string} — as kept
 */
export function iconValue(icon) {
  if (icon.kind === 'emoji') return icon.emoji;
  return icon.color === undefined ? `lucide:${icon.name}` : `lucide:${icon.name}@${icon.color}`;
}

/**
 * Lucide's icons a query finds, the nearest first: the name itself; a name holding it as a whole part — "star" in
 * "star-off"; a name holding it at all — in "align-start"; then the ones whose words hold it. No query: all of them,
 * in their order.
 * @param {Readonly<Record<string, readonly string[]>>} tags — each icon's words, by its name
 * @param {string} query
 * @returns {string[]}
 */
export function searchIcons(tags, query) {
  const names = Object.keys(tags);
  const wanted = query.trim().toLowerCase();
  if (wanted === '') return names;
  /** @param {string} name */
  const nearness = (name) => (name === wanted ? 0 : `-${name}-`.includes(`-${wanted}-`) ? 1 : 2);
  const byName = names.filter((name) => name.includes(wanted)).sort((a, b) => nearness(a) - nearness(b));
  const named = new Set(byName);
  const byWord = names.filter((name) => !named.has(name) && (tags[name] ?? []).some((word) => word.toLowerCase().includes(wanted)));
  return [...byName, ...byWord];
}
