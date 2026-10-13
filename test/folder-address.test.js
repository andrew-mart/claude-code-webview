import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderAddress } from '../public/model/folder-address.js';

// A document drawn in the panel comes by its folder's name in the address — so what it loads beside it resolves
// there — and its own name, escaped; asked to run its scripts, the address says so
test('folderAddress_Should_NameFolderAndFile_And_AskForScripts', () => {
  const folder = (/** @type {string} */ path) => Buffer.from(path).toString('base64url');

  assert.deepEqual(
    [folderAddress('D:/dev/x/site/page.html', 'off'), folderAddress('D:\\dev\\Отчёты\\итоги 2026.html', 'on')],
    [`/api/folder/${folder('D:/dev/x/site')}/page.html`, `/api/folder/${folder('D:\\dev\\Отчёты')}/%D0%B8%D1%82%D0%BE%D0%B3%D0%B8%202026.html?scripts=1`],
  );
});
