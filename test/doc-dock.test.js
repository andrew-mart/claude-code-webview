import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
// the icons are drawn as their module loads: the DOM is set up first
Object.assign(globalThis, { window, document: window.document });
const { createDocDock } = await import('../public/view/doc-dock.js');

// The documents put away — files, notes — wait under the feed as cards, the latest first, in any session: a card opens
// its document, its × closes it for good; the one the side panel shows has no card — the others stay, to switch to — and
// with no other kept there is no dock
test('docDock_Should_ShowDocumentsPutAway_ButTheOneShown_AsCardsToOpenOrClose', () => {
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

  dock.show(undefined);
  const away = { shown: !dock.element.hidden, cards: cards() };
  press('.doc-card-open', 1);
  press('.doc-card-close', 0);
  dock.show('note:n3');
  const besideShown = { shown: !dock.element.hidden, cards: cards() };
  kept = [{ key: 'note:n3', kind: 'note', name: 'Plan for the week' }];
  dock.show('note:n3');
  const onlyShown = dock.element.hidden;
  kept = [];
  dock.show(undefined);

  assert.deepEqual(
    { away, besideShown, onlyShown, none: dock.element.hidden, asked },
    {
      away: { shown: true, cards: ['limits.ts', 'Plan for the week'] },
      besideShown: { shown: true, cards: ['limits.ts'] },
      onlyShown: true,
      none: true,
      asked: [
        ['open', 'note:n3'],
        ['close', 'file:D:/dev/shop/src/limits.ts'],
      ],
    },
  );
});

// Cards that do not fit scroll sideways under the mouse wheel — their scrollbar is hidden; cards that fit leave the wheel
// to the feed
test('docDock_Should_ScrollCardsSideways_WithMouseWheel_WhenTheyDoNotFit', () => {
  /** @param {number} scrollWidth */
  const wheelOver = (scrollWidth) => {
    const dock = createDocDock({
      docs: () => [{ key: 'file:D:/dev/shop/src/limits.ts', kind: 'file', name: 'limits.ts' }],
      open: () => undefined,
      close: () => undefined,
      iconOf: () => window.document.createElement('span'),
    });
    dock.show(undefined);
    Object.defineProperty(dock.element, 'scrollWidth', { value: scrollWidth });
    Object.defineProperty(dock.element, 'clientWidth', { value: 300 });
    const wheel = new window.WheelEvent('wheel', { deltaY: 120, cancelable: true });
    dock.element.dispatchEvent(wheel);
    return { scrolled: dock.element.scrollLeft, feedKeepsWheel: !wheel.defaultPrevented };
  };

  assert.deepEqual([wheelOver(800), wheelOver(300)], [
    { scrolled: 120, feedKeepsWheel: false },
    { scrolled: 0, feedKeepsWheel: true },
  ]);
});
