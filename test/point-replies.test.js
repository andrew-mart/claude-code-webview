import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
// DOMPurify binds to window on import (through markdown.js), so the DOM is set up before it loads.
Object.assign(globalThis, { window, document: window.document, NodeFilter: window.NodeFilter, Text: window.Text, HTMLElement: window.HTMLElement, HTMLButtonElement: window.HTMLButtonElement, Element: window.Element, Node: window.Node });
const { renderMarkdown } = await import('../public/view/markdown.js');
const { markPoints, pointText } = await import('../public/view/point-replies.js');

/** An answer that asks two things in one paragraph, one in a list, and points at something mid-sentence. */
const answer = [
  'Two things are left.',
  '',
  '👉 Teach the feed to take the items of top-ups, as `v_line_money` does?',
  '👉 Was the trip on 06.11 one or two? Two are written now.',
  '',
  'Not this 👉 one, in the middle of a sentence.',
  '',
  '- 👉 Keep the old sort for the admin list?',
].join('\n');

/** The answer as the feed shows it, its points marked. */
function shown() {
  const element = window.document.createElement('div');
  element.append(renderMarkdown(answer));
  markPoints(element);
  window.document.body.append(element);
  return element;
}

// A 👉 that starts a line of an answer points at something to answer: it is a button, and what it points at is the
// line's text up to the next line pointed at, or the paragraph's end — as markdown, the way the answer was written. A 👉
// in the middle of a sentence points at nothing to answer
test('markPoints_Should_MakeEachLineStartingWithAPointAButton_ThatGivesItsText', () => {
  const points = [...shown().querySelectorAll('button.point-reply')];

  assert.deepEqual(
    points.map((point) => pointText(point)),
    [
      '👉 Teach the feed to take the items of top-ups, as `v_line_money` does?',
      '👉 Was the trip on 06.11 one or two? Two are written now.',
      '👉 Keep the old sort for the admin list?',
    ],
  );
});

// An answer copied as markdown keeps its points as they were written: a 👉 made a button is the answer's, not the page's
test('markdownOf_Should_KeepThePointsOfAnAnswer', async () => {
  const { markdownOf } = await import('../public/view/markdown-copy.js');

  assert.equal(markdownOf(shown()), answer);
});
