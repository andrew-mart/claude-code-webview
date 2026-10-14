import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
// DOMPurify binds to window on import (through markdown.js), so the DOM is set up before it loads.
Object.assign(globalThis, { window, document: window.document, NodeFilter: window.NodeFilter, Text: window.Text, HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node });
const { renderMarkdown } = await import('../public/view/markdown.js');
const { copySelection, listenForCopies, markdownOf } = await import('../public/view/markdown-copy.js');

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

// A copy from the feed goes as markdown when asked, the formatting along with it, else as the browser copies; a copy from
// anywhere else is the browser's own
test('copySelection_Should_CopyFeedSelectionAsMarkdown_WhenAsked_AndLeaveTheRest', () => {
  const thread = window.document.createElement('div');
  thread.className = 'thread';
  thread.append(renderMarkdown('Use **this** one'));
  const elsewhere = window.document.createElement('p');
  elsewhere.textContent = 'A **plain** line';
  window.document.body.append(thread, elsewhere);
  /** @param {Node} node @param {'markdown' | 'plain'} as */
  const copyOf = (node, as = /** @type {const} */ ('markdown')) => {
    const selection = window.getSelection();
    assert.ok(selection);
    selection.selectAllChildren(node);
    /** @type {Record<string, string>} */
    const data = {};
    let prevented = false;
    const event = { clipboardData: { setData: (/** @type {string} */ type, /** @type {string} */ value) => (data[type] = value) }, preventDefault: () => (prevented = true) };
    copySelection(event, as);
    return { text: data['text/plain'], html: data['text/html'] !== undefined, prevented };
  };

  assert.deepEqual([copyOf(thread), copyOf(thread, 'plain'), copyOf(elsewhere)], [
    { text: 'Use **this** one', html: true, prevented: true },
    { text: undefined, html: false, prevented: false },
    { text: undefined, html: false, prevented: false },
  ]);
});

// Ctrl+C copies from the feed as the reader set it — the browser's own copy unless markdown was asked for — and
// Ctrl+Shift+C as markdown whatever the setting, in any keyboard layout; in a text field Ctrl+Shift+C is the field's
test('listenForCopies_Should_CopyFeedAsMarkdownOnCtrlShiftC_AndAsSetOnCtrlC', () => {
  const document = window.document;
  const thread = document.createElement('div');
  thread.className = 'thread';
  thread.append(renderMarkdown('Use **this** one'));
  const field = document.createElement('textarea');
  document.body.replaceChildren(thread, field);
  /** @type {Record<string, string>} */
  let data = {};
  /** The browser's copy: the copy event, with the clipboard to set. */
  const copy = () => {
    const event = new window.Event('copy', { cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData: (/** @type {string} */ type, /** @type {string} */ value) => (data[type] = value) } });
    document.dispatchEvent(event);
    return true;
  };
  document.execCommand = (command) => command === 'copy' && copy();
  listenForCopies(document, () => 'plain');
  /** @param {() => void} press @param {Node} [where] */
  const copied = (press, where = thread) => {
    data = {};
    document.getSelection()?.selectAllChildren(thread);
    press();
    return data['text/plain'];
  };
  /** @param {EventTarget} target @param {string} key */
  const shortcut = (target, key) => () => target.dispatchEvent(new window.KeyboardEvent('keydown', { key, code: 'KeyC', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));

  assert.deepEqual(
    { ctrlC: copied(copy), latin: copied(shortcut(thread, 'C')), cyrillic: copied(shortcut(thread, 'С')), inField: copied(shortcut(field, 'C'), field) },
    { ctrlC: undefined, latin: 'Use **this** one', cyrillic: 'Use **this** one', inField: undefined },
  );
});
