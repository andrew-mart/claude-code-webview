import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepsDocxLink, keepsDocxSelector, localUrlsOnly } from '../public/model/docx-safety.js';

// A Word document's styles are its own: a rule stays only when each of its selectors starts at an element of the
// document — from there it reaches the document's parts and nothing of the viewer's page; a class inside :not() or an
// attribute is no element of it
test('keepsDocxSelector_Should_KeepRulesThatStartAtDocument', () => {
  assert.deepEqual(
    ['.docx p', '.docx-wrapper > section.docx', '.docx_heading1, .docx-num-1-0::before', 'body', '#doc-list > li', '.docx p, body', ':not(.docx) p', '[class=".docx"] p', '.docxx p'].map(keepsDocxSelector),
    [true, true, true, false, false, false, false, false, false],
  );
});

// The document's pictures and fonts come as data: and blob: addresses; any other address would tell a server that
// the document is open — an address hidden in a variable too
test('localUrlsOnly_Should_AllowOnlyAddressesInsideDocument', () => {
  assert.deepEqual(
    ['red', 'url(data:image/png;base64,AA)', 'url("blob:http://x/1")', 'url(https://evil.example/x.png)', 'image-set("https://evil.example/a.png" 1x)', 'image-set(var(--a))'].map(localUrlsOnly),
    [true, true, true, false, false, false],
  );
});

// A link in the document keeps its address when it goes to a place in the document or to a page on the web or a
// mail; a script address — or one that only looks like a web address — loses it
test('keepsDocxLink_Should_KeepPlacesWebAndMailOnly', () => {
  assert.deepEqual(
    ['#_Toc123', 'https://example.com/a', 'mailto:a@b.c', 'javascript:alert(1)', '\u200Bhttps://example.com', 'file:///C:/secret.txt', undefined].map(keepsDocxLink),
    [true, true, true, false, false, false, false],
  );
});
