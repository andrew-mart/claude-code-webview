// @ts-check
// Items put in another order by dragging one — tabs in a row, notes in a column — by itself or by its grip: with a mouse
// once it moves a few pixels with its button down; with a finger or a pen once it rests on the item a moment — a swipe
// still scrolls. A mark shows where the item goes while it is dragged; let go, it goes there at once and the move is
// told. The click a drag ends with does nothing, and what holds the items scrolls under the pointer near its ends.

/** How far a mouse moves with its button down before the item under it is dragged. */
const mouseSlopPx = 6;
/** How long a finger or a pen rests on an item before it is dragged; moving before that is a scroll. */
const holdMs = 350;
/** How far a finger may wander while it rests. */
const touchSlopPx = 8;
/** How near its ends what holds the items scrolls under the pointer, and by how much each move. */
const edgePx = 28;
const edgeStepPx = 8;
/** A click this soon after a drag ends is the drag's own. */
const dragClickMs = 500;

/**
 * @param {HTMLElement} bar — what holds the items
 * @param {{ items: () => HTMLElement[], idOf: (item: HTMLElement) => string | undefined, axis: 'x' | 'y', grip: string | undefined, scroller: HTMLElement, canStart: () => boolean, onStart: () => void, onDrop: (id: string, place: number) => void, onCancel: () => void }} parts
 *   — items: the items in their order; idOf: an item's id, none for one not dragged; axis: x — the items in a row, y — in
 *   a column; grip: what in an item it is dragged by, none — by the whole of it; scroller: what scrolls near its ends as
 *   an item is dragged; canStart: whether a drag may begin — not while an item is being named or written; onStart: a
 *   drag began; onDrop: the item let go at another place — between the items as they stood, 0 before the first;
 *   onCancel: let go where it was
 */
export function allowDragging(bar, { items, idOf, axis, grip, scroller, canStart, onStart, onDrop, onCancel }) {
  /** The press on an item, until it is let go. */
  /** @type {{ item: HTMLElement, id: string, x: number, y: number, pointerId: number, finger: boolean, dragging: boolean, hold: ReturnType<typeof setTimeout> | undefined } | undefined} */
  let pressed;
  let dragEndedAt = Number.NEGATIVE_INFINITY;

  /** Where the pointer is along the items. @param {PointerEvent} event */
  const along = (event) => (axis === 'x' ? event.clientX : event.clientY);
  /** The place the pointer is at: how many of the items' middles are before it. */
  const placeAt = (/** @type {number} */ at) => items().filter((item) => {
    const box = item.getBoundingClientRect();
    return axis === 'x' ? box.left + box.width / 2 < at : box.top + box.height / 2 < at;
  }).length;
  const unmark = () => {
    for (const item of items()) item.classList.remove('drop-before', 'drop-after');
  };
  /** The mark of where the item goes: before the item there, after the last one. */
  const mark = (/** @type {number} */ at) => {
    unmark();
    const all = items();
    const before = all[placeAt(at)];
    if (before !== undefined) before.classList.add('drop-before');
    else all.at(-1)?.classList.add('drop-after');
  };
  /** What holds the items scrolled, the pointer near its ends. @param {number} at */
  const scrollNear = (at) => {
    const box = scroller.getBoundingClientRect();
    const [start, end] = axis === 'x' ? [box.left, box.right] : [box.top, box.bottom];
    const step = at < start + edgePx ? -edgeStepPx : at > end - edgePx ? edgeStepPx : 0;
    if (axis === 'x') scroller.scrollLeft += step;
    else scroller.scrollTop += step;
  };
  const stop = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancelled);
    if (pressed !== undefined) {
      clearTimeout(pressed.hold);
      pressed.item.classList.remove('dragging');
    }
    bar.classList.remove('dragging-items');
    unmark();
    pressed = undefined;
  };
  const start = () => {
    if (pressed === undefined) return;
    pressed.dragging = true;
    pressed.item.classList.add('dragging');
    bar.classList.add('dragging-items');
    onStart();
  };
  /** @param {PointerEvent} event */
  const onMove = (event) => {
    if (pressed === undefined || event.pointerId !== pressed.pointerId) return;
    if (!pressed.dragging) {
      const moved = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y);
      // a finger moving before it rested is a scroll; a mouse moving is a drag
      if (pressed.finger && moved > touchSlopPx) stop();
      else if (!pressed.finger && moved > mouseSlopPx) start();
      if (pressed === undefined || !pressed.dragging) return;
    }
    scrollNear(along(event));
    mark(along(event));
  };
  /** @param {PointerEvent} event */
  const onUp = (event) => {
    if (pressed === undefined || event.pointerId !== pressed.pointerId) return;
    const { item, id, dragging } = pressed;
    stop();
    if (!dragging) return;
    dragEndedAt = Date.now();
    const all = items();
    const from = all.indexOf(item);
    const place = placeAt(along(event));
    if (place === from || place === from + 1) {
      onCancel();
      return;
    }
    // where it goes, at once: the answer comes after
    const before = all[place];
    if (before !== undefined) before.before(item);
    else all.at(-1)?.after(item);
    onDrop(id, place);
  };
  /** @param {PointerEvent} event */
  const onCancelled = (event) => {
    if (pressed === undefined || event.pointerId !== pressed.pointerId) return;
    const dragging = pressed.dragging;
    stop();
    if (dragging) onCancel();
  };

  bar.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (pressed !== undefined || (event.pointerType === 'mouse' && event.button !== 0) || !(target instanceof window.Element)) return;
    if (grip !== undefined && target.closest(grip) === null) return;
    const item = items().find((one) => one.contains(target));
    const id = item === undefined ? undefined : idOf(item);
    if (item === undefined || id === undefined || !canStart()) return;
    const finger = event.pointerType !== 'mouse';
    // a mouse pressed on a grip picks up no words on its way: the grip is for moving the item only
    if (grip !== undefined && !finger) event.preventDefault();
    pressed = { item, id, x: event.clientX, y: event.clientY, pointerId: event.pointerId, finger, dragging: false, hold: finger ? setTimeout(start, holdMs) : undefined };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancelled);
  });
  // a finger dragging an item does not scroll what is under it
  bar.addEventListener(
    'touchmove',
    (event) => {
      if (pressed?.dragging === true) event.preventDefault();
    },
    { passive: false },
  );
  // an item may be a link: the browser's own dragging of it, and a finger's menu for it, would take the drag over
  bar.addEventListener('dragstart', (event) => event.preventDefault());
  bar.addEventListener('contextmenu', (event) => {
    if (pressed !== undefined) event.preventDefault();
  });
  bar.addEventListener(
    'click',
    (event) => {
      if (Date.now() - dragEndedAt > dragClickMs) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
}
