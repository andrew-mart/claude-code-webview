// @ts-check
// The row of a session's details that sets its effort — how hard Claude Code thinks, low to max: the level pressed is
// typed into its terminal as /effort and lit at once, until its status line tells the session works at it; the level
// it works at is lit otherwise. There while the session runs in Claude Code in a herdr tab — hidden otherwise.
import { placeOf } from '../model/herdr.js';
import { h } from './dom.js';

/** Claude Code's effort levels, the least first. */
const levels = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * @param {string} sessionId
 * @param {{ set: (level: string) => Promise<boolean> }} how — set: /effort and the level typed into the session's
 *   terminal; whether it took it
 * @returns {{ row: HTMLElement, show: (layout: import('../model/herdr.js').HerdrLayout) => void, showCurrent: (effort: string | undefined) => void }}
 *   — show: the row there or not for what herdr has now; showCurrent: the level the session works at, as its status
 *   line tells it
 */
export function createEffortRow(sessionId, { set }) {
  /** The level the session works at. @type {string | undefined} */
  let current;
  /** The level pressed, until the session works at it. @type {string | undefined} */
  let asked;
  const told = h('span', { className: 'head-effort-told', attrs: { role: 'status' } });
  const draw = () => {
    const lit = asked ?? current;
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.textContent === lit));
  };
  const buttons = levels.map((level) => {
    const button = h('button', { className: 'segment', text: level, title: `Think at ${level} effort — /effort ${level} typed into the session`, attrs: { type: 'button', 'aria-pressed': 'false' } });
    button.addEventListener('click', () => {
      asked = level;
      told.textContent = '';
      draw();
      void set(level).then((taken) => {
        if (taken || asked !== level) return;
        asked = undefined;
        told.textContent = `Not set — the terminal did not take /effort ${level}`;
        draw();
      });
    });
    return button;
  });
  const row = h('div', { className: 'head-detail' }, [h('dt', { text: 'Effort' }), h('dd', {}, [h('span', { className: 'segments', attrs: { role: 'group', 'aria-label': 'Effort of this session' } }, buttons), told])]);
  row.hidden = true;
  return {
    row,
    show(layout) {
      const pane = placeOf(layout, { kind: 'session', id: sessionId })?.tab.panes.find((one) => one.session === sessionId);
      row.hidden = pane?.agent !== 'claude';
    },
    showCurrent(effort) {
      current = effort;
      if (asked === effort) asked = undefined;
      draw();
    },
  };
}
