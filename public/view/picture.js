// @ts-check
// Pictures in the feed — screenshots attached to prompts, images in tool results — as thumbnails, and over the whole
// page when one is clicked.
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * An image from the transcript; a link to the viewer's server loads only when it scrolls into view.
 * @param {import('../model/entry.js').Image} image
 * @returns {HTMLImageElement}
 */
export function inlineImage(image) {
  const element = h('img', { className: 'inline-image', attrs: { alt: '', loading: 'lazy', decoding: 'async' } });
  element.src = image.url;
  element.addEventListener('click', () => showOverPage(image.url));
  return element;
}

/**
 * The picture over the whole page, fitted to the screen. A click on it shows it at its own size — scrolling when it is
 * larger — a click beside it, × or Esc close it.
 * @param {string} url
 */
function showOverPage(url) {
  const picture = h('img', { className: 'image-viewer-picture', attrs: { alt: '' } });
  picture.src = url;
  const closing = h('button', { className: 'icon-button image-viewer-close', title: 'Close (Esc)', attrs: { type: 'button', 'aria-label': 'Close' } }, [icon('cross')]);
  const viewer = h('div', { className: 'image-viewer', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Picture' } }, [picture, closing]);
  /** @param {KeyboardEvent} event */
  const onKey = (event) => {
    if (event.key !== 'Escape') return;
    // the page's own Esc — the file panel, a drawer — waits for the next one
    event.stopPropagation();
    event.preventDefault();
    close();
  };
  const close = () => {
    viewer.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  viewer.addEventListener('click', (event) => {
    if (event.target === picture) viewer.classList.toggle('own-size');
    else close();
  });
  window.addEventListener('keydown', onKey, true);
  document.body.append(viewer);
  closing.focus();
}
