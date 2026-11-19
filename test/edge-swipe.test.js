import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { watchCloseSwipe, watchEdgeSwipe, watchFeedSwipe, watchPullDown } from '../public/view/edge-swipe.js';

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
  // an edge is 40px wide: the feed's own sideways swipe starts past it
  drag(window, [
    [34, 400],
    [60, 404],
    [110, 410],
  ]);

  assert.deepEqual(seen, { fromLeft: 2, fromRight: 1 });
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

/**
 * A finger put down on the element at the first point and drawn through the others, then lifted — each point with when
 * it was there, in ms. What is told of each move: whether it was kept from scrolling the page.
 * @param {import('jsdom').DOMWindow} window
 * @param {Element} on
 * @param {readonly (readonly [number, number, number])[]} path — [x, y, ms]
 * @param {number} liftedAt — ms
 * @returns {boolean[]}
 */
function timedDragOn(window, on, path, liftedAt) {
  /** @param {string} type @param {readonly (readonly [number, number, number])[]} at @param {number} time */
  const fire = (type, at, time) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: at.map(([clientX, clientY]) => ({ clientX, clientY })) });
    Object.defineProperty(event, 'timeStamp', { value: time });
    on.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const [first, ...rest] = path;
  if (first !== undefined) fire('touchstart', [first], first[2]);
  const kept = rest.map((point) => fire('touchmove', [point], point[2]));
  fire('touchend', [], liftedAt);
  return kept;
}

// On a phone showing a session the feed is drawn sideways by a finger put down in its middle, the feed beside coming
// with it, as a pager's: it follows the finger once that goes sideways more than up or down — the page no longer
// scrolled by it — and, let go, settles on the tab beside — drawn left, the next one; drawn right, the one before — when
// drawn two fifths of the screen or flicked that way — a flick held still before the finger is lifted is none; else back
// in its place. A finger put down within an edge's 40px — the drawers' swipes — or off the feed is left alone; one on
// what scrolls sideways in it — a table, a code block, a terminal — is left to that scrolling while it can scroll that
// way, and is the swipe's once it is at its edge
test('feedSwipe_Should_SettleOnTheTabBeside_WhenDrawnFarOrFlicked_FollowingTheFinger', (t) => {
  const { window } = new JSDOM('<!doctype html><html><body><main class="feed"><pre class="wide" style="overflow-x: auto"></pre></main><div class="box"></div></body></html>');
  t.after(() => window.close());
  Object.defineProperty(window, 'innerWidth', { value: 400 });
  const feed = window.document.querySelector('.feed');
  const wide = window.document.querySelector('.wide');
  const box = window.document.querySelector('.box');
  assert.ok(feed !== null && wide !== null && box !== null);
  Object.defineProperty(wide, 'scrollWidth', { value: 900 });
  Object.defineProperty(wide, 'clientWidth', { value: 300 });
  /** @type {{ settled: string[], followed: number[] }} */
  const seen = { settled: [], followed: [] };
  watchFeedSwipe(window, window.document.body, { holds: (target) => target instanceof window.Node && feed.contains(target), follow: (across) => void seen.followed.push(across), settle: (direction) => void seen.settled.push(direction ?? 'back') });

  const keptFromScrolling = timedDragOn(window, feed, [[200, 300, 0], [180, 302, 50], [120, 305, 150], [30, 306, 400]], 400);
  timedDragOn(window, feed, [[150, 300, 0], [175, 301, 16], [215, 302, 40]], 40);
  timedDragOn(window, feed, [[200, 300, 0], [230, 301, 100], [260, 302, 300]], 300);
  timedDragOn(window, feed, [[300, 300, 0], [200, 300, 100], [150, 300, 200], [170, 300, 216]], 216);
  timedDragOn(window, feed, [[150, 300, 0], [175, 301, 16], [215, 302, 40]], 240);
  const scrolled = timedDragOn(window, feed, [[200, 300, 0], [203, 280, 16], [230, 200, 32]], 32);
  timedDragOn(window, box, [[200, 700, 0], [100, 700, 16], [20, 700, 32]], 32);
  timedDragOn(window, feed, [[34, 300, 0], [120, 300, 16], [200, 300, 32]], 32);
  timedDragOn(window, wide, [[200, 300, 0], [120, 300, 16], [40, 300, 32]], 32);
  timedDragOn(window, wide, [[200, 300, 0], [280, 300, 16], [360, 300, 32]], 32);

  assert.deepEqual(
    { ...seen, keptFromScrolling, scrolled },
    { settled: ['next', 'previous', 'back', 'back', 'back', 'previous'], followed: [-20, -80, -170, 25, 65, 30, 60, -100, -150, -130, 25, 65, 80, 160], keptFromScrolling: [true, true, true], scrolled: [false, false] },
  );
});

// A feed still loading draws itself anew under the finger: what the finger came down on leaves the page, the touch's
// moves and lift still going to it — a touch keeps the target it began on — and the swipe goes on all the same
test('feedSwipe_Should_GoOn_When_WhatTheFingerCameDownOnLeavesThePage', (t) => {
  const { window } = new JSDOM('<!doctype html><html><body><main class="feed"><p class="entry">Loading the conversation</p></main></body></html>');
  t.after(() => window.close());
  Object.defineProperty(window, 'innerWidth', { value: 400 });
  const feed = window.document.querySelector('.feed');
  const entry = window.document.querySelector('.entry');
  assert.ok(feed !== null && entry !== null);
  /** @type {{ settled: string[], followed: number[] }} */
  const seen = { settled: [], followed: [] };
  watchFeedSwipe(window, window.document.body, { holds: (target) => target instanceof window.Node && feed.contains(target), follow: (across) => void seen.followed.push(across), settle: (direction) => void seen.settled.push(direction ?? 'back') });
  /** @param {string} type @param {readonly (readonly [number, number])[]} at @param {number} time */
  const fire = (type, at, time) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: at.map(([clientX, clientY]) => ({ clientX, clientY })) });
    Object.defineProperty(event, 'timeStamp', { value: time });
    entry.dispatchEvent(event);
  };

  fire('touchstart', [[200, 300]], 0);
  entry.remove();
  fire('touchmove', [[180, 302]], 50);
  fire('touchmove', [[120, 305]], 150);
  fire('touchmove', [[30, 306]], 400);
  fire('touchend', [], 400);

  assert.deepEqual(seen, { settled: ['next'], followed: [-20, -80, -170] });
});

// Text being selected is no swipe: a drag begun while there is a selection — a finger on its handles — and a finger
// rested a while before it moves — a long press, to select — leave the feed where it is
test('feedSwipe_Should_LeaveTheFeed_When_TextIsSelectedOrTheFingerRestsFirst', (t) => {
  const { window } = new JSDOM('<!doctype html><html><body><main class="feed"><p class="said">Read https://example.org/report first</p></main></body></html>');
  t.after(() => window.close());
  Object.defineProperty(window, 'innerWidth', { value: 400 });
  const feed = window.document.querySelector('.feed');
  const said = window.document.querySelector('.said');
  assert.ok(feed !== null && said !== null && said.firstChild !== null);
  /** @type {number[]} */
  const followed = [];
  watchFeedSwipe(window, window.document.body, { holds: (target) => target instanceof window.Node && feed.contains(target), follow: (across) => void followed.push(across), settle: () => undefined });

  const range = window.document.createRange();
  range.setStart(said.firstChild, 5);
  range.setEnd(said.firstChild, 10);
  window.getSelection()?.addRange(range);
  timedDragOn(window, said, [[200, 300, 0], [150, 300, 16], [80, 300, 32]], 32);
  window.getSelection()?.removeAllRanges();
  const whileSelected = [...followed];
  timedDragOn(window, said, [[200, 300, 0], [198, 301, 600], [150, 300, 616], [80, 300, 632]], 632);

  assert.deepEqual({ whileSelected, afterRest: followed }, { whileSelected: [], afterRest: [] });
});
