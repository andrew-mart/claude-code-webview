// @ts-check
// The feed of a phone drawn sideways as a pager's (edge-swipe.js: watchFeedSwipe): the feed of the tab beside comes with
// it, side by side — the next tab's from the right when drawn left, the one before's from the left when drawn right —
// both following the finger, a frame at a time. Let go on it, both slide the rest of the way and the page goes there,
// the feed beside already drawn: once it is shown, the pager is cleared. Let go short of it, both slide back. With no
// tab beside, the feed follows a third as far.

/** How long the feeds slide when let go, in ms, and how: what goes along with them slides so too. */
export const slideMs = 220;
export const slideEasing = 'cubic-bezier(0.2, 0.7, 0.3, 1)';
const slide = `transform ${slideMs}ms ${slideEasing}`;

/**
 * @typedef {'previous' | 'next'} Direction
 * @typedef {{ follow: (direction: Direction, share: number) => void, settle: (direction: Direction | undefined) => void, clear: () => void }} Along
 *   What goes along with the feed — the tabs' row, the title: follow, how far toward the tab beside the feed is drawn, a
 *   share of the column's width, told only while there is one; settle, where it is let go to — none: back; clear, the
 *   pager cleared
 */

/**
 * @param {{ column: HTMLElement, shown: () => HTMLElement | undefined, beside: (direction: Direction) => HTMLElement | undefined, go: (direction: Direction) => void, width: () => number, frame: (draw: () => void) => void, later: (ms: number, done: () => void) => void, along: Along }} parts
 *   column: the feed column; shown: the feed shown; beside: the feed of the tab beside, parked in the column — mounted
 *   for it if need be — none past the ends; go: the page to go to the tab beside; width: the column's; frame: a draw
 *   put off to the next frame; later: what happens once the feeds have slid; along: what goes along with the feed
 * @returns {{ follow: (across: number) => void, settle: (direction: Direction | undefined) => void, clear: () => void }}
 *   follow: drawn so far sideways; settle: let go — to the tab beside, or back; clear: the feeds back as they are drawn
 *   without the pager — the feed beside shown, or none gone to
 */
export function createFeedPager({ column, shown, beside, go, width, frame, later, along }) {
  /** The feeds beside, while the feed is drawn: asked for once a swipe. */
  /** @type {Map<Direction, HTMLElement | undefined>} */
  const asked = new Map();
  /** How far it is drawn, to be drawn at the next frame; none while no frame waits. */
  /** @type {number | undefined} */
  let waiting;
  /** The feeds moved: put back as they are drawn without the pager, once cleared. */
  /** @type {Set<HTMLElement>} */
  const moved = new Set();

  /** @param {Direction} direction */
  const feedBeside = (direction) => {
    if (!asked.has(direction)) asked.set(direction, beside(direction));
    return asked.get(direction);
  };
  /**
   * @param {HTMLElement} feed
   * @param {number} at — px from its place
   * @param {'follow' | 'slide'} how
   */
  const place = (feed, at, how) => {
    moved.add(feed);
    feed.style.transition = how === 'slide' ? slide : 'none';
    feed.style.transform = `translateX(${at}px)`;
  };
  /** @param {HTMLElement | undefined} feed */
  const unpeek = (feed) => {
    if (feed === undefined) return;
    feed.classList.remove('peeking');
    feed.style.transform = '';
    feed.style.transition = '';
  };
  /** The column's width, measured once a swipe. */
  /** @type {number | undefined} */
  let wide;
  const span = () => {
    if (wide === undefined) wide = width();
    return wide;
  };
  /** The way drawn last: the feed beside on the other side, drawn that way before, put back when it turns. */
  /** @type {Direction | undefined} */
  let drawnWay;
  /** @param {number} across */
  const draw = (across) => {
    const current = shown();
    if (current === undefined) return;
    const direction = across < 0 ? 'next' : 'previous';
    if (drawnWay !== undefined && drawnWay !== direction) unpeek(asked.get(drawnWay));
    drawnWay = direction;
    const peek = feedBeside(direction);
    column.classList.add('swiping');
    place(current, peek === undefined ? across / 3 : across, 'follow');
    if (peek === undefined) return;
    // brought out once a swipe: the feeds share a cell of one size, nothing to measure
    peek.classList.add('peeking');
    place(peek, (direction === 'next' ? span() : -span()) + across, 'follow');
    along.follow(direction, Math.min(1, Math.abs(across) / span()));
  };
  const clear = () => {
    waiting = undefined;
    drawnWay = undefined;
    wide = undefined;
    column.classList.remove('swiping');
    for (const feed of moved) unpeek(feed);
    moved.clear();
    asked.clear();
    along.clear();
  };
  return {
    follow(across) {
      const asleep = waiting === undefined;
      waiting = across;
      if (!asleep) return;
      frame(() => {
        if (waiting === undefined) return;
        const at = waiting;
        waiting = undefined;
        draw(at);
      });
    },
    settle(direction) {
      waiting = undefined;
      const current = shown();
      const peek = direction === undefined ? undefined : asked.get(direction);
      if (current === undefined) return clear();
      if (direction === undefined || peek === undefined) {
        place(current, 0, 'slide');
        for (const [side, feed] of asked) if (feed !== undefined && feed.classList.contains('peeking')) place(feed, side === 'next' ? span() : -span(), 'slide');
        along.settle(undefined);
        later(slideMs, clear);
        return;
      }
      place(current, direction === 'next' ? -span() : span(), 'slide');
      place(peek, 0, 'slide');
      along.settle(direction);
      later(slideMs, () => go(direction));
    },
    clear,
  };
}
