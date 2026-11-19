import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
// The icons are drawn when their module loads: the DOM is set up before it.
Object.assign(globalThis, { window, document: window.document });
const { createPhraseBar } = await import('../public/view/phrase-bar.js');
const { createPhraseCount } = await import('../public/model/phrases.js');

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The phrases the viewer tells first. */
const sentMost = [
  { text: 'давай', count: 12 },
  { text: '/clear', count: 7 },
  { text: 'проверь', count: 3 },
];

/**
 * The page's count of the phrases, as the viewer tells it — each answer in turn, the last one again and again — its
 * readings counted.
 * @param {readonly (readonly { text: string, count: number }[])[]} answers
 */
function countOf(answers = [sentMost]) {
  let reads = 0;
  const count = createPhraseCount(async () => answers[Math.min(reads++, answers.length - 1)] ?? []);
  return { count, reads: () => reads };
}

/**
 * A bar over a tab's box: the phrases of the page's count, what was put into the box, whether it is to show — kept as
 * a device keeps it.
 * @param {boolean} on — whether it showed last
 * @param {ReturnType<typeof countOf>} page — the page's count, every tab's box drawing from it
 */
function barOf(on, page = countOf()) {
  /** @type {string[]} */
  const put = [];
  let shown = on;
  /** Told when the row is turned on or off elsewhere — the page's menu. @type {Set<() => void>} */
  const told = new Set();
  const bar = createPhraseBar({
    count: page.count,
    put: (text) => put.push(text),
    shown: () => shown,
    watch: (listener) => {
      told.add(listener);
      return () => told.delete(listener);
    },
  });
  /** The row turned on or off elsewhere. @param {boolean} next */
  const turnElsewhere = (next) => {
    shown = next;
    for (const listener of told) listener();
  };
  return { bar, put, loads: page.reads, turnElsewhere, listening: () => told.size };
}

/** @param {HTMLElement} element */
const chips = (element) => (element.hidden ? [] : [...element.querySelectorAll('button')].map((chip) => chip.textContent));

// The row scrolls sideways with no bar of its own: by the mouse's wheel — the page staying where it is — and by a press
// of the mouse dragged along it; a phrase let go after a drag goes nowhere, one pressed without one goes into the box.
// A finger's swipe the browser scrolls by itself
test('phraseBar_Should_ScrollSidewaysByWheelAndByDrag_PuttingNothingAfterADrag', async () => {
  const { bar, put } = barOf(true);
  await bar.refresh();
  const [first] = bar.element.querySelectorAll('button');
  if (first === undefined) assert.fail('no phrase');
  const wheel = new window.WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
  first.dispatchEvent(wheel);
  const wheeled = { left: bar.element.scrollLeft, pageKept: wheel.defaultPrevented };
  /** @param {string} type @param {number} x @param {string} [pointer] */
  const pointer = (type, x, pointer = 'mouse') => first.dispatchEvent(new window.PointerEvent(type, { pointerType: pointer, clientX: x, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true }));
  pointer('pointerdown', 300);
  pointer('pointermove', 250);
  pointer('pointermove', 200);
  pointer('pointerup', 200);
  first.click();
  const dragged = { left: bar.element.scrollLeft, put: [...put] };
  pointer('pointerdown', 300, 'touch');
  pointer('pointermove', 100, 'touch');
  pointer('pointerup', 100, 'touch');
  first.click();

  assert.deepEqual({ wheeled, dragged, swiped: { left: bar.element.scrollLeft, put } }, {
    wheeled: { left: 120, pageKept: true },
    dragged: { left: 220, put: [] },
    swiped: { left: 220, put: ['давай'] },
  });
});

// A press of the mouse on the row let go off it — the row dragged up over the feed — drags nothing after: the mouse
// moved over the row with no button held, the row stays where the wheel put it
test('phraseBar_Should_DragNothing_When_TheMouseMovesWithNoButtonHeld', async () => {
  const { bar } = barOf(true);
  await bar.refresh();
  const [first] = bar.element.querySelectorAll('button');
  if (first === undefined) assert.fail('no phrase');
  first.dispatchEvent(new window.PointerEvent('pointerdown', { pointerType: 'mouse', clientX: 300, button: 0, buttons: 1, bubbles: true }));
  first.dispatchEvent(new window.WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
  first.dispatchEvent(new window.PointerEvent('pointermove', { pointerType: 'mouse', clientX: 100, button: -1, buttons: 0, bubbles: true }));

  assert.equal(bar.element.scrollLeft, 120);
});

// The row turned on or off from the page's menu — the only place it is turned — shows so at once; let go of, the row
// is told nothing more
test('phraseBar_Should_FollowTheRowTurnedOnAndOffFromTheMenu_TillLetGoOf', async () => {
  const { bar, turnElsewhere, listening } = barOf(false);
  await bar.refresh();

  turnElsewhere(true);
  await settled();
  const on = chips(bar.element);
  turnElsewhere(false);
  const off = chips(bar.element);
  bar.dispose();

  assert.deepEqual({ on, off, listening: listening() }, { on: ['давай', '/clear', 'проверь'], off: [], listening: 0 });
});

// The phrases are the same in every tab: a tab's box opened draws them at once, as the page has them, the viewer asked
// nothing
test('phraseBar_Should_DrawThePagesPhrasesAtOnce_AskingTheViewerNothing_When_AnotherTabsBoxOpens', async () => {
  const page = countOf();
  barOf(true, page);
  await settled();

  const next = barOf(true, page);

  assert.deepEqual({ chips: chips(next.bar.element), reads: page.reads() }, { chips: ['давай', '/clear', 'проверь'], reads: 1 });
});

// A prompt sent from one tab's box counts anew: the viewer is asked again, and every tab's row shows its answer
test('phraseBar_Should_RedrawEveryTabsRow_When_APromptIsSentFromOne', async () => {
  const page = countOf([sentMost, [{ text: '/clear', count: 13 }, ...sentMost.filter((phrase) => phrase.text !== '/clear')]]);
  const sentFrom = barOf(true, page);
  const other = barOf(true, page);
  await settled();

  await sentFrom.bar.refresh();

  assert.deepEqual({ sentFrom: chips(sentFrom.bar.element), other: chips(other.bar.element) }, { sentFrom: ['/clear', 'давай', 'проверь'], other: ['/clear', 'давай', 'проверь'] });
});

// The row over the box is on or off as it was last on this device; on, the phrases sent most, the most first, each a
// button that puts it into the box; off, nothing is asked of the viewer
test('phraseBar_Should_ShowPhrasesSentMost_AsLastOnThisDevice_PuttingOnePressedIntoTheBox', async () => {
  const off = barOf(false);
  await off.bar.refresh();
  const on = barOf(true);
  await on.bar.refresh();
  on.bar.element.querySelectorAll('button')[1]?.click();

  assert.deepEqual(
    { off: { chips: chips(off.bar.element), loads: off.loads() }, on: chips(on.bar.element), put: on.put },
    { off: { chips: [], loads: 0 }, on: ['давай', '/clear', 'проверь'], put: ['/clear'] },
  );
});
