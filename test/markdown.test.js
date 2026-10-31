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

// The terminal shows a line break in an answer as a line break: lines one under the other stay so, not run into one
test('renderMarkdown_Should_KeepSingleLineBreaksInParagraph', () => {
  const holder = html(renderMarkdown('👉 One city first, or all of them?\n👉 Authorise `gh`: `! gh auth login`.'));

  assert.deepEqual(
    [...holder.querySelectorAll('p')].map((paragraph) => paragraph.innerHTML),
    ['👉 One city first, or all of them?<br>👉 Authorise <code>gh</code>: <code>! gh auth login</code>.'],
  );
});

// As the terminal shows an answer, single tildes strike nothing out — "~$2,7" is "about $2.7" — two on each side do
test('renderMarkdown_Should_StrikeOutOnlyBetweenDoubleTildes', () => {
  const holder = html(renderMarkdown('(~5 минут на тесты), сборка (~2 минуты)\n\n~~the old plan~~ the new one'));

  assert.deepEqual(
    [...holder.querySelectorAll('p')].map((paragraph) => paragraph.innerHTML),
    ['(~5 минут на тесты), сборка (~2 минуты)', '<del>the old plan</del> the new one'],
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

// Inline code that is a path as a whole is one link, spaces in the names of its folders and all; code that only starts
// with a path to a file links that file alone
test('renderMarkdown_Should_LinkInlineCodeThatIsPathWithSpaces_AsAWhole', () => {
  const holder = html(renderMarkdown('In `D:/dev/x/20261016 - hosting/` and `D:/dev/My Docs/plan.md:12`, not `D:/dev/x/a.md and b.md`'));

  assert.deepEqual(fileLinks(holder), [
    { text: 'D:/dev/x/20261016 - hosting/', path: 'D:/dev/x/20261016 - hosting/', line: null, inside: 'CODE' },
    { text: 'D:/dev/My Docs/plan.md:12', path: 'D:/dev/My Docs/plan.md', line: '12', inside: 'CODE' },
    { text: 'D:/dev/x/a.md', path: 'D:/dev/x/a.md', line: null, inside: 'CODE' },
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

test('renderMarkdown_Should_MakeHeadingOfJustFilePathCaptionOverCode', () => {
  const holder = html(renderMarkdown('### D:/dev/app/server/rewind.js:131\n```js\nawait keys();\n```\n\n### Results\n\n### Changes in D:/dev/app/a.js'));

  const headings = [...holder.querySelectorAll('h3')].map((heading) => [heading.textContent, heading.classList.contains('file-caption')]);

  assert.deepEqual(headings, [
    ['D:/dev/app/server/rewind.js:131', true],
    ['Results', false],
    ['Changes in D:/dev/app/a.js', false],
  ]);
});

test('renderMarkdown_Should_FrameTableWithWidthButtonAndKeepCellTextInBlocks', () => {
  const holder = html(renderMarkdown('| Name | Notes |\n| --- | --- |\n| a | some long text |\n\nAfter'));

  const frame = holder.querySelector('.table-frame');
  assert.ok(frame);
  assert.ok(frame.querySelector('button.table-width'));
  assert.deepEqual([...frame.querySelectorAll('table th > .cell, table td > .cell')].map((cell) => cell.textContent), ['Name', 'Notes', 'a', 'some long text']);
  assert.deepEqual(
    [...holder.children].map((child) => child.className || child.tagName),
    ['table-frame', 'P'],
  );
});

test('renderMarkdown_Should_WidenTableOnItsButtonAndFitItBackOnNextClick', () => {
  const frame = html(renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |')).querySelector('.table-frame');
  const button = frame?.querySelector('button.table-width');
  assert.ok(frame instanceof window.HTMLElement && button instanceof window.HTMLElement);

  button.click();
  const widened = frame.dataset.width;
  button.click();

  assert.deepEqual([widened, frame.dataset.width], ['wide', 'fit']);
});

// A code block's long lines scroll sideways; the Wrap button over it wraps them in the block's width, pressed again it
// lets them be as they were
test('renderMarkdown_Should_WrapCodeBlockLinesOnItsButton_AndUnwrapOnNextPress', () => {
  const frame = html(renderMarkdown('```text\nThe 14 hours of the move went into the parts that only had to be done once\n```')).querySelector('.code-frame');
  const button = frame?.querySelector('.code-bar button.code-wrap');
  assert.ok(frame instanceof window.HTMLElement && button instanceof window.HTMLElement, 'no Wrap over the code');
  const state = () => [frame.dataset.wrap ?? 'off', button.getAttribute('aria-pressed')];

  const before = state();
  button.click();
  const wrapped = state();
  button.click();

  assert.deepEqual([before, wrapped, state()], [['off', 'false'], ['on', 'true'], ['off', 'false']]);
});
