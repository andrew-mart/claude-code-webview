// @ts-check
// An agent idle — its answer seen, or nothing done yet: a robot unplugged from its power, standing still — its head
// drooping, its eyes out, its antenna bent down, its arms hanging — its cord running along the floor to a plug lying
// beside the socket on the right. Dim and still, no glow (style.css, .unplugged). Small, beside its row.

const scene = `<g transform="translate(0 6) scale(0.75)">
    <rect x="6" y="13" width="12" height="6" rx="2"/>
    <path d="M10 19V23M14 19V23"/>
    <path d="M6 15.5 5.2 19.8M18 15.5 18.8 19.8"/>
    <g transform="rotate(14 12 12)">
      <rect x="7" y="5" width="10" height="7" rx="2"/>
      <path d="M12 5Q12.6 2.6 15 3.4"/>
      <path d="M9.2 8.8H10.8M13.2 8.8H14.8" stroke-width="1.4"/>
    </g>
  </g>
  <path d="M13.6 19.4C15 22.4 16.4 22.6 18.4 22.6H21.4" stroke-width="1.2"/>
  <rect x="21.4" y="20.9" width="2.6" height="2.6" rx="0.6" stroke-width="1.2"/>
  <path d="M24 21.7H25.2M24 22.7H25.2" stroke-width="0.8"/>
  <rect x="27.4" y="14.6" width="3.6" height="5.2" rx="0.9" stroke-width="1.2"/>
  <g fill="currentColor" stroke="none"><circle cx="29.2" cy="16.5" r="0.45"/><circle cx="29.2" cy="17.9" r="0.45"/></g>`;

/** The drawing parsed once, cloned for each idle agent. */
const template = (() => {
  const holder = document.createElement('span');
  // the markup is this file's constant, not data
  holder.innerHTML = `<svg class="unplugged" viewBox="0 0 32 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${scene}</svg>`.replace(/>\s+</g, '><');
  return holder.firstElementChild;
})();

/** @returns {Element} */
export function unpluggedRobot() {
  const copy = template?.cloneNode(true);
  if (!(copy instanceof window.SVGSVGElement)) throw new Error('No unplugged robot to draw');
  return copy;
}
