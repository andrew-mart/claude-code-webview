// @ts-check
// Icons of files and folders on the page — Material Icon Theme's, from the viewer (server/file-icons.js). The theme is
// read the first time an icon is asked for; until it comes an icon is the plain file's or folder's.
import { iconFor, parseIconTheme } from '../model/file-icons.js';

/**
 * @typedef {(name: string, kind: 'file' | 'folder', open: boolean) => HTMLElement} IconOf — a file's or folder's icon,
 *   by its name
 */

/**
 * @param {{ light: () => boolean }} options — light: whether the page shows its light theme now
 * @returns {IconOf}
 */
export function createFileIcons({ light }) {
  const base = new URL('../vendor/file-icons/', import.meta.url);
  /** @type {import('../model/file-icons.js').IconTheme | undefined} */
  let theme;
  /** @type {Promise<void> | undefined} */
  let reading;
  const read = () => {
    reading ??= fetch(new URL('theme.json', base))
      .then((response) => response.json())
      .then((json) => {
        theme = parseIconTheme(json);
      })
      .catch(() => undefined);
    return reading;
  };
  /** @param {string} icon */
  const address = (icon) => new URL(`${icon}.svg`, base).href;
  return (name, kind, open) => {
    const image = document.createElement('img');
    image.className = 'file-icon';
    image.alt = '';
    image.decoding = 'async';
    image.setAttribute('aria-hidden', 'true');
    const pick = () => (theme === undefined ? undefined : iconFor(theme, { name, kind, open, light: light() }));
    const plain = kind === 'file' ? 'file' : open ? 'folder-open' : 'folder';
    image.src = address(pick() ?? plain);
    if (theme === undefined) {
      void read().then(() => {
        const icon = pick();
        if (icon !== undefined) image.src = address(icon);
      });
    }
    return image;
  };
}
