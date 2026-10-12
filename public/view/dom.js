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
