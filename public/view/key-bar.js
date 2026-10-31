// @ts-check
// Keys a phone's keyboard lacks, under a terminal on the page: Esc, Tab, the arrows, Enter and Ctrl+C — what a terminal
// program's menus and questions are answered with, Claude Code asking whether to trust a folder among them. Each goes
// as the terminal sends its own key. The clipboard's key pastes what the clipboard holds, as a paste in the terminal
// goes: a long press on a phone may bring up no menu to paste from.
import { h } from './dom.js';
import { icon } from './icons.js';

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
 * @param {{ send: (data: string) => void, paste: (text: string) => void, readClipboard: () => Promise<string> }} actions —
 *   send: a key, to the terminal's pane; paste: words pasted into the terminal; readClipboard: what the clipboard holds,
 *   refused where the browser keeps it closed
 * @returns {HTMLElement}
 */
export function createKeyBar({ send, paste, readClipboard }) {
  const pasting = h('button', { className: 'terminal-key terminal-paste', title: 'Paste', attrs: { type: 'button', 'aria-label': 'Paste' } }, [icon('paste')]);
  pasting.addEventListener('click', () => {
    // a clipboard the browser keeps closed pastes nothing
    void readClipboard().then(paste, () => undefined);
  });
  const all = [
    ...keys.map(({ label, name, data }) => {
      const key = h('button', { className: 'terminal-key', text: label, attrs: { type: 'button', 'aria-label': name } });
      key.addEventListener('click', () => send(data));
      return key;
    }),
    pasting,
  ];
  // a key leaves the focus where it is: the phone's keyboard, open over the terminal, stays open
  for (const key of all) key.addEventListener('pointerdown', (event) => event.preventDefault());
  return h('div', { className: 'terminal-keys', attrs: { role: 'group', 'aria-label': 'Keys' } }, all);
}
