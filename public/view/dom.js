// @ts-check
// Shorthand for creating DOM elements.

/**
 * @typedef {{ className?: string, text?: string, title?: string, attrs?: Readonly<Record<string, string>> }} Props
 */

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Props} [props]
 * @param {readonly (Node | string)[]} [children]
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, props = {}, children = []) {
  const element = document.createElement(tag);
  if (props.className !== undefined) element.className = props.className;
  if (props.text !== undefined) element.textContent = props.text;
  if (props.title !== undefined) element.title = props.title;
  for (const [name, value] of Object.entries(props.attrs ?? {})) element.setAttribute(name, value);
  element.append(...children);
  return element;
}

/**
 * An image from the transcript; a link to the viewer's server loads only when it scrolls into view.
 * @param {import('../model/entry.js').Image} image
 * @returns {HTMLImageElement}
 */
export function inlineImage(image) {
  const element = h('img', { className: 'inline-image', attrs: { alt: '', loading: 'lazy', decoding: 'async' } });
  element.src = image.url;
  element.addEventListener('click', () => element.classList.toggle('zoomed'));
  return element;
}
