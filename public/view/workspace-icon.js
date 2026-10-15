// @ts-check
// A workspace's icon as its rows show it left of their names (model/icon-choice.js): an emoji, or one of Lucide's — in
// its colour, or the workspace's own.
import { parseIcon } from '../model/icon-choice.js';
import { h } from './dom.js';
import { lucideIcon } from './lucide.js';

/**
 * @param {string | undefined} value — as kept; none: no icon
 * @returns {HTMLElement[]}
 */
export function workspaceIconOf(value) {
  const icon = value === undefined ? undefined : parseIcon(value);
  if (icon === undefined) return [];
  const drawn = icon.kind === 'emoji' ? [icon.emoji] : [lucideIcon(icon.name, icon.color)];
  return [h('span', { className: 'workspace-icon', attrs: { 'aria-hidden': 'true' } }, drawn)];
}
