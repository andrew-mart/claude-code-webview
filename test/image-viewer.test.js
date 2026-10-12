import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
// The icons are drawn when their module loads: the DOM is set up before it.
Object.assign(globalThis, { window, document: window.document });
const { inlineImage } = await import('../public/view/picture.js');

const url = '/api/image?session=3f2c9a50-1111-4222-8333-944455556666&at=120&n=0';

/** A picture in the feed, as a prompt with an attached screenshot shows it. */
function pictureInFeed() {
  const picture = inlineImage({ url });
  window.document.body.append(picture);
  return picture;
}

/** The viewer over the page, if it is open. */
const viewer = () => window.document.querySelector('.image-viewer');

// A picture in the feed is a thumbnail: a click shows it over the whole page, a click on it there shows it at its own
// size, and a click beside it closes the view
test('inlineImage_Should_OpenPictureOverPage_ShowItsOwnSizeOnClick_And_CloseOnClickBeside', () => {
  pictureInFeed().click();
  const shown = viewer()?.querySelector('img')?.getAttribute('src');
  viewer()?.querySelector('img')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const ownSize = viewer()?.classList.contains('own-size');
  viewer()?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  assert.deepEqual({ shown, ownSize, open: viewer() !== null }, { shown: url, ownSize: true, open: false });
});

// Esc closes the picture alone: the page's own Esc — closing the file panel or a drawer — waits for the next one
test('inlineImage_Should_ClosePictureWithEscape_WithoutPageHearingIt', () => {
  /** @type {string[]} */
  const heard = [];
  const listener = (/** @type {KeyboardEvent} */ event) => heard.push(event.key);
  window.document.addEventListener('keydown', listener);
  pictureInFeed().click();

  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  window.document.removeEventListener('keydown', listener);

  assert.deepEqual({ open: viewer() !== null, heard }, { open: false, heard: [] });
});
