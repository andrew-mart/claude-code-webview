import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, { window, document: window.document });
const { createTabSwitcher } = await import('../public/view/tab-switcher.js');

/** @typedef {import('../public/model/recent-tabs.js').SwitcherEntry} SwitcherEntry */

/**
 * A herdr tab to switch to, its workspace and pane made up around its name.
 * @param {import('../public/model/herdr.js').Opened} place @param {string} workspace @param {string} tab
 * @returns {SwitcherEntry}
 */
const entry = (place, workspace, tab) => {
  /** @type {import('../public/model/herdr.js').HerdrPane} */
  const pane = { id: `${tab}:p`, agent: 'claude', status: 'idle', title: undefined, session: place.kind === 'session' ? place.id : undefined, size: undefined, activity: undefined };
  return { place, workspace: { id: workspace, number: 1, label: workspace, status: 'idle', activeTab: tab, tabs: [] }, tab: { id: tab, number: 1, label: tab, status: 'idle', panes: [pane] }, pane };
};

/** @type {readonly SwitcherEntry[]} */
const tabs = [entry({ kind: 'session', id: 's1' }, 'shop-api', 'rate-limit'), entry({ kind: 'pane', id: 'w1:p2' }, 'shop-api', 'tests'), entry({ kind: 'session', id: 's2' }, 'web', 'node-24')];

/** The switcher in a page, over these tabs, the tabs it opens recorded. @param {readonly SwitcherEntry[]} entries */
function switcherOver(entries) {
  /** @type {string[]} */
  const opened = [];
  // each row as the page draws it — the session list's look: here its tab's name in a row of the list's kind
  const switcher = createTabSwitcher({ entries: () => entries, open: (place) => void opened.push(place.id), rowOf: (one) => Object.assign(document.createElement('span'), { className: 'herdr-tab', textContent: one.tab.label }) });
  window.document.body.replaceChildren(switcher.element);
  /** @param {string} key @param {{ ctrlKey?: boolean, shiftKey?: boolean }} [held] */
  const press = (key, held = {}) => {
    const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...held });
    window.document.body.dispatchEvent(event);
    return event.defaultPrevented;
  };
  /** @param {number} deltaY — pixels @returns {boolean} — whether the page's own use of the wheel — Ctrl held, its zoom — was kept from it */
  const wheel = (deltaY) => {
    const event = new window.WheelEvent('wheel', { deltaY, ctrlKey: true, bubbles: true, cancelable: true });
    window.document.body.dispatchEvent(event);
    return event.defaultPrevented;
  };
  /** @param {string} key */
  const letGo = (key) => window.document.body.dispatchEvent(new window.KeyboardEvent('keyup', { key, bubbles: true }));
  const shown = () => (switcher.element.hidden ? 'hidden' : [...switcher.element.querySelectorAll('.tab-switcher-item')].map((item) => `${item.classList.contains('selected') ? '>' : ' '}${item.querySelector(':scope > .herdr-tab')?.textContent}`).join(' '));
  return { switcher, opened, press, wheel, letGo, shown };
}

// Ctrl+Tab shows the tabs in the order they were opened, the one opened before this one marked — the browser keeps none
// of it: Tab with Ctrl held goes on down, round to the first past the last, Shift+Tab back, the arrows too; letting go
// of Ctrl opens the tab marked
test('tabSwitcher_Should_MarkTabOpenedBefore_MoveWithTabAndArrows_AndOpenItOnCtrlLetGo', () => {
  const { opened, press, letGo, shown } = switcherOver(tabs);

  const taken = press('Tab', { ctrlKey: true });
  const first = shown();
  press('Tab', { ctrlKey: true });
  const down = shown();
  press('Tab', { ctrlKey: true });
  const round = shown();
  press('Tab', { ctrlKey: true, shiftKey: true });
  press('ArrowUp', { ctrlKey: true });
  const up = shown();
  press('ArrowDown', { ctrlKey: true });
  letGo('Control');

  assert.deepEqual(
    { taken, first, down, round, up, opened, after: shown() },
    { taken: true, first: ' rate-limit >tests  node-24', down: ' rate-limit  tests >node-24', round: '>rate-limit  tests  node-24', up: ' rate-limit >tests  node-24', opened: ['s2'], after: 'hidden' },
  );
});

// With Ctrl held the wheel would zoom the page: over the switcher it moves the mark instead, a tab a notch, down or up —
// a touchpad's small strokes adding up to a notch; with the switcher gone the wheel is the page's again
test('tabSwitcher_Should_MoveMarkByWheel_NotZoomPage_WhileShown', () => {
  const { press, wheel, letGo, shown } = switcherOver(tabs);
  const before = wheel(100);

  press('Tab', { ctrlKey: true });
  const notch = [wheel(100), shown()];
  wheel(-100);
  const back = shown();
  wheel(40);
  wheel(40);
  const strokes = shown();
  wheel(40);
  const addedUp = shown();
  press('Escape', { ctrlKey: true });
  letGo('Control');

  assert.deepEqual(
    { before, notch, back, strokes, addedUp, after: wheel(100) },
    { before: false, notch: [true, ' rate-limit  tests >node-24'], back: ' rate-limit >tests  node-24', strokes: ' rate-limit >tests  node-24', addedUp: ' rate-limit  tests >node-24', after: false },
  );
});

// Escape leaves the tab open as it was; Enter opens the tab marked, as a click on a tab does; Ctrl+Shift+Tab starts from
// the tab opened longest ago; with one tab or none to switch to Ctrl+Tab shows nothing
test('tabSwitcher_Should_CloseOnEscape_OpenOnEnterOrClick_AndShowNothingWithOneTab', () => {
  const { switcher, opened, press, letGo, shown } = switcherOver(tabs);

  press('Tab', { ctrlKey: true });
  press('Escape', { ctrlKey: true });
  const escaped = shown();
  letGo('Control');
  press('Tab', { ctrlKey: true });
  press('Enter', { ctrlKey: true });
  press('Tab', { ctrlKey: true });
  switcher.element.querySelectorAll('.tab-switcher-item')[2]?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  press('Tab', { ctrlKey: true, shiftKey: true });
  const backward = shown();
  press('Escape', { ctrlKey: true });
  const alone = switcherOver(tabs.slice(0, 1));
  alone.press('Tab', { ctrlKey: true });

  assert.deepEqual({ escaped, opened, backward, alone: alone.shown() }, { escaped: 'hidden', opened: ['w1:p2', 's2'], backward: ' rate-limit  tests >node-24', alone: 'hidden' });
});
