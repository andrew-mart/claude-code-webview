import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
// the icons are drawn as their module loads: the DOM is set up first
Object.assign(globalThis, { window, document: window.document });
const { createDocDock } = await import('../public/view/doc-dock.js');

// On a phone the documents put away — files, notes — wait under the feed as cards to leaf through, the latest first: a
// card opens its document, its × closes it for good; while the side panel shows one, or none are kept, there is no dock
test('docDock_Should_ShowDocumentsPutAway_AsCardsToOpenOrClose', () => {
  /** @type {import('../public/view/file-panel.js').DocShown[]} */
  let kept = [
    { key: 'file:D:/dev/shop/src/limits.ts', kind: 'file', name: 'limits.ts' },
    { key: 'note:n3', kind: 'note', name: 'Plan for the week' },
  ];
  /** @type {string[][]} */
  const asked = [];
  const dock = createDocDock({
    docs: () => kept,
    open: (key) => void asked.push(['open', key]),
    close: (key) => void asked.push(['close', key]),
    iconOf: (name) => Object.assign(window.document.createElement('span'), { className: 'file-icon', title: name }),
  });
  const cards = () => [...dock.element.querySelectorAll('.doc-card')].map((card) => card.textContent);
  /** @param {string} selector @param {number} at */
  const press = (selector, at) => dock.element.querySelectorAll(selector)[at]?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  dock.show(false);
  const away = { shown: !dock.element.hidden, cards: cards() };
  press('.doc-card-open', 1);
  press('.doc-card-close', 0);
  dock.show(true);
  const panelOpen = dock.element.hidden;
  kept = [];
  dock.show(false);

  assert.deepEqual(
    { away, panelOpen, none: dock.element.hidden, asked },
    {
      away: { shown: true, cards: ['limits.ts', 'Plan for the week'] },
      panelOpen: true,
      none: true,
      asked: [
        ['open', 'note:n3'],
        ['close', 'file:D:/dev/shop/src/limits.ts'],
      ],
    },
  );
});
