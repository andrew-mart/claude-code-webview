// @ts-check
// The commands and phrases sent from the box most (model/phrases.js), in a row over the box that scrolls sideways, the
// most sent first: one pressed goes into the box where its cursor is (composer-view.js). They are the same in every tab:
// the page keeps them, and a tab's row is drawn from there at once. The page's ⋯ menu turns the row on and off, as it
// was last on this device; off, nothing is asked of the viewer.
import { h } from './dom.js';

/** How far a press goes along the row, px, before it drags it rather than pressing a phrase. */
const dragFrom = 4;

/**
 * @param {{ count: import('../model/phrases.js').PhraseCount, put: (text: string) => void, shown: () => boolean, watch: (listener: () => void) => () => void }} source
 *   — count: the page's count of the phrases sent most, the most first, the same for every tab; put: one pressed,
 *   into the box; shown: whether the row is on, as this device keeps it; watch: told when it is turned on or off
 *   elsewhere — the page's menu — till let go of
 * @returns {{ element: HTMLElement, refresh: () => Promise<void>, dispose: () => void }} — element: the row, drawn at
 *   once; refresh: a prompt sent — the viewer asked again, if the row is on, and every tab's row drawn from its answer;
 *   dispose: told nothing more
 */
export function createPhraseBar({ count, put, shown, watch }) {
  const element = h('div', { className: 'phrase-bar', attrs: { hidden: '', role: 'toolbar', 'aria-label': 'Phrases you send most' } });

  // the row scrolls sideways with no bar of its own: by the mouse's wheel, the page staying where it is
  element.addEventListener(
    'wheel',
    (event) => {
      if (event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      element.scrollLeft += event.deltaY;
      event.preventDefault();
    },
    { passive: false },
  );
  // and by a press of the mouse dragged along it — a finger's swipe the browser scrolls by itself; a phrase let go after
  // a drag goes nowhere
  /** @type {{ x: number, left: number, moved: boolean } | undefined} */
  let drag;
  let justDragged = false;
  element.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    drag = { x: event.clientX, left: element.scrollLeft, moved: false };
    justDragged = false;
  });
  element.addEventListener('pointermove', (event) => {
    if (drag === undefined || event.pointerType !== 'mouse') return;
    // the button let go off the row, where the row was not told: no drag goes on
    if ((event.buttons & 1) === 0) {
      drag = undefined;
      return;
    }
    const along = event.clientX - drag.x;
    if (!drag.moved && Math.abs(along) > dragFrom) {
      drag.moved = true;
      // a drag gone off the row goes on, and is let go of there, as the row's
      if (typeof element.setPointerCapture === 'function') element.setPointerCapture(event.pointerId);
    }
    if (drag.moved) element.scrollLeft = drag.left - along;
  });
  const letGo = () => {
    justDragged = drag?.moved === true;
    drag = undefined;
  };
  element.addEventListener('pointerup', letGo);
  element.addEventListener('pointercancel', letGo);

  /** @param {{ text: string, count: number }} phrase */
  const chip = ({ text, count }) => {
    const made = h('button', { className: 'phrase-chip', text, title: `${text} — sent ${count} times: into the box`, attrs: { type: 'button' } });
    made.addEventListener('click', () => {
      if (justDragged) {
        justDragged = false;
        return;
      }
      put(text);
    });
    return made;
  };

  /** The phrases drawn, as text: the same ones are not drawn again — a row scrolled along stays where it is. */
  let drawn = '';
  /** The row as it is to be: off, empty; on, the page's phrases — the viewer asked first while the page has none. */
  const show = () => {
    const on = shown();
    element.hidden = !on;
    const phrases = on ? count.known() : undefined;
    if (on && phrases === undefined) {
      void count.reread();
      return;
    }
    const look = JSON.stringify(phrases ?? null);
    if (look === drawn) return;
    drawn = look;
    if (phrases === undefined) return element.replaceChildren();
    element.replaceChildren(...(phrases.length === 0 ? [h('span', { className: 'phrase-none', text: 'Phrases you send will gather here, the most sent first.' })] : phrases.map(chip)));
  };

  // the page's count told anew — a prompt sent from this tab or another — and the row turned on or off from the page's
  // menu: shown so at once
  const stopCounting = count.watch(show);
  const stopWatching = watch(show);
  show();

  return {
    element,
    refresh: async () => {
      if (shown()) await count.reread();
    },
    dispose: () => {
      stopCounting();
      stopWatching();
    },
  };
}
