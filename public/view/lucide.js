// @ts-check
// Lucide's icons, each drawn from a symbol the page holds (an outer file's would be asked for again by every icon that
// uses it), its id prefixed apart from the page's own ids. The page holds only the icons it draws — each asked for on
// its own the first time (server/app.js: Lucide's icons one by one) — not the whole set: some two thousand, nine
// thousand elements, most never drawn. Drawn before its drawing comes, an icon draws itself once it does.

const svgNs = 'http://www.w3.org/2000/svg';
const icons = new URL('../vendor/lucide/icons/', import.meta.url).href;
const sprite = new URL('../vendor/lucide/sprite.svg', import.meta.url).href;
const prefix = 'lucide-';

/**
 * An icon of Lucide's, in a colour of the palette (style.css: .lucide-icon[data-color]) — without one, in the colour
 * around it.
 * @param {string} name
 * @param {string | undefined} color
 * @returns {SVGSVGElement}
 */
export function lucideIcon(name, color) {
  putSymbol(name);
  const svg = document.createElementNS(svgNs, 'svg');
  for (const [attribute, value] of Object.entries({ class: 'lucide-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(attribute, value);
  if (color !== undefined) svg.setAttribute('data-color', color);
  const use = document.createElementNS(svgNs, 'use');
  use.setAttribute('href', `#${prefix}${name}`);
  svg.append(use);
  return svg;
}

/**
 * The icon's symbol into the page, once: at once, empty — another icon of the name drawn meanwhile asks for nothing
 * more — its drawing once its file comes.
 * @param {string} name
 */
function putSymbol(name) {
  const id = `${prefix}${name}`;
  if (document.getElementById(id) !== null) return;
  const symbol = document.createElementNS(svgNs, 'symbol');
  symbol.id = id;
  symbol.setAttribute('viewBox', '0 0 24 24');
  holder().append(symbol);
  void fetch(`${icons}${encodeURIComponent(name)}.svg`)
    .then((reply) => (reply.ok ? reply.text() : ''))
    .then((text) => {
      const drawing = new window.DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
      if (drawing.localName === 'svg') symbol.append(...[...drawing.children].map((part) => document.adoptNode(part)));
    })
    .catch(() => undefined); // out of the viewer's reach: the icon stays blank
}

/** The page's holder of the symbols, put in the first time one is. */
function holder() {
  const there = document.querySelector('svg.lucide-sprite');
  if (there !== null) return there;
  const made = document.createElementNS(svgNs, 'svg');
  made.setAttribute('class', 'lucide-sprite');
  made.setAttribute('aria-hidden', 'true');
  document.body.prepend(made);
  return made;
}

/**
 * The whole set into the page — the icon picker shows it all — in one file: the symbols not in the page yet, those
 * there kept as they are. Out of the viewer's reach, those at hand only.
 * @returns {Promise<void>}
 */
export async function putAllLucideIcons() {
  const text = await fetch(sprite)
    .then((reply) => (reply.ok ? reply.text() : ''))
    .catch(() => '');
  const symbols = [...new window.DOMParser().parseFromString(text, 'image/svg+xml').querySelectorAll('symbol')];
  for (const symbol of symbols) symbol.id = `${prefix}${symbol.id}`;
  holder().append(...symbols.filter((symbol) => document.getElementById(symbol.id) === null).map((symbol) => document.adoptNode(symbol)));
}
