// @ts-check
// The documents the side panel showed — files, notes — put away under the feed, over the box, as cards, the latest
// first, in whichever session is open: a card opens its document again, its × closes it for good. The one the side
// panel shows has no card, the others stay to switch to; with none other kept there is no dock. Cards that do not fit are
// leafed through sideways — by the mouse wheel too; on a phone by a finger.
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @param {{ docs: () => readonly import('./file-panel.js').DocShown[], open: (key: string) => void, close: (key: string) => void, iconOf: (name: string) => HTMLElement }} parts
 *   — docs: the side panel's, the latest first; open: one shown in the side panel again; close: one closed for good;
 *   iconOf: a file's icon by its name
 * @returns {{ element: HTMLElement, show: (shown: string | undefined) => void }} — show: drawn for the documents kept now,
 *   but the one the side panel shows — none while it shows none
 */
export function createDocDock({ docs, open, close, iconOf }) {
  const element = h('nav', { className: 'doc-dock', attrs: { hidden: '', 'aria-label': 'Documents put away' } });
  // cards that do not fit scroll sideways under the mouse wheel, their scrollbar hidden; cards that fit leave the wheel to
  // the feed
  element.addEventListener(
    'wheel',
    (event) => {
      if (element.scrollWidth <= element.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      event.preventDefault();
      element.scrollLeft += event.deltaY;
    },
    { passive: false },
  );
  /** @param {import('./file-panel.js').DocShown} doc */
  const card = (doc) => {
    const opening = h('button', { className: 'doc-card-open', title: `Open ${doc.name}`, attrs: { type: 'button' } }, [doc.kind === 'note' ? icon('note') : iconOf(doc.name), h('span', { text: doc.name })]);
    const closing = h('button', { className: 'icon-button doc-card-close', title: 'Close it', attrs: { type: 'button', 'aria-label': `Close ${doc.name}` } }, [icon('cross')]);
    opening.addEventListener('click', () => open(doc.key));
    closing.addEventListener('click', () => close(doc.key));
    return h('div', { className: `doc-card ${doc.kind}` }, [opening, closing]);
  };
  return {
    element,
    show(shown) {
      const kept = docs().filter((doc) => doc.key !== shown);
      element.hidden = kept.length === 0;
      element.replaceChildren(...(element.hidden ? [] : kept.map(card)));
    },
  };
}
