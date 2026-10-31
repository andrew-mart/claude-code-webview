// @ts-check
// The swipes from the edges of a phone's screen, as the page's own: a finger put down at an edge and drawn inward — from
// the left edge to the right, from the right edge to the left. Where the system takes that swipe for Back or Forward —
// a browser's tab with pages to go back or on to, Android's gestures — the page never hears it.

/** How near the edge the finger comes down, in CSS pixels. */
const edgeWidth = 24;
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
