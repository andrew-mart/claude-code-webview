import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitAttachedImages, uploadUrl, withAttachedImages } from '../public/model/attachments.js';

const photo = 'C:\\Users\\ann\\.claude-code-webview\\uploads\\2026-10-10_134501-k3f9qa.jpg';
const screenshot = '/home/ann/.claude-code-webview/uploads/2026-10-10_134502-x81mzt.png';

test('withAttachedImages_Should_ListImagePathsAfterPromptText', () => {
  assert.equal(withAttachedImages('Why is the legend cut off?  \n', [photo, screenshot]), `Why is the legend cut off?\n\nAttached images:\n${photo}\n${screenshot}`);
  assert.equal(withAttachedImages('', [photo]), `Attached images:\n${photo}`);
  assert.equal(withAttachedImages('Just text', []), 'Just text');
});

test('splitAttachedImages_Should_TakeImagePathsOffTheEndOfPrompt', () => {
  assert.deepEqual(splitAttachedImages(`Why is the legend cut off?\n\nAttached images:\n${photo}\n${screenshot}`), {
    text: 'Why is the legend cut off?',
    paths: [photo, screenshot],
  });
  assert.deepEqual(splitAttachedImages(`Attached images:\n${photo}`), { text: '', paths: [photo] });
  // the words alone, in the middle of a prompt, are not a list of attachments
  assert.deepEqual(splitAttachedImages('See "Attached images:" in the docs\nand then answer'), { text: 'See "Attached images:" in the docs\nand then answer', paths: [] });
});

test('uploadUrl_Should_LinkOnlyFilesFromViewerUploadsFolder', () => {
  assert.equal(uploadUrl(photo), '/api/upload/2026-10-10_134501-k3f9qa.jpg');
  assert.equal(uploadUrl(screenshot), '/api/upload/2026-10-10_134502-x81mzt.png');
  assert.equal(uploadUrl('C:\\Users\\ann\\Pictures\\holiday.jpg'), undefined);
  assert.equal(uploadUrl('/home/ann/.claude-code-webview/uploads/../secrets.png'), undefined);
});
