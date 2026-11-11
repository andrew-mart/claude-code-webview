// @ts-check
// The session's desk over its notes (model/desks.js): its name; pressed, the desks around — the session's marked — one
// picked taken up; a desk made anew by its name; the session's desk moved to another folder typed, the folders on the
// disk offered as it is typed, folder by folder. What was refused is told under them; Esc puts them away.
import { deskRefusals } from '../model/desks.js';
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @typedef {import('../model/desks.js').DeskState} DeskState
 * @typedef {import('../model/desks.js').DeskRef} DeskRef
 * @typedef {import('../model/desks.js').DeskChange} DeskChange
 * @typedef {import('../model/desks.js').DeskChanged} DeskChanged
 * @typedef {import('../model/pins.js').PathOffer} PathOffer
 */

/**
 * @param {{ change: (what: DeskChange) => Promise<DeskChanged>, foldersOnDisk: (typed: string) => Promise<readonly PathOffer[]> }} parts
 *   — change: another desk taken up, one made, the desk moved — the desk after it, or why not; foldersOnDisk: what is on
 *   the disk for a path typed
 * @returns {{ label: HTMLButtonElement, panel: HTMLElement, show: (state: DeskState) => void }} — label: for the notes'
 *   title; panel: under it; show: the desk as it is now
 */
export function createDeskView({ change, foldersOnDisk }) {
  const name = h('span', { className: 'desk-label-name' });
  const label = h('button', { className: 'desk-label', attrs: { type: 'button', 'aria-expanded': 'false' } }, [icon('desk'), name]);
  const list = h('div', { className: 'desk-list' });
  const newName = h('input', { className: 'desk-new-name', attrs: { type: 'text', placeholder: 'A new desk: its name, Enter', 'aria-label': 'Name of a new desk', autocomplete: 'off', spellcheck: 'false' } });
  const moveFolder = h('input', { className: 'desk-move-folder', attrs: { type: 'text', placeholder: 'Move this desk to a folder: its path, Enter', 'aria-label': 'Folder to move this desk to', autocomplete: 'off', spellcheck: 'false' } });
  const offers = h('div', { className: 'desk-offers' });
  const told = h('div', { className: 'desk-told', attrs: { role: 'status' } });
  const panel = h('div', { className: 'desk-panel', attrs: { hidden: '' } }, [list, newName, moveFolder, offers, told]);
  /** @type {DeskState} */
  let shown = { current: undefined, offered: [] };
  let sending = false;
  let looks = 0;

  const close = () => {
    panel.hidden = true;
    label.setAttribute('aria-expanded', 'false');
    told.textContent = '';
    offers.replaceChildren();
  };
  /** @param {DeskRef} desk */
  const rowOf = (desk) => {
    const current = desk.path === shown.current?.path;
    const row = h('button', { className: 'desk-row', title: desk.path, attrs: { type: 'button', 'aria-current': String(current) } }, [
      h('span', { className: 'desk-row-name', text: desk.name }),
      h('span', { className: 'desk-row-folder', text: folderLabel(desk.folder) }),
    ]);
    row.addEventListener('click', () => {
      if (!current) void send({ action: 'choose', path: desk.path });
    });
    return row;
  };
  const draw = () => {
    const current = shown.current;
    name.textContent = current === undefined ? 'No desk yet' : current.name;
    label.title = current === undefined ? "The first note or file pinned makes this session's desk, in the folder it started in" : `This session's desk, in ${current.folder} — press for the others`;
    list.replaceChildren(...shown.offered.map(rowOf));
    moveFolder.hidden = current === undefined;
  };
  /** @param {DeskChange} what */
  const send = async (what) => {
    if (sending) return;
    sending = true;
    told.textContent = '';
    const done = await change(what);
    sending = false;
    if (!done.ok) {
      told.textContent = deskRefusals[done.error];
      return;
    }
    shown = done.desk;
    newName.value = '';
    moveFolder.value = '';
    draw();
    close();
  };
  /** what is on the disk for the folder typed: a folder picked goes into the field, and on into it */
  const lookOnDisk = () => {
    const turn = ++looks;
    void foldersOnDisk(moveFolder.value).then((found) => {
      if (turn !== looks) return;
      offers.replaceChildren(
        ...found
          .filter((offer) => offer.kind === 'folder')
          .map((offer) => {
            const made = h('button', { className: 'desk-offer', title: offer.path, attrs: { type: 'button' } }, [icon('folder'), h('span', { text: offer.name })]);
            made.addEventListener('mousedown', (event) => event.preventDefault());
            made.addEventListener('click', () => {
              moveFolder.value = offer.path;
              moveFolder.focus();
              lookOnDisk();
            });
            return made;
          }),
      );
    });
  };

  label.addEventListener('click', () => {
    if (!panel.hidden) {
      close();
      return;
    }
    draw();
    panel.hidden = false;
    label.setAttribute('aria-expanded', 'true');
  });
  newName.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || newName.value.trim() === '') return;
    event.preventDefault();
    void send({ action: 'create', name: newName.value.trim() });
  });
  moveFolder.addEventListener('input', lookOnDisk);
  moveFolder.addEventListener('keydown', (event) => {
    // a path pasted in may come in quotes
    const folder = moveFolder.value.trim().replace(/^"(.*)"$/, '$1').trim();
    if (event.key !== 'Enter' || folder === '') return;
    event.preventDefault();
    void send({ action: 'move', folder });
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  });
  return {
    label,
    panel,
    show(state) {
      shown = state;
      draw();
    },
  };
}

/**
 * A desk's folder as the list names it: its last two parts — the whole path on hover.
 * @param {string} folder
 * @returns {string}
 */
function folderLabel(folder) {
  return folder.split(/[\\/]/).filter((part) => part !== '').slice(-2).join('/');
}
