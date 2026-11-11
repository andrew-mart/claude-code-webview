// @ts-check
// A button in a session's details that restarts it: Claude Code quits in the session's herdr tab — its turn and its
// background commands end — and starts again there resuming the session: plainly, or with the variables the viewer was
// given (--restart-env), which that button names; or in the other launcher than it runs in — through GPT, or in
// ordinary Claude Code. A first press asks — the button says to press again — a second, within a few seconds, restarts;
// there while the session runs in Claude Code in a herdr tab — the one with variables only while there are some, the one
// in the other launcher only while the viewer has Claude Code through GPT — none otherwise.
import { askerNames } from '../model/composer.js';
import { placeOf } from '../model/herdr.js';
import { h } from './dom.js';
import { icon } from './icons.js';

/** How long the button waits for the second press that confirms a restart. */
const askingMs = 5000;

/**
 * @param {HTMLButtonElement} button
 * @param {string} sessionId
 * @param {{ variables: 'given' | 'none', launcher: 'as-it-ran' | 'other', throughGpt: () => boolean, restart: (launcher: import('../model/herdr.js').RestartLauncher) => Promise<import('../model/herdr.js').TabChange> }} how
 *   — variables: those the viewer was given set ahead of Claude Code, or none; launcher: the one it runs in, or the other;
 *   throughGpt: whether the session runs through GPT now; restart: the session restarted, once confirmed
 * @returns {(layout: import('../model/herdr.js').HerdrLayout) => void} — the button shown anew for what herdr has now
 */
export function restartButton(button, sessionId, { variables: set, launcher, throughGpt, restart }) {
  /** The variables the session restarts with, as the viewer tells them. */
  /** @type {readonly string[]} */
  let variables = [];
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let asking;
  /** @returns {import('../model/herdr.js').RestartLauncher} */
  const target = () => (launcher === 'as-it-ran' ? 'as-it-ran' : throughGpt() ? 'claude' : 'claude-gpt');
  /** @param {'ready' | 'asking' | 'failed'} state */
  const draw = (state) => {
    const to = target();
    const where = { 'as-it-ran': '', claude: ' in ordinary Claude Code', 'claude-gpt': ' through GPT' }[to];
    const resumed = `Claude Code quits in its tab — its turn and background commands end — and resumes the session there${where}${variables.length === 0 ? '' : `, with ${variables.join(' ')}`}`;
    const ready = { 'as-it-ran': variables.length === 0 ? 'Restart the session' : `Restart with ${variables.join(' ')}`, claude: 'Restart in Claude Code', 'claude-gpt': 'Restart in Claude GPT' }[to];
    const titles = { ready: `Restart the session: ${resumed}`, asking: `Press again to restart: ${resumed}`, failed: 'The session could not be restarted — press to try again' };
    const words = { ready, asking: 'Press again to restart', failed: 'Not restarted — try again' };
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
    void restart(target()).then((outcome) => {
      button.disabled = false;
      draw(outcome.ok ? 'ready' : 'failed');
    });
  });
  return (layout) => {
    const pane = placeOf(layout, { kind: 'session', id: sessionId })?.tab.panes.find((one) => one.session === sessionId);
    variables = set === 'given' ? (layout.restartEnv ?? []) : [];
    button.hidden = pane?.agent !== 'claude' || (set === 'given' && variables.length === 0) || (launcher === 'other' && layout.claudeGpt !== true);
    if (button.hidden) settle();
    if (asking === undefined && !button.classList.contains('failed')) draw('ready');
  };
}

/**
 * The button beside the restarts that quits the session's agent — Claude Code, Codex or agy — to its tab's shell: its
 * turn and background commands end, the tab stays at its shell's prompt. A first press asks, a second within a few
 * seconds quits; there while one of them runs the session in a herdr tab.
 * @param {HTMLButtonElement} button
 * @param {string} sessionId
 * @param {{ exit: () => Promise<import('../model/herdr.js').TabChange> }} how — exit: the agent quit, once confirmed
 * @returns {(layout: import('../model/herdr.js').HerdrLayout) => void} — the button shown anew for what herdr has now
 */
export function exitButton(button, sessionId, { exit }) {
  /** The agent in the session's tab, as herdr told it last. */
  let agent = 'Claude Code';
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let asking;
  /** @param {'ready' | 'asking' | 'failed'} state */
  const draw = (state) => {
    const quits = `${agent} quits in its tab — its turn and background commands end — and the tab stays at its shell`;
    const titles = { ready: `Exit to the terminal: ${quits}`, asking: `Press again to exit: ${quits}`, failed: `${agent} did not quit — press to try again` };
    const words = { ready: 'Exit to the terminal', asking: 'Press again to exit', failed: 'Not exited — try again' };
    button.classList.toggle('asking', state === 'asking');
    button.classList.toggle('failed', state === 'failed');
    button.title = titles[state];
    button.setAttribute('aria-label', button.title);
    button.replaceChildren(icon(state === 'asking' ? 'check' : 'shell'), h('span', { text: words[state] }));
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
    void exit().then((outcome) => {
      button.disabled = false;
      draw(outcome.ok ? 'ready' : 'failed');
    });
  });
  return (layout) => {
    const pane = placeOf(layout, { kind: 'session', id: sessionId })?.tab.panes.find((one) => one.session === sessionId);
    const quitting = pane?.agent === 'claude' || pane?.agent === 'codex' || pane?.agent === 'agy' ? pane.agent : undefined;
    button.hidden = quitting === undefined;
    if (quitting !== undefined) agent = askerNames[quitting];
    if (button.hidden) settle();
    if (asking === undefined && !button.classList.contains('failed')) draw('ready');
  };
}
