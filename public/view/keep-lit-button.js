// @ts-check
// The button over a session that keeps its agent lit to come back to (model/lamps.js: keptLit): a press marks it, the
// next takes the mark off; pressed while the mark holds — the agent changing state ends it. There while the session runs
// in a herdr pane, none otherwise.
import { keptNow } from '../model/lamps.js';

/**
 * @param {HTMLButtonElement} button
 * @param {string} sessionId
 * @param {(pane: import('../model/herdr.js').HerdrPane) => void} toggle — the agent marked, or its mark taken off
 * @returns {(layout: import('../model/herdr.js').HerdrLayout, kept: import('../model/lamps.js').KeptPanes) => void} —
 *   the button shown anew for what herdr has and what is kept lit now
 */
export function keepLitButton(button, sessionId, toggle) {
  /** @type {import('../model/herdr.js').HerdrPane | undefined} */
  let pane;
  button.hidden = true;
  button.addEventListener('click', () => {
    if (pane !== undefined) toggle(pane);
  });
  return (layout, kept) => {
    pane = layout.workspaces.flatMap((workspace) => workspace.tabs.flatMap((tab) => tab.panes)).find((one) => one.session === sessionId);
    button.hidden = pane === undefined;
    button.setAttribute('aria-pressed', String(pane !== undefined && keptNow(pane, kept)));
  };
}
