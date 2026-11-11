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

// A code block's long lines scroll sideways, a text block's — words, a letter — wrap in its width from the start; the
// Wrap button over either turns its lines the other way, pressed again it lets them be as they were
test('renderMarkdown_Should_WrapTextBlocksFromStart_AndAnyBlockOnItsButton', () => {
  const pressed = ['text', 'plaintext', 'sh'].map((language) => {
    const frame = html(renderMarkdown(`\`\`\`${language}\nThe 14 hours of the move went into the parts that only had to be done once\n\`\`\``)).querySelector('.code-frame');
    const button = frame?.querySelector('.code-bar button.code-wrap');
    assert.ok(frame instanceof window.HTMLElement && button instanceof window.HTMLElement, 'no Wrap over the code');
    const state = () => `${frame.dataset.wrap ?? 'off'} ${button.getAttribute('aria-pressed')}`;
    const before = state();
    button.click();
    const once = state();
    button.click();
    return [before, once, state()];
  });

  assert.deepEqual(pressed, [
    ['on true', 'off false', 'on true'],
    ['on true', 'off false', 'on true'],
    ['off false', 'on true', 'off false'],
  ]);
});

// A fragment quoted with its lines' numbers — right-aligned in a column before the code, "..." where lines are left out —
// shows them in a column of their own, out of the code: the copy button copies the code alone. A block whose lines only
// start with numbers, not in such a column, stays as it is
test('renderMarkdown_Should_KeepLineNumbersOfQuotedFragmentOutOfCodeCopied', async (t) => {
  /** @type {string[]} */
  const copied = [];
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (/** @type {string} */ text) => void copied.push(text) }, configurable: true });
  t.after(() => Reflect.deleteProperty(navigator, 'clipboard'));
  const holder = html(renderMarkdown('```js\n  9  function total(cart) {\n 10\n ...\n 14    return sum;\n```\n\n```text\n3  apples\n12  pears\n```'));
  const [fragment, list] = [...holder.querySelectorAll('.code-frame')];
  assert.ok(fragment instanceof window.HTMLElement && list instanceof window.HTMLElement, 'no frames around the code');
  fragment.querySelector('.code-bar button.copy')?.dispatchEvent(new window.MouseEvent('click'));
  list.querySelector('.code-bar button.copy')?.dispatchEvent(new window.MouseEvent('click'));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(
    { numbers: fragment.querySelector('pre > .gutter')?.textContent, code: fragment.querySelector('pre code')?.textContent, copied, listNumbers: list.querySelector('.gutter') },
    { numbers: '9\n10\n...\n14', code: 'function total(cart) {\n\n\n  return sum;', copied: ['function total(cart) {\n\n\n  return sum;', '3  apples\n12  pears\n'], listNumbers: null },
  );
});

// A path cut at a space where a folder's name goes on is linked whole once the viewer finds the file there — asked once
// for every such path in the answer, the words after it joining the link; one it does not find stays as it was, the
// words after it words
test('renderMarkdown_Should_LinkPathThroughFolderWithSpaces_WhenViewerFindsTheFile', async (t) => {
  /** @type {unknown[]} */
  const asked = [];
  const before = globalThis.fetch;
  Object.assign(globalThis, {
    fetch: async (/** @type {string} */ url, /** @type {RequestInit | undefined} */ init) => {
      asked.push([url, JSON.parse(String(init?.body))]);
      return new Response(JSON.stringify({ existing: ['D:/work/shop/_docs/20261016 - checkout move/server-logic/catalog.md'] }), { headers: { 'Content-Type': 'application/json' } });
    },
  });
  t.after(() => Object.assign(globalThis, { fetch: before }));
  const answer = 'Каталог в D:/work/shop/_docs/20261016 - checkout move/server-logic/catalog.md, рядом в sql/\n\nв D:/dev/app файл src/app.ts';
  const holder = html(renderMarkdown(answer));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(
    { asked, links: [...holder.querySelectorAll('a')].map((link) => [link.textContent, link.getAttribute('data-path')]), text: holder.textContent },
    {
      asked: [['/api/paths/existing', { paths: ['D:/work/shop/_docs/20261016 - checkout move/server-logic/catalog.md', 'D:/dev/app файл src/app.ts'] }]],
      links: [
        ['D:/work/shop/_docs/20261016 - checkout move/server-logic/catalog.md', 'D:/work/shop/_docs/20261016 - checkout move/server-logic/catalog.md'],
        ['D:/dev/app', 'D:/dev/app'],
      ],
      text: 'Каталог в D:/work/shop/_docs/20261016 - checkout move/server-logic/catalog.md, рядом в sql/\nв D:/dev/app файл src/app.ts\n',
    },
  );
});
