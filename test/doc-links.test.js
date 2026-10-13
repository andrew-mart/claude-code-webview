import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docLinkTarget, folderAddress, splitFrontMatter } from '../public/model/doc-links.js';

// A link in a document is read where the document lies: a path next to it or above it is a file to open — at a line
// when it names one, a % that escapes nothing taken as it is — a #name a place in the document itself, an address with
// a scheme a page on the web
test('docLinkTarget_Should_ReadLinkFromWhereDocumentLies', () => {
  assert.deepEqual(
    [
      ['D:/dev/x/docs/README.md', './img/a.png'],
      ['D:\\dev\\x\\docs\\README.md', '../src/App.cs#L12'],
      ['/home/u/notes/a.md', 'b%20c.md?raw=1'],
      ['D:/dev/x/a.md', '/etc/b.md'],
      ['/home/u/a.md', '/etc/b.md'],
      ['D:/dev/x/a.md', '#install-on-windows'],
      ['D:/dev/x/a.md', 'https://example.com/x'],
      ['D:/dev/x/a.md', 'mailto:a@b.c'],
      ['D:/dev/x/a.md', 'data:image/png;base64,AAAA'],
      ['D:/dev/x/a.md', '100%.md'],
    ].map(([file, href]) => docLinkTarget(file ?? '', href ?? '')),
    [
      { kind: 'file', path: 'D:/dev/x/docs/img/a.png', line: undefined },
      { kind: 'file', path: 'D:/dev/x/src/App.cs', line: 12 },
      { kind: 'file', path: '/home/u/notes/b c.md', line: undefined },
      { kind: 'file', path: 'D:/etc/b.md', line: undefined },
      { kind: 'file', path: '/etc/b.md', line: undefined },
      { kind: 'anchor', id: 'install-on-windows' },
      { kind: 'web' },
      { kind: 'web' },
      { kind: 'web' },
      { kind: 'file', path: 'D:/dev/x/100%.md', line: undefined },
    ],
  );
});

// The block of settings at the head of a document is no part of its text; a rule further down is
test('splitFrontMatter_Should_TakeSettingsBlockOffHeadOnly', () => {
  assert.deepEqual(
    ['---\ntitle: Notes\ntags: [a]\n---\n# Notes\n', '# Notes\n\n---\n\nmore\n', '---\nnever closed\n# Notes\n'].map(splitFrontMatter),
    [
      { frontMatter: 'title: Notes\ntags: [a]', body: '# Notes\n' },
      { frontMatter: undefined, body: '# Notes\n\n---\n\nmore\n' },
      { frontMatter: undefined, body: '---\nnever closed\n# Notes\n' },
    ],
  );
});

// A document drawn in the panel comes by its folder's name in the address — so what it loads beside it resolves
// there — and its own name, escaped; asked to run its scripts, the address says so
test('folderAddress_Should_NameFolderAndFile_And_AskForScripts', () => {
  const folder = (/** @type {string} */ path) => Buffer.from(path).toString('base64url');

  assert.deepEqual(
    [folderAddress('D:/dev/x/site/page.html', 'off'), folderAddress('D:\\dev\\Отчёты\\итоги 2026.html', 'on')],
    [`/api/folder/${folder('D:/dev/x/site')}/page.html`, `/api/folder/${folder('D:\\dev\\Отчёты')}/%D0%B8%D1%82%D0%BE%D0%B3%D0%B8%202026.html?scripts=1`],
  );
});
