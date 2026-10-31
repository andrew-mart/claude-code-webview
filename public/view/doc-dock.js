// @ts-check
// On a phone, the documents the side panel showed — files, notes — put away under the feed, over the box, as cards to
// leaf through sideways, the latest first: a card opens its document again, its × closes it for good. None shows while
// the side panel shows one, or none are kept; a wide screen has the side panel beside the feed, and no dock.
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @param {{ docs: () => readonly import('./file-panel.js').DocShown[], open: (key: string) => void, close: (key: string) => void, iconOf: (name: string) => HTMLElement }} parts
 *   — docs: the side panel's, the latest first; open: one shown in the side panel again; close: one closed for good;
 *   iconOf: a file's icon by its name
 * @returns {{ element: HTMLElement, show: (panelOpen: boolean) => void }} — show: drawn for the documents kept now
 */
export function createDocDock({ docs, open, close, iconOf }) {
  const element = h('nav', { className: 'doc-dock', attrs: { hidden: '', 'aria-label': 'Documents put away' } });
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
    show(panelOpen) {
      const kept = docs();
      element.hidden = panelOpen || kept.length === 0;
      element.replaceChildren(...(element.hidden ? [] : kept.map(card)));
    },
  };
}
