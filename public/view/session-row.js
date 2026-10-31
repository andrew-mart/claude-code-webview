// @ts-check
// A session's row as the session list draws it — herdr's sessions in the sidebar, the tab switcher, the side panel's
// History: its workspace's icon, its title, where it runs or ran under it, and what is at its right end.
import { h } from './dom.js';
import { workspaceIconOf } from './workspace-icon.js';

/**
 * @param {{ icon: string | undefined, title: string, where: string }} row — icon: its workspace's, none for one with none
 * @param {readonly Node[]} end — at the row's right end: a lamp, a time
 * @returns {Node[]}
 */
export function sessionRowParts({ icon, title, where }, end) {
  return [
    ...workspaceIconOf(icon),
    h('span', { className: 'herdr-tab-text' }, [h('span', { className: 'herdr-tab-title', text: title }), h('span', { className: 'herdr-tab-where', text: where })]),
    ...end,
  ];
}
