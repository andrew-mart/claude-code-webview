import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderChoices, rememberFolder } from '../public/model/folders.js';

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

// A folder a workspace was opened in goes to the head of those typed, once; the oldest fall off past twenty
test('rememberFolder_Should_PutFolderFirstOnce_KeepingTwenty', () => {
  const many = Array.from({ length: 20 }, (_, index) => `/f${index}`);

  assert.deepEqual(
    [rememberFolder(['D:/dev/a', 'D:/dev/b'], 'D:\\dev\\b'), rememberFolder(many, '/new').length, rememberFolder(many, '/new')[19], rememberFolder(['/a'], '  ')],
    [['D:\\dev\\b', 'D:/dev/a'], 20, '/f18', ['/a']],
  );
});
