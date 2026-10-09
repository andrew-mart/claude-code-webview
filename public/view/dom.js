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
 * A base64 image that Claude Code stored in the transcript.
 * @param {{ mediaType: string, data: string }} image
 * @returns {HTMLImageElement}
 */
export function inlineImage(image) {
  const element = h('img', { className: 'inline-image', attrs: { alt: '', loading: 'lazy' } });
  element.src = `data:${image.mediaType};base64,${image.data}`;
  element.addEventListener('click', () => element.classList.toggle('zoomed'));
  return element;
}
