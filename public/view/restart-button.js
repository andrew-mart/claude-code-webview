// @ts-check
// A button in a session's details that restarts it: Claude Code quits in the session's herdr tab — its turn and its
// background commands end — and starts again there resuming the session: plainly, or with the variables the viewer was
// given (--restart-env), which that button names. A first press asks — the button says to press again — a second,
// within a few seconds, restarts; there while the session runs in Claude Code in a herdr tab — the one with variables
// only while there are some — none otherwise.
import { placeOf } from '../model/herdr.js';
import { h } from './dom.js';
import { icon } from './icons.js';

/** How long the button waits for the second press that confirms a restart. */
const askingMs = 5000;

/**
 * @param {HTMLButtonElement} button
 * @param {string} sessionId
 * @param {{ variables: 'given' | 'none', restart: () => Promise<import('../model/herdr.js').TabChange> }} how — variables:
 *   those the viewer was given set ahead of Claude Code, or none; restart: the session restarted, once confirmed
 * @returns {(layout: import('../model/herdr.js').HerdrLayout) => void} — the button shown anew for what herdr has now
 */
export function restartButton(button, sessionId, { variables: set, restart }) {
  /** The variables the session restarts with, as the viewer tells them. */
  /** @type {readonly string[]} */
  let variables = [];
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let asking;
  /** @param {'ready' | 'asking' | 'failed'} state */
  const draw = (state) => {
    const resumed = `Claude Code quits in its tab — its turn and background commands end — and resumes the session there${variables.length === 0 ? '' : `, with ${variables.join(' ')}`}`;
    const titles = { ready: `Restart the session: ${resumed}`, asking: `Press again to restart: ${resumed}`, failed: 'The session could not be restarted — press to try again' };
    const words = { ready: variables.length === 0 ? 'Restart the session' : `Restart with ${variables.join(' ')}`, asking: 'Press again to restart', failed: 'Not restarted — try again' };
    button.classList.toggle('asking', state === 'asking');
    button.classList.toggle('failed', state === 'failed');
    button.title = titles[state];
    button.setAttribute('aria-label', button.title);
    button.replaceChildren(icon(state === 'asking' ? 'check' : 'reload'), h('span', { text: words[state] }));
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
    variables = set === 'given' ? (layout.restartEnv ?? []) : [];
    button.hidden = pane?.agent !== 'claude' || (set === 'given' && variables.length === 0);
    if (button.hidden) settle();
    if (asking === undefined && !button.classList.contains('failed')) draw('ready');
  };
}
