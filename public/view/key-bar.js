// @ts-check
// Keys a phone's keyboard lacks, under a terminal on the page: Esc, Tab, the arrows, Enter and Ctrl+C — what a terminal
// program's menus and questions are answered with, Claude Code asking whether to trust a folder among them. Each goes
// as the terminal sends its own key.
import { h } from './dom.js';

/** @type {readonly { label: string, name: string, data: string }[]} */
const keys = [
  { label: 'Esc', name: 'Esc', data: '\u001b' },
  { label: 'Tab', name: 'Tab', data: '\t' },
  { label: '↑', name: 'Up', data: '\u001b[A' },
  { label: '↓', name: 'Down', data: '\u001b[B' },
  { label: '←', name: 'Left', data: '\u001b[D' },
  { label: '→', name: 'Right', data: '\u001b[C' },
  { label: '⏎', name: 'Enter', data: '\r' },
  { label: '^C', name: 'Ctrl+C', data: '\u0003' },
];

/**
 * @param {(data: string) => void} send — a key, to the terminal's pane
 * @returns {HTMLElement}
 */
export function createKeyBar(send) {
  return h(
    'div',
    { className: 'terminal-keys', attrs: { role: 'group', 'aria-label': 'Keys' } },
    keys.map(({ label, name, data }) => {
      const key = h('button', { className: 'terminal-key', text: label, attrs: { type: 'button', 'aria-label': name } });
      // the key leaves the focus where it is: the phone's keyboard, open over the terminal, stays open
      key.addEventListener('pointerdown', (event) => event.preventDefault());
      key.addEventListener('click', () => send(data));
      return key;
    }),
  );
}
