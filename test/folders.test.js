import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderChoices, folderOffers, folderSearch, foundFolders, rememberFolder, systemFolder } from '../public/model/folders.js';

/** A place a session ran in, in this folder, seen last at this time. */
const ranIn = (/** @type {string | undefined} */ folder, /** @type {number} */ lastSeen) => ({ workspace: 'w', tab: 't', earlierTabs: [], terminal: undefined, folder, firstSeen: 1, lastSeen, open: false, note: undefined });

// A new workspace's folder is chosen from those typed before — the latest first — then from where sessions ran, the
// latest first; a folder is offered once, however its slashes or letters' case are written on Windows
test('folderChoices_Should_OfferTypedFoldersFirst_ThenWhereSessionsRan_EachOnce', () => {
  const history = { a: ranIn('D:\\dev\\shop', 5), b: ranIn('/home/ann/notes', 9), c: ranIn(undefined, 7), d: ranIn('d:/DEV/shop/', 8) };

  assert.deepEqual(folderChoices(['D:/dev/billing', 'D:/dev/shop'], history), ['D:/dev/billing', 'D:/dev/shop', '/home/ann/notes']);
});

// A session open now ran in its folder latest of all: the viewer does not say when it saw it last — it sees it now
test('folderChoices_Should_PutFolderOfOpenSessionFirst_AmongWhereSessionsRan', () => {
  const history = { closed: ranIn('/home/ann/notes', 9), open: { ...ranIn('D:/dev/shop', 1), lastSeen: undefined, open: true } };

  assert.deepEqual(folderChoices([], history), ['D:/dev/shop', '/home/ann/notes']);
});

// A folder is written as the viewer's computer writes paths: its slashes one way — backslashes on Windows, forward
// elsewhere — doubled ones as one, none at the end but a drive's or the root's own; home's ~ kept
test('systemFolder_Should_WriteFolderAsSystemWritesPaths', () => {
  assert.deepEqual(
    [
      systemFolder('D:/dev//shop/', '\\'),
      systemFolder(' d:\\DEV\\shop ', '\\'),
      systemFolder('D:/', '\\'),
      systemFolder('~/notes', '\\'),
      systemFolder('/home/ann//notes/', '/'),
      systemFolder('/', '/'),
      systemFolder('~\\notes', '/'),
    ],
    ['D:\\dev\\shop', 'd:\\DEV\\shop', 'D:\\', '~\\notes', '/home/ann/notes', '/', '~/notes'],
  );
});

// The folders on the disk offered for what is typed: for a path, those in the folder before its last slash whose names
// start with what follows it, in any case; for a word, those with it in their names beside the folders worked in — in
// their parent folders; a hidden one, its name a dot first, only once a dot is typed
test('folderSearch_And_foundFolders_Should_FindFoldersOnDiskForWhatIsTyped', () => {
  const known = ['D:\\dev\\shop', 'D:\\dev\\claude-code-webview\\personal', 'D:\\dev\\blog'];
  /** @type {ReadonlyMap<string, readonly string[]>} */
  const disk = new Map([
    ['D:\\dev\\', ['.cache', 'billing', 'blog', 'claude-code-webview', 'Shop', 'shopping']],
    ['D:\\dev\\claude-code-webview\\', ['claude-code-webview', 'personal']],
  ]);
  const found = (/** @type {string} */ typed) => {
    const search = folderSearch(typed, '\\', known);
    return [search.lists, foundFolders(search, disk)];
  };

  assert.deepEqual(
    [found('D:/dev/sh'), found('D:\\dev\\'), found('D:\\dev\\.c'), found('bill'), found('claude'), found('  ')],
    [
      [['D:\\dev\\'], ['D:\\dev\\Shop', 'D:\\dev\\shopping']],
      [['D:\\dev\\'], ['D:\\dev\\billing', 'D:\\dev\\blog', 'D:\\dev\\claude-code-webview', 'D:\\dev\\Shop', 'D:\\dev\\shopping']],
      [['D:\\dev\\'], ['D:\\dev\\.cache']],
      [['D:\\dev\\', 'D:\\dev\\claude-code-webview\\'], ['D:\\dev\\billing']],
      [['D:\\dev\\', 'D:\\dev\\claude-code-webview\\'], ['D:\\dev\\claude-code-webview', 'D:\\dev\\claude-code-webview\\claude-code-webview']],
      [[], []],
    ],
  );
});

// Offered for what is typed: the folders worked in that hold it first — however its slashes lean, in any case — then
// the folders found on the disk not among them that hold it too — those found for what was typed before may still be
// there — as many as the limit; none once what is typed is one of them, unless a slash after it goes into it: then
// what is in it, without it
test('folderOffers_Should_PutFoldersWorkedInFirst_ThenThoseFoundOnDisk_UpToLimit', () => {
  const known = ['D:\\dev\\shop', 'D:\\dev\\billing', '/home/ann/notes'];
  const found = ['D:\\dev\\Shop', 'D:\\dev\\site', 'D:\\dev\\shopping', 'D:\\dev\\shops-old'];

  assert.deepEqual(
    [
      folderOffers(known, found, 'd:/DEV/sh', 3),
      folderOffers(known, [], '', 8),
      folderOffers(known, found, 'D:\\dev\\shop', 8),
      folderOffers(['D:\\dev', ...known], ['D:\\dev\\site'], 'D:/dev/', 8),
    ],
    [
      ['D:\\dev\\shop', 'D:\\dev\\shopping', 'D:\\dev\\shops-old'],
      known,
      [],
      ['D:\\dev\\shop', 'D:\\dev\\billing', 'D:\\dev\\site'],
    ],
  );
});

// A folder a workspace was opened in goes to the head of those typed, once; the oldest fall off past twenty
test('rememberFolder_Should_PutFolderFirstOnce_KeepingTwenty', () => {
  const many = Array.from({ length: 20 }, (_, index) => `/f${index}`);

  assert.deepEqual(
    [rememberFolder(['D:/dev/a', 'D:/dev/b'], 'D:\\dev\\b'), rememberFolder(many, '/new').length, rememberFolder(many, '/new')[19], rememberFolder(['/a'], '  ')],
    [['D:\\dev\\b', 'D:/dev/a'], 20, '/f18', ['/a']],
  );
});
