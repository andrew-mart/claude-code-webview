// @ts-check
// The button over a session that takes herdr to the tab the session runs in — the tab's workspace with it: there while
// the session runs in a herdr tab, none otherwise.
import { placeOf } from '../model/herdr.js';

/**
 * @param {HTMLButtonElement} button
 * @param {string} sessionId
 * @param {(tabId: string) => void} focus — herdr taken to the tab
 * @returns {(layout: import('../model/herdr.js').HerdrLayout) => void} — the button shown anew for what herdr has now
 */
export function herdrTabButton(button, sessionId, focus) {
  /** @type {string | undefined} */
  let tab;
  button.hidden = true;
  button.addEventListener('click', () => {
    if (tab !== undefined) focus(tab);
  });
  return (layout) => {
    tab = placeOf(layout, { kind: 'session', id: sessionId })?.tab.id;
    button.hidden = tab === undefined;
  };
}
