import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadAddress } from '../public/model/download-address.js';

// A file downloads from the viewer's address for it, a folder as a zip. In the iPhone's home-screen app iOS cannot save
// a download — the app is left on a screen with no way back — so there the address opens in Safari itself, which saves
// it and takes a cut download up again (x-safari-https:, iOS 17 and later); a viewer reached over plain http has no such
// address, and keeps its own
test('downloadAddress_Should_OpenInSafari_FromHomeScreenApp_OverHttps', () => {
  const path = 'D:/videos/Talk [x1].mp4';

  assert.deepEqual(
    [
      downloadAddress(path, 'file', { opens: 'this-browser', origin: 'https://viewer.example' }),
      downloadAddress('D:/videos', 'folder', { opens: 'this-browser', origin: 'https://viewer.example' }),
      downloadAddress(path, 'file', { opens: 'safari', origin: 'https://viewer.example' }),
      downloadAddress(path, 'file', { opens: 'safari', origin: 'http://127.0.0.1:7788' }),
    ],
    [
      '/api/file/download?path=D%3A%2Fvideos%2FTalk+%5Bx1%5D.mp4',
      '/api/folder/download?path=D%3A%2Fvideos',
      'x-safari-https://viewer.example/api/file/download?path=D%3A%2Fvideos%2FTalk+%5Bx1%5D.mp4',
      '/api/file/download?path=D%3A%2Fvideos%2FTalk+%5Bx1%5D.mp4',
    ],
  );
});
