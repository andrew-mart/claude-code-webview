// @ts-check
// The swipes from the edges of a phone's screen, as the page's own: a finger put down at an edge and drawn inward — from
// the left edge to the right, from the right edge to the left. Where the system takes that swipe for Back or Forward —
// a browser's tab with pages to go back or on to, Android's gestures — the page never hears it.

/** How near the edge the finger comes down, in CSS pixels: the drawers' — the feed's own sideways swipe starts past it. */
const edgeWidth = 40;
/** How far inward it is drawn: a swipe, not a touch at the edge. */
const swipeLength = 48;
/** How far up or down it may stray before it is taken for scrolling. */
const straying = 10;

/**
 * @param {Pick<Window, 'document' | 'innerWidth'>} view — the page's window: its document, its width
 * @param {{ fromLeft: () => void, fromRight: () => void }} onSwipe — once a swipe, as soon as the finger has gone far
 *   enough: from the left edge, from the right one
 */
export function watchEdgeSwipe(view, { fromLeft, fromRight }) {
  const document = view.document;
  /** @type {{ x: number, y: number, edge: 'left' | 'right' } | undefined} — where the finger came down at an edge; none once it is told or scrolls */
  let start;
  document.addEventListener(
    'touchstart',
    (event) => {
      const touch = event.touches[0];
      const edge = touch === undefined ? undefined : touch.clientX <= edgeWidth ? 'left' : touch.clientX >= view.innerWidth - edgeWidth ? 'right' : undefined;
      start = touch === undefined || edge === undefined ? undefined : { x: touch.clientX, y: touch.clientY, edge };
    },
    { passive: true },
  );
  document.addEventListener(
    'touchmove',
    (event) => {
      const touch = event.touches[0];
      if (start === undefined || touch === undefined) return;
      const across = start.edge === 'left' ? touch.clientX - start.x : start.x - touch.clientX;
      const along = Math.abs(touch.clientY - start.y);
      if (along > straying && along > across) start = undefined;
      else if (across >= swipeLength) {
        const edge = start.edge;
        start = undefined;
        if (edge === 'left') fromLeft();
        else fromRight();
      }
    },
    { passive: true },
  );
}

/**
 * The swipe that closes a drawer slid in from a side: a finger drawn back toward that edge, put down anywhere — on the
 * drawer or on the shade beside it. A finger put down on what scrolls sideways in it — a table, a code block — is left to
 * that scrolling.
 * @param {Pick<Window, 'document' | 'getComputedStyle'>} view — the page's window: its document, its styles
 * @param {{ side: () => 'left' | 'right' | undefined, close: () => void }} drawer — side: the edge the drawer open came
 *   from, none while none is open; close: it closed
 */
export function watchCloseSwipe(view, { side, close }) {
  const document = view.document;
  /** @type {{ x: number, y: number, toward: 'left' | 'right' } | undefined} — where the finger came down; none once it is told or scrolls */
  let start;
  document.addEventListener(
    'touchstart',
    (event) => {
      const touch = event.touches[0];
      const toward = side();
      start = touch === undefined || toward === undefined || scrollsSideways(view, event.target) ? undefined : { x: touch.clientX, y: touch.clientY, toward };
    },
    { passive: true },
  );
  document.addEventListener(
    'touchmove',
    (event) => {
      const touch = event.touches[0];
      if (start === undefined || touch === undefined) return;
      const across = start.toward === 'right' ? touch.clientX - start.x : start.x - touch.clientX;
      const along = Math.abs(touch.clientY - start.y);
      if (along > straying && along > across) start = undefined;
      else if (across >= swipeLength) {
        start = undefined;
        close();
      }
    },
    { passive: true },
  );
}

/**
 * What the finger came down on, and what it is in, that scrolls sideways: its content wider than it, its overflow left
 * to scrolling.
 * @param {Pick<Window, 'getComputedStyle'>} view
 * @param {EventTarget | null} target
 * @returns {Element[]}
 */
function sidewaysScrollers(view, target) {
  /** @type {Element[]} */
  const found = [];
  for (let node = isElement(target) ? target : null; node !== null; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth && /auto|scroll/.test(view.getComputedStyle(node).overflowX)) found.push(node);
  }
  return found;
}

/**
 * Whether what scrolls sideways can still scroll the way the finger is drawn: drawn left, its content goes on to the
 * right; drawn right, back to the left.
 * @param {Element} scroller
 * @param {number} across — how far the finger is drawn, left below 0
 */
function scrollsToward(scroller, across) {
  return across < 0 ? scroller.scrollLeft < scroller.scrollWidth - scroller.clientWidth - 1 : scroller.scrollLeft > 0;
}

/**
 * Whether what the finger came down on — or something it is in — scrolls sideways: its content wider than it, its
 * overflow left to scrolling.
 * @param {Pick<Window, 'getComputedStyle'>} view
 * @param {EventTarget | null} target
 * @returns {boolean}
 */
function scrollsSideways(view, target) {
  for (let node = isElement(target) ? target : null; node !== null; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth && /auto|scroll/.test(view.getComputedStyle(node).overflowX)) return true;
  }
  return false;
}

/**
 * What a touch began on, as an element touch events go to — HTML's or SVG's — of whichever window: the page's, or a
 * test's. None for anything else.
 * @param {EventTarget | null} target
 * @returns {GlobalEventHandlers | undefined}
 */
function touchedElement(target) {
  const view = isElement(target) ? target.ownerDocument.defaultView : null;
  return view !== null && (target instanceof view.HTMLElement || target instanceof view.SVGElement) ? target : undefined;
}

/**
 * Whether the event's target is an element — of whichever window: the page's, or a test's.
 * @param {EventTarget | null} target
 * @returns {target is Element}
 */
function isElement(target) {
  return target !== null && 'nodeType' in target && target.nodeType === 1;
}

/** How far down a sheet is pulled to be put away, in CSS pixels. */
const pullLength = 80;

/**
 * A sheet over the page — the side panel on a phone — pulled down by its top: it follows the finger, is put away once
 * drawn far enough down, and goes back up when let go short of it; drawn sideways — what scrolls there — it stays.
 * @param {HTMLElement} top — the sheet's top: its grip, its head
 * @param {{ follow: (down: number) => void, pulled: () => void }} sheet — follow: how far down it is drawn now, 0 back
 *   in its place; pulled: it is to be put away
 */
export function watchPullDown(top, { follow, pulled }) {
  /** @type {{ x: number, y: number } | undefined} — where the finger came down; none once drawn sideways */
  let start;
  let down = 0;
  top.addEventListener(
    'touchstart',
    (event) => {
      const touch = event.touches[0];
      start = touch === undefined ? undefined : { x: touch.clientX, y: touch.clientY };
      down = 0;
    },
    { passive: true },
  );
  top.addEventListener(
    'touchmove',
    (event) => {
      const touch = event.touches[0];
      if (start === undefined || touch === undefined) return;
      const across = Math.abs(touch.clientX - start.x);
      const along = touch.clientY - start.y;
      if (down === 0 && across > straying && across > along) {
        start = undefined;
        return;
      }
      down = Math.max(0, along);
      follow(down);
    },
    { passive: true },
  );
  const letGo = () => {
    if (start === undefined) return;
    start = undefined;
    if (down >= pullLength) pulled();
    if (down > 0) follow(0);
    down = 0;
  };
  top.addEventListener('touchend', letGo, { passive: true });
  top.addEventListener('touchcancel', letGo, { passive: true });
}

/** How far sideways a finger on the feed goes before the feed follows it — not a scroll that wavered. */
const feedTakesAt = 16;
/** How much of the screen's width the feed is drawn to settle on the tab beside, let go slowly. */
const feedSettlesAt = 0.4;
/** How fast a flick goes, in px a ms, to settle on the tab beside however short it was drawn. */
const flickSpeed = 0.45;
/** How long the finger may rest before it is lifted for a flick to still be one, in ms. */
const flickRestMs = 100;

/**
 * The feed drawn sideways by a finger put down in its middle, as a pager's, to go to the tab beside: it follows the
 * finger once that goes sideways more than up or down — from then on the moves no longer scroll the page — and, let go,
 * settles on the tab beside — drawn left, the next one; drawn right, the one before — when drawn far enough or flicked
 * that way; else back in its place. A finger put down within an edge is left to the drawers' swipes; one on what scrolls
 * sideways — a table, a code block, a terminal — to that scrolling while it can scroll the way the finger goes, and to
 * the swipe once it is at its edge.
 * @param {Pick<Window, 'innerWidth' | 'getComputedStyle'>} view — the page's window: its width, its styles
 * @param {HTMLElement} area — what holds the feed: the moves over it are listened to
 * @param {{ holds: (target: EventTarget | null) => boolean, follow: (across: number) => void, settle: (direction: 'previous' | 'next' | undefined) => void }} feed
 *   holds: whether the finger came down on the feed, while the swipe is the page's — a phone showing a session, nothing
 *   over it; follow: how far it is drawn sideways now; settle: let go, where it goes — the tab before, the next one, or
 *   none: back in its place
 */
export function watchFeedSwipe(view, area, { holds, follow, settle }) {
  /**
   * Where the finger came down, how far it went sideways and how fast lately, and what under it scrolls sideways; none
   * once it scrolls.
   * @type {{ x: number, y: number, across: number, at: number, speed: number, taken: boolean, scrollers: readonly Element[] } | undefined}
   */
  let start;
  /** What the touch began on, its moves and lift listened to there; none between touches. */
  /** @type {GlobalEventHandlers | undefined} */
  let began;
  // not passive: once the feed follows the finger, the page is not to scroll under it
  const move = (/** @type {TouchEvent} */ event) => {
    const touch = event.touches[0];
    if (start === undefined || touch === undefined) return;
    const across = touch.clientX - start.x;
    const along = Math.abs(touch.clientY - start.y);
    if (!start.taken && along > straying && along >= Math.abs(across)) {
      start = undefined;
      return;
    }
    if (!start.taken && Math.abs(across) < feedTakesAt) return;
    // drawn sideways over what scrolls sideways and can still scroll that way: its scrolling, not the swipe
    if (!start.taken && start.scrollers.some((scroller) => scrollsToward(scroller, across))) {
      forget();
      start = undefined;
      return;
    }
    event.preventDefault();
    const took = event.timeStamp - start.at;
    start = { ...start, across, at: event.timeStamp, speed: took > 0 ? (across - start.across) / took : start.speed, taken: true };
    follow(across);
  };
  const letGo = (/** @type {TouchEvent} */ event) => {
    forget();
    const went = start;
    start = undefined;
    if (went === undefined || !went.taken) return;
    const far = Math.abs(went.across) >= view.innerWidth * feedSettlesAt;
    // lifted while it still moves: a finger that rested first was not flicked
    const flicked = event.timeStamp - went.at <= flickRestMs && Math.abs(went.speed) >= flickSpeed && Math.sign(went.speed) === Math.sign(went.across);
    settle(far || flicked ? (went.across < 0 ? 'next' : 'previous') : undefined);
  };
  const forget = () => {
    began?.removeEventListener('touchmove', move);
    began?.removeEventListener('touchend', letGo);
    began?.removeEventListener('touchcancel', letGo);
    began = undefined;
  };
  area.addEventListener(
    'touchstart',
    (event) => {
      forget();
      const touch = event.touches[0];
      const away = touch !== undefined && touch.clientX > edgeWidth && touch.clientX < view.innerWidth - edgeWidth;
      start = touch === undefined || !away || !holds(event.target) ? undefined : { x: touch.clientX, y: touch.clientY, across: 0, at: event.timeStamp, speed: 0, taken: false, scrollers: sidewaysScrollers(view, event.target) };
      const target = touchedElement(event.target);
      if (start === undefined || target === undefined) return;
      // a touch's moves and lift go to what it began on, on the page or no longer: a feed still loading draws itself
      // anew under the finger, and what has left the page tells nothing to what held it
      began = target;
      began.addEventListener('touchmove', move, { passive: false });
      began.addEventListener('touchend', letGo, { passive: true });
      began.addEventListener('touchcancel', letGo, { passive: true });
    },
    { passive: true },
  );
}
