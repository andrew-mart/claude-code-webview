// @ts-check
// On a narrow screen the session list and the outline do not fit beside the feed: they slide over it as drawers,
// one at a time, and close on a tap outside, Esc, or once something in them is chosen.
// The open drawer is kept in the browser's history entry (the only thing the page keeps there): going back to a page
// shows it as it was left. On a phone the swipe from the left edge is the browser's Back, and it slides in a picture of
// that page — usually with the session list open, since the session was chosen in it.
import { isRecord } from '../model/narrow.js';

/** @typedef {'sessions' | 'outline'} Drawer */

/**
 * @param {{ root: HTMLElement, backdrop: HTMLElement, history: History }} parts — root: its data-drawer names the open
 *   drawer, for the styles; backdrop: the shade over the feed while a drawer is open
 */
export function createDrawers({ root, backdrop, history }) {
  /** @param {Drawer | undefined} name */
  const show = (name) => {
    if (name === undefined) delete root.dataset.drawer;
    else root.dataset.drawer = name;
    history.replaceState(name === undefined ? null : { drawer: name }, '');
  };
  const close = () => show(undefined);
  backdrop.addEventListener('click', close);
  return {
    close,
    isOpen: () => root.dataset.drawer !== undefined,
    /** @param {Drawer} name */
    toggle(name) {
      show(root.dataset.drawer === name ? undefined : name);
    },
    /** The address has changed: back to a page — the drawer it was left with; a new page — none. */
    arrive() {
      show(drawerIn(history.state));
    },
  };
}

/**
 * @param {unknown} state — history.state
 * @returns {Drawer | undefined}
 */
function drawerIn(state) {
  if (!isRecord(state)) return undefined;
  return state.drawer === 'sessions' || state.drawer === 'outline' ? state.drawer : undefined;
}
