// @ts-check
// The swipe from the left edge of a phone's screen, as the page's own: a finger put down at the edge and drawn to the
// right. Where the system takes that swipe for Back — a browser's tab with pages to go back to, Android's gestures —
// the page never hears it.

/** How near the left edge the finger comes down, in CSS pixels. */
const edgeWidth = 24;
/** How far to the right it is drawn: a swipe, not a touch at the edge. */
const swipeLength = 48;
/** How far up or down it may stray before it is taken for scrolling. */
const straying = 10;

/**
 * @param {Document} document
 * @param {() => void} onSwipe — once a swipe, as soon as the finger has gone far enough
 */
export function watchEdgeSwipe(document, onSwipe) {
  /** @type {{ x: number, y: number } | undefined} — where the finger came down at the edge; none once it is told or scrolls */
  let start;
  document.addEventListener(
    'touchstart',
    (event) => {
      const touch = event.touches[0];
      start = touch !== undefined && touch.clientX <= edgeWidth ? { x: touch.clientX, y: touch.clientY } : undefined;
    },
    { passive: true },
  );
  document.addEventListener(
    'touchmove',
    (event) => {
      const touch = event.touches[0];
      if (start === undefined || touch === undefined) return;
      const across = touch.clientX - start.x;
      const along = Math.abs(touch.clientY - start.y);
      if (along > straying && along > across) start = undefined;
      else if (across >= swipeLength) {
        start = undefined;
        onSwipe();
      }
    },
    { passive: true },
  );
}
