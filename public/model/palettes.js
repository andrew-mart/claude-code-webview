// @ts-check
// Palettes: the accent colour of the page and of its tab icon. Two viewers — on two computers, say — open side by side
// are told apart at a glance. The colours themselves are in style.css and favicons/.

/** clay — Claude's own, the default; the others for a second viewer and more. */
export const palettes = /** @type {const} */ (['clay', 'sea', 'moss', 'plum']);

/** @typedef {typeof palettes[number]} Palette */

/**
 * @param {string} name
 * @returns {Palette | undefined}
 */
export function paletteNamed(name) {
  return palettes.find((palette) => palette === name);
}
