import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// DOMPurify binds to window on import, so the DOM is set up before the module loads.
// jsdom, not happy-dom: under happy-dom DOMPurify lets <script> and onerror through, which defeats the safety check.
const { window } = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, { window, document: window.document, NodeFilter: window.NodeFilter, Text: window.Text });
const { renderMarkdown } = await import('../public/view/markdown.js');

/** @param {DocumentFragment} fragment */
const html = (fragment) => {
  const holder = document.createElement('div');
  holder.append(fragment);
  return holder;
};

test('renderMarkdown_Should_WrapCodeBlockIntoFrameWithLanguage', () => {
  const holder = html(renderMarkdown('Text\n\n```bash\nls -la\n```\n\nAfter'));

  const frame = holder.querySelector('.code-frame');
  assert.ok(frame);
  assert.equal(frame.querySelector('.code-bar span')?.textContent, 'bash');
  assert.equal(frame.querySelector('pre code')?.textContent, 'ls -la\n');
  assert.deepEqual(
    [...holder.children].map((child) => child.tagName),
    ['P', 'DIV', 'P'],
  );
});

test('renderMarkdown_Should_StripScriptsAndEventHandlersFromTranscriptText', () => {
  const holder = html(renderMarkdown('<img src="x" onerror="alert(1)"><script>alert(2)</script>[link](javascript:alert(3))'));

  assert.equal(holder.querySelector('script'), null);
  assert.equal(holder.querySelector('img')?.getAttribute('onerror'), null);
  assert.equal(holder.querySelector('a')?.getAttribute('href'), null);
});

test('renderMarkdown_Should_OpenLinksInNewTab', () => {
  const link = html(renderMarkdown('[docs](https://code.claude.com/docs)')).querySelector('a');

  assert.equal(link?.getAttribute('target'), '_blank');
  assert.equal(link?.getAttribute('rel'), 'noopener noreferrer');
});

/** @param {HTMLElement} holder */
const fileLinks = (holder) =>
  [...holder.querySelectorAll('a.file-link')].map((link) => ({
    text: link.textContent,
    path: link.getAttribute('data-path'),
    line: link.getAttribute('data-line'),
    inside: link.parentElement?.tagName,
  }));

test('renderMarkdown_Should_TurnFilePathsInTextHeadingsAndInlineCodeIntoLinks', () => {
  const holder = html(renderMarkdown('### D:/dev/x/a.cs:41\n\nSee D:/dev/x/b.js:7-9 and `D:\\dev\\x\\c.md`'));

  assert.deepEqual(fileLinks(holder), [
    { text: 'D:/dev/x/a.cs:41', path: 'D:/dev/x/a.cs', line: '41', inside: 'H3' },
    { text: 'D:/dev/x/b.js:7-9', path: 'D:/dev/x/b.js', line: '7', inside: 'P' },
    { text: 'D:\\dev\\x\\c.md', path: 'D:\\dev\\x\\c.md', line: null, inside: 'CODE' },
  ]);
});

test('renderMarkdown_Should_KeepPathsInsideCodeBlocksAsText', () => {
  assert.deepEqual(fileLinks(html(renderMarkdown('```\nD:/dev/x/a.cs:41\n```'))), []);
});

test('renderMarkdown_Should_OpenFileUrlLinksInPanel', () => {
  assert.deepEqual(fileLinks(html(renderMarkdown('[file](file:///D:/dev/x%20y/z.md#L3)'))), [
    { text: 'file', path: 'D:/dev/x y/z.md', line: '3', inside: 'P' },
  ]);
});
