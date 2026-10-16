// @ts-check
// Tabs put in another order by dragging one: with a mouse once it moves a few pixels with its button down; with a finger
// or a pen once it rests on the tab a moment — a swipe still scrolls the tabs. A mark shows where the tab goes while it is
// dragged; let go, it goes there at once and the move is told. The click a drag ends with does nothing, and a bar too
// narrow for its tabs scrolls under the pointer near its ends.

/** How far a mouse moves with its button down before the tab under it is dragged. */
const mouseSlopPx = 6;
/** How long a finger or a pen rests on a tab before it is dragged; moving before that is a scroll. */
const holdMs = 350;
/** How far a finger may wander while it rests. */
const touchSlopPx = 8;
/** How near its ends the bar scrolls under the pointer, and by how much each move. */
const edgePx = 28;
const edgeStepPx = 8;
/** A click this soon after a drag ends is the drag's own. */
const dragClickMs = 500;

/**
 * @param {HTMLElement} bar — the row of tabs
 * @param {{ tabs: () => HTMLElement[], idOf: (tab: HTMLElement) => string | undefined, canStart: () => boolean, onStart: () => void, onDrop: (id: string, place: number) => void, onCancel: () => void }} parts
 *   — tabs: the tabs in their order; idOf: a tab's id, none for one not dragged; canStart: whether a drag may begin —
 *   not while a tab is being named; onStart: a drag began; onDrop: the tab let go at another place — between the tabs as
 *   they stood, 0 before the first; onCancel: let go where it was
 */
export function allowDragging(bar, { tabs, idOf, canStart, onStart, onDrop, onCancel }) {
  /** The press on a tab, until it is let go. */
  /** @type {{ tab: HTMLElement, id: string, x: number, y: number, pointerId: number, finger: boolean, dragging: boolean, hold: ReturnType<typeof setTimeout> | undefined } | undefined} */
  let pressed;
  let dragEndedAt = Number.NEGATIVE_INFINITY;

  /** The place the pointer is at: how many of the tabs' middles are left of it. */
  const placeAt = (/** @type {number} */ x) => tabs().filter((tab) => {
    const box = tab.getBoundingClientRect();
    return box.left + box.width / 2 < x;
  }).length;
  const unmark = () => {
    for (const tab of tabs()) tab.classList.remove('drop-before', 'drop-after');
  };
  /** The mark of where the tab goes: before the tab there, after the last one. */
  const mark = (/** @type {number} */ x) => {
    unmark();
    const all = tabs();
    const place = placeAt(x);
    const before = all[place];
    if (before !== undefined) before.classList.add('drop-before');
    else all.at(-1)?.classList.add('drop-after');
  };
  const stop = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancelled);
    if (pressed !== undefined) {
      clearTimeout(pressed.hold);
      pressed.tab.classList.remove('dragging');
    }
    bar.classList.remove('dragging-tabs');
    unmark();
    pressed = undefined;
  };
  const start = () => {
    if (pressed === undefined) return;
    pressed.dragging = true;
    pressed.tab.classList.add('dragging');
    bar.classList.add('dragging-tabs');
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
    const box = bar.getBoundingClientRect();
    if (event.clientX < box.left + edgePx) bar.scrollLeft -= edgeStepPx;
    else if (event.clientX > box.right - edgePx) bar.scrollLeft += edgeStepPx;
    mark(event.clientX);
  };
  /** @param {PointerEvent} event */
  const onUp = (event) => {
    if (pressed === undefined || event.pointerId !== pressed.pointerId) return;
    const { tab, id, dragging } = pressed;
    stop();
    if (!dragging) return;
    dragEndedAt = Date.now();
    const all = tabs();
    const from = all.indexOf(tab);
    const place = placeAt(event.clientX);
    if (place === from || place === from + 1) {
      onCancel();
      return;
    }
    // where it goes, at once: herdr's answer comes after
    const before = all[place];
    if (before !== undefined) before.before(tab);
    else all.at(-1)?.after(tab);
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
    if (pressed !== undefined || (event.pointerType === 'mouse' && event.button !== 0) || !(event.target instanceof window.Element)) return;
    const tab = event.target.closest('.herdr-chip');
    const id = tab instanceof window.HTMLElement && bar.contains(tab) ? idOf(tab) : undefined;
    if (tab === null || !(tab instanceof window.HTMLElement) || id === undefined || !canStart()) return;
    const finger = event.pointerType !== 'mouse';
    pressed = { tab, id, x: event.clientX, y: event.clientY, pointerId: event.pointerId, finger, dragging: false, hold: finger ? setTimeout(start, holdMs) : undefined };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancelled);
  });
  // a finger dragging a tab does not scroll the tabs under it
  bar.addEventListener(
    'touchmove',
    (event) => {
      if (pressed?.dragging === true) event.preventDefault();
    },
    { passive: false },
  );
  // a tab is a link: the browser's own dragging of it, and a finger's menu for it, would take the drag over
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
