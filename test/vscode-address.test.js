import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vscodeAddress } from '../public/model/vscode.js';

// VS Code in the browser opens a folder named as a path of its URI: a Windows folder with a slash ahead of its drive —
// "D:/dev/shop" alone opens empty — any other as it is
test('vscodeAddress_Should_NameFolderAsPathOfItsUri', () => {
  const folderOf = (/** @type {string} */ cwd) => new URL(vscodeAddress(cwd), 'http://viewer').searchParams.get('folder');

  assert.deepEqual([folderOf('D:\\dev\\shop'), folderOf('c:/Users/ann/notes'), folderOf('/home/ann/shop')], ['/D:/dev/shop', '/c:/Users/ann/notes', '/home/ann/shop']);
  assert.equal(new URL(vscodeAddress('/home/ann/shop'), 'http://viewer').pathname, '/vscode/');
});
