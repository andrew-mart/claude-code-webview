import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vscodeAddress, vscodeFileAddress } from '../public/model/vscode.js';

// VS Code in the browser opens a folder named as a path of its URI: a Windows folder with a slash ahead of its drive —
// "D:/dev/shop" alone opens empty — any other as it is
test('vscodeAddress_Should_NameFolderAsPathOfItsUri', () => {
  const folderOf = (/** @type {string} */ cwd) => new URL(vscodeAddress(cwd), 'http://viewer').searchParams.get('folder');

  assert.deepEqual([folderOf('D:\\dev\\shop'), folderOf('c:/Users/ann/notes'), folderOf('/home/ann/shop')], ['/D:/dev/shop', '/c:/Users/ann/notes', '/home/ann/shop']);
  assert.equal(new URL(vscodeAddress('/home/ann/shop'), 'http://viewer').pathname, '/vscode/');
});

// A file opened in VS Code in the browser at its project's folder: the file named by a URI under the address VS Code's
// page is reached at — its server's files are there — the line after it, VS Code told to go to it; a file with no line
// opens at its top
test('vscodeFileAddress_Should_OpenFileAtItsLine_InProjectFolder', () => {
  const opened = (/** @type {number | undefined} */ line) => {
    const address = new URL(vscodeFileAddress({ folder: 'D:\\dev\\shop', path: 'D:\\dev\\shop\\src\\cart total#2.js', line, authority: 'viewer.example.com' }), 'http://viewer');
    return { at: address.pathname, folder: address.searchParams.get('folder'), payload: JSON.parse(address.searchParams.get('payload') ?? 'null') };
  };

  assert.deepEqual(
    [opened(12), opened(undefined).payload],
    [
      { at: '/vscode/', folder: '/D:/dev/shop', payload: [['openFile', 'vscode-remote://viewer.example.com/D:/dev/shop/src/cart%20total%232.js:12'], ['gotoLineMode', 'true']] },
      [['openFile', 'vscode-remote://viewer.example.com/D:/dev/shop/src/cart%20total%232.js']],
    ],
  );
});
