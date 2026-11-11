// @ts-check
// On a narrow screen the session list and the outline do not fit beside the feed: they slide over it as drawers,
// one at a time, and close on a tap outside, Esc, a swipe toward the side they came from (edge-swipe.js), or once
// something in them is chosen.
// The open drawer is kept in the browser's history entry (the only thing the page keeps there): going back to a page
// shows it as it was left. On a phone the swipe from the left edge is the browser's Back, and it slides in a picture of
// that page — usually with the session list open, since the session was chosen in it. Not in the iPhone's home-screen
// app: there the page keeps no pages to go back to, and the swipe opens the list (page-address.js, edge-swipe.js).
import { isRecord } from '../model/narrow.js';

/** @typedef {'sessions' | 'outline'} Drawer */

/**
 * @param {{ root: HTMLElement, backdrop: HTMLElement, history: History, pages: 'kept' | 'replaced' }} parts — root: its
 *   data-drawer names the open drawer, for the styles; backdrop: the shade over the feed while a drawer is open; pages:
 *   whether going on keeps the page left to go back to, or replaces it, as the iPhone's home-screen app does
 *   (page-address.js) — there WebKit keeps the entry's state, the drawer open, with the address that replaced it
 */
export function createDrawers({ root, backdrop, history, pages }) {
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
    /** @returns {Drawer | undefined} — the drawer open, none while none is */
    shown: () => drawerNamed(root.dataset.drawer),
    /**
     * Links chosen in a drawer make way for the page they lead to: going elsewhere, it closes on arrival; a link to the
     * page shown — the session open — goes nowhere, and closes it at once. A click taken for something else — the open
     * herdr row's buttons — leaves it open.
     * @param {HTMLElement} drawer
     */
    closeOnLinksIn(drawer) {
      const document = drawer.ownerDocument;
      const view = document.defaultView;
      drawer.addEventListener('click', (event) => {
        const link = view !== null && event.target instanceof view.Element ? event.target.closest('a[href^="#"]') : null;
        if (!event.defaultPrevented && link !== null && link.getAttribute('href') === document.location.hash) close();
      });
    },
    /** @param {Drawer} name */
    toggle(name) {
      show(root.dataset.drawer === name ? undefined : name);
    },
    /**
     * The address has changed: back to a page — the drawer it was left with; a new page — none. Where no page is kept to
     * go back to, every page is a new one.
     */
    arrive() {
      show(pages === 'kept' ? drawerIn(history.state) : undefined);
    },
  };
}

/**
 * @param {unknown} state — history.state
 * @returns {Drawer | undefined}
 */
function drawerIn(state) {
  return isRecord(state) && typeof state.drawer === 'string' ? drawerNamed(state.drawer) : undefined;
}

/**
 * @param {string | undefined} name — the page's data-drawer
 * @returns {Drawer | undefined}
 */
function drawerNamed(name) {
  return name === 'sessions' || name === 'outline' ? name : undefined;
}
