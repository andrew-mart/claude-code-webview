// @ts-check
// The files pinned beside the session, in the outline under its notes: those pinned to the session first, then its
// project folder's, each once, marked by where it is pinned; a click opens one in the side panel — where 📌 over a file
// pins it — and × unpins it from everywhere it is pinned. With none pinned the section is not there.
import { pinKey } from '../model/pins.js';
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @typedef {import('../model/pins.js').SessionPins} SessionPins
 * @typedef {import('../model/pins.js').PinScope} PinScope
 */

/**
 * @param {{ open: (path: string) => void, unpin: (path: string) => void, iconOf: (name: string) => HTMLElement }} actions
 *   — open: a file shown in the side panel; unpin: a file unpinned from everywhere it is pinned; iconOf: a file's icon
 * @returns {{ element: HTMLElement, show: (pins: SessionPins) => void }} — show: the pins as they stand now
 */
export function createPinsView({ open, unpin, iconOf }) {
  const count = h('span', { className: 'outline-count' });
  const list = h('div', { className: 'pins-list' });
  const element = h('section', { className: 'outline-section pins', attrs: { hidden: '' } }, [h('div', { className: 'outline-title' }, [h('span', { text: 'Pinned' }), count]), list]);

  /**
   * @param {string} path
   * @param {readonly PinScope[]} scopes — where it is pinned
   */
  const pinRow = (path, scopes) => {
    const name = path.split(/[\\/]/).filter((part) => part !== '').at(-1) ?? path;
    const where = scopes.map((scope) => (scope === 'session' ? 'session' : 'project')).join(' · ');
    const opening = h('button', { className: 'pin-open', title: `${path} — pinned to the ${where}`, attrs: { type: 'button' } }, [iconOf(name), h('span', { className: 'pin-name', text: name }), h('span', { className: 'pin-scope', text: where })]);
    const removing = h('button', { className: 'icon-button pin-remove', title: 'Unpin the file', attrs: { type: 'button', 'aria-label': `Unpin ${name}` } }, [icon('cross')]);
    opening.addEventListener('click', () => open(path));
    removing.addEventListener('click', () => unpin(path));
    return h('div', { className: 'pin-row' }, [opening, removing]);
  };

  return {
    element,
    show(pins) {
      /** @type {Map<string, { path: string, scopes: PinScope[] }>} */
      const files = new Map();
      for (const [scope, pinned] of /** @type {const} */ ([['session', pins.session], ['folder', pins.folder]])) {
        for (const pin of pinned) {
          const known = files.get(pinKey(pin.path));
          files.set(pinKey(pin.path), known === undefined ? { path: pin.path, scopes: [scope] } : { ...known, scopes: [...known.scopes, scope] });
        }
      }
      element.hidden = files.size === 0;
      count.textContent = String(files.size);
      list.replaceChildren(...[...files.values()].map(({ path, scopes }) => pinRow(path, scopes)));
    },
  };
}
