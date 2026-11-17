// @ts-check
// The icons put on tabs and workspaces last, the latest first — kept by the viewer for every device
// (server/recent-icons.js) — and the emoji an icon picker has at hand: those used last ahead of its usual ones.
import { parseIcon } from './icon-choice.js';

/** How many icons used last are kept: a row at hand, and more. */
const kept = 24;

/**
 * The icons used last with this one used now: first, out of the place it had among them; the earliest let go past so many.
 * @param {readonly string[]} recent — the latest first
 * @param {string} icon — as kept (icon-choice.js)
 * @returns {string[]}
 */
export function withIconUsed(recent, icon) {
  return [icon, ...recent.filter((one) => one !== icon)].slice(0, kept);
}

/**
 * The emoji a picker has at hand: those used last, the latest first, then its usual ones not among them — as many as
 * its usual ones. Lucide's icons stay in their own tab.
 * @param {readonly string[]} recent — the latest first
 * @param {readonly string[]} usual — the picker's own
 * @returns {string[]}
 */
export function iconsAtHand(recent, usual) {
  const emoji = recent.filter((one) => parseIcon(one)?.kind === 'emoji');
  return [...new Set([...emoji, ...usual])].slice(0, usual.length);
}
