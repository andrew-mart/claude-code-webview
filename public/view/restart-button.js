// @ts-check
// The button over a session that restarts it: Claude Code quits in the session's herdr tab — its turn and its background
// commands end — and starts again there resuming the session, with the variables the viewer was given (--restart-env).
// A first press asks — the button says to press again — a second, within a few seconds, restarts; there while the
// session runs in Claude Code in a herdr tab, none otherwise.
import { placeOf } from '../model/herdr.js';
import { icon } from './icons.js';

/** How long the button waits for the second press that confirms a restart. */
const askingMs = 5000;

/**
 * @param {HTMLButtonElement} button
 * @param {string} sessionId
 * @param {() => Promise<import('../model/herdr.js').TabChange>} restart — the session restarted, once confirmed
 * @returns {(layout: import('../model/herdr.js').HerdrLayout) => void} — the button shown anew for what herdr has now
 */
export function restartButton(button, sessionId, restart) {
  /** The variables the session restarts with, as the viewer tells them. */
  /** @type {readonly string[]} */
  let variables = [];
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let asking;
  /** @param {'ready' | 'asking' | 'failed'} state */
  const draw = (state) => {
    const resumed = `Claude Code quits in its tab — its turn and background commands end — and resumes the session there${variables.length === 0 ? '' : `, with ${variables.join(' ')}`}`;
    const titles = { ready: `Restart the session: ${resumed}`, asking: `Press again to restart: ${resumed}`, failed: 'The session could not be restarted — press to try again' };
    const words = { ready: 'Restart the session', asking: 'Press again to restart', failed: 'Not restarted — try again' };
    button.classList.toggle('asking', state === 'asking');
    button.classList.toggle('failed', state === 'failed');
    button.title = titles[state];
    button.setAttribute('aria-label', button.title);
    // its icon alone changes: the words it is listed by in the view menu on a phone stay, in short (app.js: labelled)
    const shown = button.querySelector(':scope > .icon');
    const next = icon(state === 'asking' ? 'check' : 'reload');
    if (shown === null) button.prepend(next);
    else shown.replaceWith(next);
    const label = button.querySelector(':scope > .head-tool-label');
    if (label !== null) label.textContent = words[state];
  };
  const settle = () => {
    clearTimeout(asking);
    asking = undefined;
  };
  button.hidden = true;
  draw('ready');
  button.addEventListener('click', () => {
    if (asking === undefined) {
      asking = setTimeout(() => {
        asking = undefined;
        draw('ready');
      }, askingMs);
      draw('asking');
      return;
    }
    settle();
    draw('ready');
    button.disabled = true;
    void restart().then((outcome) => {
      button.disabled = false;
      draw(outcome.ok ? 'ready' : 'failed');
    });
  });
  return (layout) => {
    const pane = placeOf(layout, { kind: 'session', id: sessionId })?.tab.panes.find((one) => one.session === sessionId);
    variables = layout.restartEnv ?? [];
    button.hidden = pane?.agent !== 'claude';
    if (button.hidden) settle();
    if (asking === undefined && !button.classList.contains('failed')) draw('ready');
  };
}
