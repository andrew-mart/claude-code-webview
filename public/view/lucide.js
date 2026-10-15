// @ts-check
// Lucide's icons, drawn from its sprite (server/app.js: vendor) put into the page once — the first time one is drawn:
// an outer sprite file is asked for again by every icon that uses it — each symbol's id prefixed, apart from the page's
// own ids. The page holds the sprite; drawn before it comes, an icon draws itself once it does.

const svgNs = 'http://www.w3.org/2000/svg';
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
  putSprite();
  const svg = document.createElementNS(svgNs, 'svg');
  for (const [attribute, value] of Object.entries({ class: 'lucide-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(attribute, value);
  if (color !== undefined) svg.setAttribute('data-color', color);
  const use = document.createElementNS(svgNs, 'use');
  use.setAttribute('href', `#${prefix}${name}`);
  svg.append(use);
  return svg;
}

/** The sprite into the page, once: its holder goes in at once, its symbols once they come. */
function putSprite() {
  if (document.querySelector('svg.lucide-sprite') !== null) return;
  const holder = document.createElementNS(svgNs, 'svg');
  holder.setAttribute('class', 'lucide-sprite');
  holder.setAttribute('aria-hidden', 'true');
  document.body.prepend(holder);
  void fetch(sprite)
    .then((reply) => (reply.ok ? reply.text() : ''))
    .then((text) => {
      const symbols = new window.DOMParser().parseFromString(text, 'image/svg+xml').querySelectorAll('symbol');
      for (const symbol of symbols) symbol.id = `${prefix}${symbol.id}`;
      holder.append(...[...symbols].map((symbol) => document.adoptNode(symbol)));
    })
    .catch(() => undefined); // out of the viewer's reach: the icons stay blank
}
