// @ts-check
// What goes along with the feed swiped to the tab beside (feed-pager.js), as a pager's tabs do: the open tab's mark in
// the tabs' row glides toward the mark of the tab beside, and the title gives way to the title of the session beside —
// each as far as the feed is drawn. Let go, they slide as the feeds do; the page draws the row and the head anew once
// the tab beside is shown.
import { slideEasing, slideMs } from './feed-pager.js';

/**
 * @typedef {'previous' | 'next'} Direction
 * @typedef {{ left: number, width: number }} Span
 */

/**
 * The element, as the page's own kind of element — of whichever window: the page's, or a test's.
 * @param {Element | null | undefined} element
 * @returns {HTMLElement | undefined}
 */
function htmlOf(element) {
  const view = element?.ownerDocument.defaultView;
  return element !== null && element !== undefined && view !== null && view !== undefined && element instanceof view.HTMLElement ? element : undefined;
}

/** @param {HTMLElement} element @returns {Span} */
const spanOf = (element) => ({ left: element.offsetLeft, width: element.offsetWidth });

/**
 * @param {{ strip: () => HTMLElement | undefined, tabBeside: (direction: Direction) => string | undefined, title: () => HTMLElement | undefined, titleBeside: (direction: Direction) => string | undefined }} parts
 *   strip: the tabs' row of the open tab's workspace; tabBeside: the id of the tab beside the open one, none past the
 *   ends; title: the open session's, in its head; titleBeside: the title of the session beside
 * @returns {import('./feed-pager.js').Along}
 */
export function createSwipeAlong({ strip, tabBeside, title, titleBeside }) {
  /**
   * What goes along this swipe the way it is drawn, measured once — when the swipe turns that way: the row and the
   * open tab's mark gliding from its tab to the one beside, the title and the title beside.
   * @type {{ direction: Direction, row: HTMLElement | undefined, mark: { element: HTMLElement, from: Span, to: Span } | undefined, heading: HTMLElement | undefined, beside: HTMLElement | undefined } | undefined}
   */
  let going;

  /** @param {Direction} direction */
  const start = (direction) => {
    const row = strip();
    const from = htmlOf(row?.querySelector('.herdr-chip.selected'));
    const toId = tabBeside(direction);
    const to = row === undefined || toId === undefined ? undefined : htmlOf([...row.querySelectorAll('.herdr-chip')].find((chip) => chip.getAttribute('data-tab') === toId));
    /** @type {{ element: HTMLElement, from: Span, to: Span } | undefined} */
    let mark;
    if (row !== undefined && from !== undefined && to !== undefined) {
      const element = row.ownerDocument.createElement('span');
      element.className = 'herdr-chip-glide';
      element.style.top = `${from.offsetTop}px`;
      element.style.height = `${from.offsetHeight}px`;
      row.prepend(element);
      row.classList.add('gliding');
      mark = { element, from: spanOf(from), to: spanOf(to) };
    }
    const heading = title();
    const text = titleBeside(direction);
    const head = heading?.parentElement;
    /** @type {HTMLElement | undefined} */
    let beside;
    if (heading !== undefined && head !== null && head !== undefined && text !== undefined) {
      beside = heading.ownerDocument.createElement('span');
      beside.className = 'title-beside';
      beside.textContent = text;
      beside.style.left = `${heading.offsetLeft}px`;
      beside.style.top = `${heading.offsetTop}px`;
      beside.style.width = `${heading.offsetWidth}px`;
      head.append(beside);
    }
    going = { direction, row, mark, heading, beside };
  };
  /**
   * @param {number} share — how far toward the tab beside, of the whole way
   * @param {'follow' | 'slide'} how
   */
  const draw = (share, how) => {
    if (going === undefined) return;
    const { mark, heading, beside } = going;
    const timed = (/** @type {readonly string[]} */ properties) => (how === 'slide' ? properties.map((property) => `${property} ${slideMs}ms ${slideEasing}`).join(', ') : 'none');
    if (mark !== undefined) {
      mark.element.style.transition = timed(['transform', 'width']);
      mark.element.style.transform = `translateX(${mark.from.left + (mark.to.left - mark.from.left) * share}px)`;
      mark.element.style.width = `${mark.from.width + (mark.to.width - mark.from.width) * share}px`;
    }
    if (heading !== undefined) {
      heading.style.transition = timed(['opacity']);
      heading.style.opacity = String(1 - share);
    }
    if (beside !== undefined) {
      // in the title's place, fading in as it fades out: slid in from the side, it would pass under the head's buttons
      beside.style.transition = timed(['opacity']);
      beside.style.opacity = String(share);
    }
  };
  const clear = () => {
    if (going === undefined) return;
    going.mark?.element.remove();
    going.beside?.remove();
    going.row?.classList.remove('gliding');
    if (going.heading !== undefined) {
      going.heading.style.opacity = '';
      going.heading.style.transition = '';
    }
    going = undefined;
  };
  return {
    follow(direction, share) {
      if (going?.direction !== direction) {
        clear();
        start(direction);
      }
      draw(share, 'follow');
    },
    settle(direction) {
      draw(going !== undefined && direction === going.direction ? 1 : 0, 'slide');
    },
    clear,
  };
}
