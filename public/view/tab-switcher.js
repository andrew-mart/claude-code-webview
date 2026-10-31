// @ts-check
// Ctrl+Tab over the page, as an editor's: herdr's tabs in the order they were opened (model/recent-tabs.js), each drawn
// as the session list draws it — its session's title, its workspace and tab, its lamp — the one opened before this one
// marked. Tab with Ctrl held goes on down the list — round to the first past the last —
// Shift+Tab back, the arrows too, and the wheel a tab a notch — Ctrl held, it would zoom the page, not scroll the
// list; letting go of Ctrl opens the tab marked, as Enter or a click on a tab does; Escape
// leaves the tab open as it was. A browser keeps Ctrl+Tab to itself in its tabs: the page has it in a window of its own —
// installed as an app — or in full screen.
import { h } from './dom.js';

/** A notch of a mouse's wheel, in pixels — a step of the mark; a line and a page of it, where the wheel counts those. */
const wheelNotch = 100;
const wheelLine = 40;
const wheelPage = 800;

/**
 * @typedef {import('../model/recent-tabs.js').SwitcherEntry} SwitcherEntry
 * @typedef {import('../model/herdr.js').Opened} Opened
 */

/**
 * @param {{ entries: () => readonly SwitcherEntry[], open: (place: Opened) => void, rowOf: (entry: SwitcherEntry) => HTMLElement }} parts
 *   — entries: the tabs as they were opened, the latest first — the one open now first; open: a tab switched to; rowOf:
 *   a tab's row as the session list draws it
 * @returns {{ element: HTMLElement }}
 */
export function createTabSwitcher({ entries, open, rowOf }) {
  const list = h('ol', { className: 'tab-switcher-list', attrs: { role: 'listbox', 'aria-label': 'Recent tabs' } });
  const element = h('div', { className: 'tab-switcher', attrs: { hidden: '', role: 'dialog', 'aria-label': 'Switch tabs' } }, [h('div', { className: 'tab-switcher-title', text: 'Recent tabs' }), list]);
  /** The tabs shown, while the switcher is: the marked one's place among them. */
  /** @type {{ tabs: readonly SwitcherEntry[], marked: number } | undefined} */
  let showing;
  /** How far the wheel has turned toward its next step, in pixels: a touchpad's strokes are small. */
  let wheeled = 0;

  const draw = () => {
    if (showing === undefined) return;
    const { tabs, marked } = showing;
    list.replaceChildren(
      ...tabs.map((entry, at) => {
        const item = h('li', { className: `tab-switcher-item${at === marked ? ' selected' : ''}`, attrs: { role: 'option', 'aria-selected': String(at === marked) } }, [rowOf(entry)]);
        item.addEventListener('click', () => choose(at));
        return item;
      }),
    );
    list.children[marked]?.scrollIntoView?.({ block: 'nearest' });
  };
  const hide = () => {
    showing = undefined;
    element.hidden = true;
    list.replaceChildren();
  };
  /** @param {number} at */
  const choose = (at) => {
    const entry = showing?.tabs[at];
    hide();
    if (entry !== undefined) open(entry.place);
  };
  /** @param {number} step */
  const move = (step) => {
    if (showing === undefined) return;
    const count = showing.tabs.length;
    showing = { ...showing, marked: (showing.marked + step + count) % count };
    draw();
  };

  window.addEventListener(
    'keydown',
    (event) => {
      if (showing === undefined) {
        if (!(event.ctrlKey && event.key === 'Tab')) return;
        const tabs = entries();
        // a tab to switch to besides the one open
        if (tabs.length < 2) return;
        event.preventDefault();
        event.stopPropagation();
        showing = { tabs, marked: event.shiftKey ? tabs.length - 1 : 1 };
        wheeled = 0;
        element.hidden = false;
        draw();
        return;
      }
      /** @type {Readonly<Record<string, () => void>>} */
      const keys = {
        Tab: () => move(event.shiftKey ? -1 : 1),
        ArrowDown: () => move(1),
        ArrowUp: () => move(-1),
        Enter: () => choose(showing?.marked ?? 0),
        Escape: hide,
      };
      const action = keys[event.key];
      if (action === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      action();
    },
    true,
  );
  window.addEventListener(
    'keyup',
    (event) => {
      if (showing !== undefined && event.key === 'Control') choose(showing.marked);
    },
    true,
  );
  // the wheel moves the mark a tab a notch, down or up, as the arrows do — not the page's zoom, Ctrl being held
  window.addEventListener(
    'wheel',
    (event) => {
      if (showing === undefined) return;
      event.preventDefault();
      wheeled += event.deltaY * (event.deltaMode === window.WheelEvent.DOM_DELTA_LINE ? wheelLine : event.deltaMode === window.WheelEvent.DOM_DELTA_PAGE ? wheelPage : 1);
      const steps = Math.trunc(wheeled / wheelNotch);
      if (steps === 0) return;
      wheeled -= steps * wheelNotch;
      move(steps);
    },
    { capture: true, passive: false },
  );
  // the window left — another app, another tab — the switcher goes: Ctrl let go there is not heard here
  window.addEventListener('blur', hide);
  return { element };
}
