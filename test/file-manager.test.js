import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileManagerLaunch } from '../server/file-manager.js';

// A folder opens in the computer's file manager — Explorer, Finder, the desktop's own through xdg-open — and a file
// shows there in its folder, picked out where the file manager can: Explorer's /select and Finder's -R
test('fileManagerLaunch_Should_OpenFolder_And_ShowFileInIt_AsEachSystemDoes', () => {
  assert.deepEqual(
    [
      fileManagerLaunch({ folder: 'D:/dev/my shop' }, 'win32'),
      fileManagerLaunch({ path: 'D:/dev/my shop/src/Cart.cs' }, 'win32'),
      fileManagerLaunch({ folder: '/Users/ann/shop' }, 'darwin'),
      fileManagerLaunch({ path: '/Users/ann/shop/cart.js' }, 'darwin'),
      fileManagerLaunch({ folder: '/home/ann/shop' }, 'linux'),
      fileManagerLaunch({ path: '/home/ann/shop/cart.js' }, 'linux'),
    ],
    [
      { program: 'explorer.exe', args: ['D:\\dev\\my shop'], verbatim: false },
      { program: 'explorer.exe', args: ['/select,"D:\\dev\\my shop\\src\\Cart.cs"'], verbatim: true },
      { program: 'open', args: ['/Users/ann/shop'], verbatim: false },
      { program: 'open', args: ['-R', '/Users/ann/shop/cart.js'], verbatim: false },
      { program: 'xdg-open', args: ['/home/ann/shop'], verbatim: false },
      { program: 'xdg-open', args: ['/home/ann/shop'], verbatim: false },
    ],
  );
});
