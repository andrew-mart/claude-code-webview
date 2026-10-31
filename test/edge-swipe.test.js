import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { watchCloseSwipe, watchEdgeSwipe, watchPullDown } from '../public/view/edge-swipe.js';

/**
 * A phone's page, 400 CSS pixels wide, that counts the swipes from either edge.
 * @param {import('node:test').TestContext} t
 */
function phonePage(t) {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>');
  t.after(() => window.close());
  Object.defineProperty(window, 'innerWidth', { value: 400 });
  const seen = { fromLeft: 0, fromRight: 0 };
  watchEdgeSwipe(window, { fromLeft: () => seen.fromLeft++, fromRight: () => seen.fromRight++ });
  return { window, seen };
}

/**
 * A finger put down at the first point and drawn through the others, then lifted.
 * @param {import('jsdom').DOMWindow} window
 * @param {readonly (readonly [number, number])[]} path — [x, y] in CSS pixels
 */
function drag(window, path) {
  /**
   * @param {string} type
   * @param {readonly (readonly [number, number])[]} at
   */
  const fire = (type, at) => {
    const event = new window.Event(type, { bubbles: true });
    Object.defineProperty(event, 'touches', { value: at.map(([clientX, clientY]) => ({ clientX, clientY })) });
    window.document.body.dispatchEvent(event);
  };
  const [first, ...rest] = path;
  if (first !== undefined) fire('touchstart', [first]);
  for (const point of rest) fire('touchmove', [point]);
  fire('touchend', []);
}

// A finger drawn to the right from the screen's left edge is a swipe that opens the session list; drawn to the left
// from its right edge, one that opens the outline — the notes, the files pinned, the bookmarks, the prompts
test('edgeSwipe_Should_TellSwipeFromEachEdge_WhenFingerDrawnInward', (t) => {
  const { window, seen } = phonePage(t);

  drag(window, [
    [6, 400],
    [30, 404],
    [90, 410],
  ]);
  drag(window, [
    [394, 300],
    [370, 302],
    [310, 306],
  ]);

  assert.deepEqual(seen, { fromLeft: 1, fromRight: 1 });
});

// The feed scrolled by a finger put down at an edge, a finger drawn in the middle of the screen, or one drawn outward
// from an edge is no swipe
test('edgeSwipe_Should_NotBeTold_When_FingerScrollsStartsAwayFromEdgeOrGoesOutward', (t) => {
  const { window, seen } = phonePage(t);

  drag(window, [
    [6, 400],
    [12, 470],
    [70, 560],
  ]);
  drag(window, [
    [120, 400],
    [220, 404],
  ]);
  drag(window, [
    [394, 300],
    [392, 380],
    [340, 460],
  ]);
  drag(window, [
    [380, 300],
    [399, 302],
  ]);

  assert.deepEqual(seen, { fromLeft: 0, fromRight: 0 });
});

/**
 * A phone's page with a drawer slid in from the side asked — or none — that counts the swipes closing it.
 * @param {import('node:test').TestContext} t
 * @param {'left' | 'right' | undefined} side — the edge the drawer came from
 */
function drawerOpen(t, side) {
  const { window } = new JSDOM('<!doctype html><html><body><div class="wide" style="overflow-x: auto"></div></body></html>');
  t.after(() => window.close());
  Object.defineProperty(window, 'innerWidth', { value: 400 });
  const seen = { closed: 0 };
  watchCloseSwipe(window, { side: () => side, close: () => seen.closed++ });
  return { window, seen };
}

/**
 * A finger put down on the element at the first point and drawn through the others, then lifted.
 * @param {import('jsdom').DOMWindow} window
 * @param {Element} on
 * @param {readonly (readonly [number, number])[]} path — [x, y] in CSS pixels
 */
function dragOn(window, on, path) {
  /** @param {string} type @param {readonly (readonly [number, number])[]} at */
  const fire = (type, at) => {
    const event = new window.Event(type, { bubbles: true });
    Object.defineProperty(event, 'touches', { value: at.map(([clientX, clientY]) => ({ clientX, clientY })) });
    on.dispatchEvent(event);
  };
  const [first, ...rest] = path;
  if (first !== undefined) fire('touchstart', [first]);
  for (const point of rest) fire('touchmove', [point]);
  fire('touchend', []);
}

// A drawer slid in is closed by a finger drawn back toward the edge it came from — the outline to the right, the session
// list to the left — wherever on the screen the finger comes down
test('closeSwipe_Should_CloseDrawer_WhenFingerDrawnTowardItsEdge', (t) => {
  const outline = drawerOpen(t, 'right');
  const sessions = drawerOpen(t, 'left');

  dragOn(outline.window, outline.window.document.body, [
    [200, 300],
    [230, 302],
    [280, 306],
  ]);
  dragOn(sessions.window, sessions.window.document.body, [
    [200, 300],
    [170, 302],
    [120, 306],
  ]);

  assert.deepEqual([outline.seen.closed, sessions.seen.closed], [1, 1]);
});

// No drawer is closed by a finger drawn away from its edge, by the drawer scrolled up or down, by one drawn across what
// scrolls sideways in it — a table, a code block — nor when no drawer is open
test('closeSwipe_Should_NotClose_WhenDrawnAwayScrolledAcrossSideScrollerOrNoneOpen', (t) => {
  const outline = drawerOpen(t, 'right');
  const wide = outline.window.document.querySelector('.wide');
  assert.ok(wide !== null);
  Object.defineProperty(wide, 'scrollWidth', { value: 900 });
  Object.defineProperty(wide, 'clientWidth', { value: 300 });
  const none = drawerOpen(t, undefined);

  dragOn(outline.window, outline.window.document.body, [
    [200, 300],
    [150, 302],
  ]);
  dragOn(outline.window, outline.window.document.body, [
    [200, 300],
    [205, 380],
    [260, 460],
  ]);
  dragOn(outline.window, wide, [
    [200, 300],
    [280, 302],
  ]);
  dragOn(none.window, none.window.document.body, [
    [200, 300],
    [280, 302],
  ]);

  assert.deepEqual([outline.seen.closed, none.seen.closed], [0, 0]);
});

// The side panel on a phone, a sheet over the session, pulled down by its top — its grip, its head — is put away once
// drawn far enough down; it follows the finger meanwhile, and goes back up when let go short of it; drawn sideways — the
// head's buttons scrolled — it stays where it is
test('pullDown_Should_PutSheetAway_WhenDrawnFarEnoughDown_FollowingTheFinger', (t) => {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>');
  t.after(() => window.close());
  const top = window.document.createElement('div');
  window.document.body.append(top);
  /** @type {{ pulled: number, followed: number[] }} */
  const seen = { pulled: 0, followed: [] };
  watchPullDown(top, { follow: (down) => void seen.followed.push(down), pulled: () => void seen.pulled++ });

  dragOn(window, top, [
    [200, 50],
    [202, 90],
    [204, 160],
  ]);
  dragOn(window, top, [
    [200, 50],
    [201, 80],
  ]);
  dragOn(window, top, [
    [200, 50],
    [260, 55],
    [320, 60],
  ]);

  assert.deepEqual(seen, { pulled: 1, followed: [40, 110, 0, 30, 0] });
});
