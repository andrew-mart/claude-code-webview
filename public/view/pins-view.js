// @ts-check
// The files pinned beside the session, in the outline under its notes: those pinned to the session first, then its
// project folder's, each once, by the name given it — else its file's — marked by where it is pinned; a click opens one
// in the side panel — where 📌 over a file pins it — ✎ names it in the list, its file's name left as it is, and × unpins
// it from everywhere it is pinned. + over the list pins a file by its path, typed or pasted in, to the project or to the
// session — what is on the disk offered under it as it is typed, folder by folder; with no file there it says why.
import { pinKey, pinLabel } from '../model/pins.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { keepOrLeave } from './keep-or-leave.js';
import { pinRefusals } from './pins-store.js';

/**
 * @typedef {import('../model/pins.js').SessionPins} SessionPins
 * @typedef {import('../model/pins.js').PinScope} PinScope
 * @typedef {import('../model/pins.js').Pin} Pin
 * @typedef {import('./pins-store.js').PinOutcome} PinOutcome
 */

/** The paths offered under the field at most: a folder's first ones, the rest found by typing on. */
const maxOffers = 30;

/**
 * @param {{ open: (path: string) => void, unpin: (path: string) => void, pinPath: (scope: PinScope, path: string) => Promise<PinOutcome>, rename: (path: string, name: string) => void, pathsOnDisk: (typed: string) => Promise<readonly import('../model/pins.js').PathOffer[]>, iconOf: (name: string) => HTMLElement }} actions
 *   — open: a file shown in the side panel; unpin: a file unpinned from everywhere it is pinned; pinPath: a file pinned
 *   by its path, how that went; rename: a pinned file named in the list, a blank name giving back the file's; iconOf: a
 *   file's icon
 * @returns {{ element: HTMLElement, show: (pins: SessionPins) => void }} — show: the pins as they stand now
 */
export function createPinsView({ open, unpin, pinPath, rename, pathsOnDisk, iconOf }) {
  const count = h('span', { className: 'outline-count' });
  const adding = h('button', { className: 'icon-button pins-add', title: 'Pin a file by its path', attrs: { type: 'button', 'aria-label': 'Pin a file by its path' } }, [icon('plus')]);
  const asking = h('div', { className: 'pins-asking', attrs: { hidden: '' } });
  const list = h('div', { className: 'pins-list' });
  const element = h('section', { className: 'outline-section pins' }, [h('div', { className: 'outline-title' }, [h('span', { text: 'Pinned' }), h('span', { className: 'pins-title-end' }, [count, adding])]), asking, list]);
  /** The pins drawn last: a row named anew is drawn from them. */
  /** @type {SessionPins} */
  let shown = { folder: [], session: [] };
  /** A row being named: the pins coming again wait. */
  let naming = false;

  /** The path asked for, and where to pin it: To the project, To this session. */
  const askPath = () => {
    const field = h('input', { className: 'pins-path', attrs: { type: 'text', placeholder: 'The path of a file: D:\\…, /home/…, ~/…', 'aria-label': 'The path of a file to pin', autocomplete: 'off', spellcheck: 'false' } });
    const told = h('div', { className: 'pins-told' });
    // what is on the disk for the path typed: a folder picked goes on into it, a file picked is the path to pin; an
    // answer for what was typed before is dropped
    const offers = h('div', { className: 'pins-offers' });
    let looks = 0;
    const lookOnDisk = () => {
      const turn = ++looks;
      void pathsOnDisk(field.value).then((found) => {
        if (turn === looks) offers.replaceChildren(...found.slice(0, maxOffers).map(offerOf));
      });
    };
    /** @param {import('../model/pins.js').PathOffer} offer */
    const offerOf = (offer) => {
      const made = h('button', { className: `pins-offer ${offer.kind}`, title: offer.path, attrs: { type: 'button' } }, [offer.kind === 'folder' ? icon('folder') : iconOf(offer.name), h('span', { text: offer.name })]);
      // picked, the field keeps the focus: on a phone the keyboard stays up
      made.addEventListener('mousedown', (event) => event.preventDefault());
      made.addEventListener('click', () => {
        field.value = offer.path;
        field.focus();
        if (offer.kind === 'folder') lookOnDisk();
        else offers.replaceChildren();
      });
      return made;
    };
    field.addEventListener('input', lookOnDisk);
    /** @param {PinScope} scope @param {string} words @param {string} title */
    const toward = (scope, words, title) => {
      const made = h('button', { className: `pins-to-${scope}`, text: words, title, attrs: { type: 'button' } });
      made.addEventListener('click', () => void pinTo(scope));
      return made;
    };
    const leaving = h('button', { className: 'icon-button pins-leave', title: 'Pin nothing', attrs: { type: 'button', 'aria-label': 'Pin nothing' } }, [icon('cross')]);
    /** @param {PinScope} scope */
    const pinTo = async (scope) => {
      // a path pasted in may come with spaces, or in quotes, around it
      const path = field.value.trim().replace(/^"(.*)"$/, '$1').trim();
      if (path === '') return;
      told.textContent = '';
      const outcome = await pinPath(scope, path);
      if (outcome === 'pinned') close();
      else told.textContent = pinRefusals[outcome];
    };
    const close = () => {
      asking.hidden = true;
      asking.replaceChildren();
    };
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void pinTo('folder');
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    });
    leaving.addEventListener('click', close);
    asking.hidden = false;
    asking.replaceChildren(h('div', { className: 'pins-path-row' }, [field, leaving]), offers, h('div', { className: 'pins-choice' }, [toward('folder', 'To the project', "Pin it beside every session in the session's project folder (Enter)"), toward('session', 'To this session', 'Pin it beside this session alone')]), told);
    field.focus();
  };
  adding.addEventListener('click', () => (asking.hidden ? askPath() : undefined));

  /**
   * The row's name gives way to a field to name the file in the list: Enter or ✓ keeps the name, Esc or ✕ leaves it.
   * @param {HTMLElement} row @param {string} path @param {string | undefined} name — given before
   */
  const startNaming = (row, path, name) => {
    naming = true;
    const fileName = path.split(/[\\/]/).filter((part) => part !== '').at(-1) ?? path;
    const field = h('input', { className: 'pin-name-field', attrs: { type: 'text', placeholder: fileName, 'aria-label': `A name for ${fileName} in the list`, autocomplete: 'off', spellcheck: 'false' } });
    field.value = name ?? '';
    let over = false;
    const keep = () => {
      if (over) return;
      over = true;
      if (field.value.trim() !== (name ?? '')) rename(path, field.value);
      naming = false;
      draw();
    };
    const leave = () => {
      over = true;
      naming = false;
      draw();
    };
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        keep();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        leave();
      }
    });
    field.addEventListener('blur', keep);
    row.replaceChildren(field, ...keepOrLeave({ keep, leave, keepTitle: 'Keep the name (Enter)', leaveTitle: 'Leave it as it was (Esc)' }));
    field.focus();
  };

  /**
   * @param {Pin} pin — as pinned to the session, else to the project
   * @param {readonly PinScope[]} scopes — where it is pinned
   */
  const pinRow = (pin, scopes) => {
    const label = pinLabel(pin);
    const where = scopes.map((scope) => (scope === 'session' ? 'session' : 'project')).join(' · ');
    const opening = h('button', { className: 'pin-open', title: `${pin.path} — pinned to the ${where}`, attrs: { type: 'button' } }, [iconOf(pin.path.split(/[\\/]/).pop() ?? pin.path), h('span', { className: 'pin-name', text: label }), h('span', { className: 'pin-scope', text: where })]);
    const renaming = h('button', { className: 'icon-button pin-rename', title: 'Name it in the list — the file keeps its name', attrs: { type: 'button', 'aria-label': `Name ${label} in the list` } }, [icon('edit')]);
    const removing = h('button', { className: 'icon-button pin-remove', title: 'Unpin the file', attrs: { type: 'button', 'aria-label': `Unpin ${label}` } }, [icon('cross')]);
    const row = h('div', { className: 'pin-row' }, [opening, renaming, removing]);
    opening.addEventListener('click', () => open(pin.path));
    renaming.addEventListener('click', () => startNaming(row, pin.path, pin.name));
    removing.addEventListener('click', () => unpin(pin.path));
    return row;
  };

  const draw = () => {
    /** @type {Map<string, { pin: Pin, scopes: PinScope[] }>} */
    const files = new Map();
    for (const [scope, pinned] of /** @type {const} */ ([['session', shown.session], ['folder', shown.folder]])) {
      for (const pin of pinned) {
        const known = files.get(pinKey(pin.path));
        files.set(pinKey(pin.path), known === undefined ? { pin, scopes: [scope] } : { ...known, scopes: [...known.scopes, scope] });
      }
    }
    count.textContent = files.size === 0 ? '' : String(files.size);
    list.replaceChildren(...(files.size === 0 ? [h('div', { className: 'outline-empty pins-empty', text: 'Files kept at hand: + pins one by its path, 📌 over a file in the side panel pins it.' })] : [...files.values()].map(({ pin, scopes }) => pinRow(pin, scopes))));
  };

  draw();
  return {
    element,
    show(pins) {
      shown = pins;
      if (!naming) draw();
    },
  };
}
