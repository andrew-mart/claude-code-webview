// @ts-check
// The pin over a file in the side panel: pins it beside the open session — to the session's project folder, every
// session in it showing it, or to the session alone, chosen once it is pressed — and, pressed while the file is pinned,
// unpins it from everywhere it is. There over a file while a session is open, none otherwise.
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @typedef {import('../model/pins.js').PinScope} PinScope
 * @typedef {{ scopesOf: (path: string) => readonly PinScope[] | undefined, pin: (path: string, scope: PinScope) => void, unpin: (path: string) => void }} PinFiles
 *   — scopesOf: where a file is pinned, none while no session is open to pin it beside; pin: a file pinned there;
 *   unpin: a file unpinned from everywhere
 */

/**
 * @param {PinFiles} pins
 * @returns {{ element: HTMLElement, show: (path: string | undefined) => void, refresh: () => void }} — show: the file the
 *   panel shows now, none for a list; refresh: drawn again for the pins as they stand
 */
export function createPinButton(pins) {
  const button = h('button', { className: 'icon-button panel-pin', attrs: { type: 'button' } }, [icon('pin')]);
  /** @param {PinScope} scope @param {string} words @param {string} title */
  const toward = (scope, words, title) => {
    const made = h('button', { className: `panel-pin-to-${scope}`, text: words, title, attrs: { type: 'button' } });
    made.addEventListener('click', () => {
      if (path !== undefined) pins.pin(path, scope);
      choice.hidden = true;
      draw();
    });
    return made;
  };
  const choice = h('div', { className: 'panel-pin-choice', attrs: { hidden: '', role: 'group', 'aria-label': 'Pin the file' } }, [
    toward('folder', 'To the project', "Pin it beside every session in the session's project folder"),
    toward('session', 'To this session', 'Pin it beside this session alone'),
  ]);
  const element = h('span', { className: 'panel-pin-slot', attrs: { hidden: '' } }, [button, choice]);
  /** The file shown in the panel. */
  /** @type {string | undefined} */
  let path;
  const draw = () => {
    const scopes = path === undefined ? undefined : pins.scopesOf(path);
    element.hidden = scopes === undefined;
    const pinned = scopes !== undefined && scopes.length > 0;
    const where = (scopes ?? []).map((scope) => (scope === 'folder' ? 'the project' : 'this session')).join(' and ');
    button.title = pinned ? `Unpin the file — pinned to ${where}` : 'Pin the file beside the session, in its outline';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(pinned));
    if (element.hidden || pinned) choice.hidden = true;
  };
  button.addEventListener('click', () => {
    if (path === undefined) return;
    if (button.getAttribute('aria-pressed') === 'true') {
      pins.unpin(path);
      draw();
    } else choice.hidden = !choice.hidden;
  });
  // the choice goes on a press elsewhere, or Escape
  document.addEventListener('pointerdown', (event) => {
    if (event.target instanceof window.Node && !element.contains(event.target)) choice.hidden = true;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') choice.hidden = true;
  });
  draw();
  return {
    element,
    show(next) {
      path = next;
      choice.hidden = true;
      draw();
    },
    refresh: draw,
  };
}
