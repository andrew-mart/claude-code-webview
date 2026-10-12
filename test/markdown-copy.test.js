import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
// DOMPurify binds to window on import (through markdown.js), so the DOM is set up before it loads.
Object.assign(globalThis, { window, document: window.document, NodeFilter: window.NodeFilter, Text: window.Text, HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node });
const { renderMarkdown } = await import('../public/view/markdown.js');
const { copyAsMarkdown, markdownOf } = await import('../public/view/markdown-copy.js');

const answer = [
  '## Title',
  '',
  'Some **bold** and `code` and [a link](https://x.y) and D:/dev/x/a.cs:12.',
  '',
  '- one',
  '- two',
  '  - nested',
  '',
  '1. first',
  '2. second',
  '',
  '> quoted',
  '',
  '```ts',
  'const a = 1;',
  'const b = 2;',
  '```',
  '',
  '| A | B |',
  '| --- | --- |',
  '| 1 | 2 |',
].join('\n');

/** The answer as the feed shows it. */
function shown() {
  const element = window.document.createElement('div');
  element.append(renderMarkdown(answer));
  window.document.body.append(element);
  return element;
}

// What is selected in an answer is copied as markdown, as the answer was written: a whole answer comes back as it was,
// with no copy buttons or labels of the page in it
test('markdownOf_Should_GiveAnswerBackAsMarkdown', () => {
  assert.equal(markdownOf(shown()), answer);
});

// A part of an answer — from the middle of one paragraph to the middle of a list — keeps its marks for what it holds
test('markdownOf_Should_KeepMarksOfSelectedPart', () => {
  const element = shown();
  const bold = element.querySelector('strong')?.firstChild;
  const first = element.querySelector('ol li')?.firstChild;
  assert.ok(bold && first);
  const range = window.document.createRange();
  range.setStart(bold, 1);
  range.setEnd(first, 3);

  assert.equal(markdownOf(range.cloneContents()), ['**old** and `code` and [a link](https://x.y) and D:/dev/x/a.cs:12.', '', '- one', '- two', '  - nested', '', '1. fir'].join('\n'));
});

// A copy from the feed goes as markdown, the formatting along with it; a copy from anywhere else is the browser's own
test('copyAsMarkdown_Should_CopyFeedSelectionAsMarkdown_AndLeaveTheRest', () => {
  const thread = window.document.createElement('div');
  thread.className = 'thread';
  thread.append(renderMarkdown('Use **this** one'));
  const elsewhere = window.document.createElement('p');
  elsewhere.textContent = 'A **plain** line';
  window.document.body.append(thread, elsewhere);
  /** @param {Node} node */
  const copyOf = (node) => {
    const selection = window.getSelection();
    assert.ok(selection);
    selection.selectAllChildren(node);
    /** @type {Record<string, string>} */
    const data = {};
    let prevented = false;
    const event = { clipboardData: { setData: (/** @type {string} */ type, /** @type {string} */ value) => (data[type] = value) }, preventDefault: () => (prevented = true) };
    copyAsMarkdown(event);
    return { text: data['text/plain'], html: data['text/html'] !== undefined, prevented };
  };

  assert.deepEqual([copyOf(thread), copyOf(elsewhere)], [
    { text: 'Use **this** one', html: true, prevented: true },
    { text: undefined, html: false, prevented: false },
  ]);
});
