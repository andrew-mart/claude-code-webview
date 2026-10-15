// @ts-check
// An agent at work, as a little story — each workspace its own (model/stories.js), slow and soft, not to pull the eye:
//   assembly — a robot puts itself together part by part, then builds another — carrying each part over in its hand,
//              a spark as it is put in place — shakes its hand, turns sideways and walks off; the new one builds the
//              next in turn;
//   mine     — a robot swings a pickaxe at a rock: a coin jumps out onto a pile with each strike, and a "$" over it;
//   garden   — a robot waters a money tree: coins grow on it, fall into a heap, and are swept into a safe;
//   rocket   — a robot puts a rocket together, carrying each part over, counts down, sees it off and waves;
//   coffee   — a robot types code on a laptop, stops for a sip of coffee, steam rising, and types on;
//   pole     — a robot dances on a pole — sways, spins round it, climbs and slides down, kicks — and bills fly to it.
// Set out in depth to keep it narrow: the robot in front on the left, what it works on behind it, higher and to the
// right. The story goes on from how long the agent has been at work (work-clock.js), so a row drawn again does not
// start it over (style.css, .robots). Drawn in the colour around it, what the robot works on — the robot it builds, the
// rock, the tree and the safe, the rocket, the laptop, the pole — and the sparks in a fainter shade of it, as further
// off (.prop); the money it makes in its own.

/** The robot in front, on the left: its 24-unit square drawn smaller, low in the scene. */
const front = 'translate(0 6) scale(0.75)';
/** A second robot behind, on the right: the assembly's other place. */
const behind = 'translate(14 0) scale(0.75)';

/**
 * A spark where a part is put in place: four short rays round the point it is moved to.
 * @param {string} name
 */
const spark = (name) => `<path class="${name}" d="M0-2.2V-1M0 1V2.2M-2.2 0H-1M1 0H2.2" stroke-width="1.3"/>`;

/**
 * A robot's parts in its 24-unit square, each named for its animation — its legs under its body, going with it; its
 * right arm may hold something.
 * @param {string} name
 * @param {string} [rightArm] in place of the plain arm
 */
const robot = (name, rightArm = `<path class="${name}-arm-right" d="M18 15.5 21 18.5"/>`) => `<g class="${name}-body"><rect x="6" y="13" width="12" height="6" rx="2"/><path class="${name}-leg-left" d="M10 19V23"/><path class="${name}-leg-right" d="M14 19V23"/></g>
  <rect class="${name}-head" x="7" y="5" width="10" height="7" rx="2"/>
  <path class="${name}-arm-left" d="M6 15.5 3 18.5"/>
  ${rightArm}
  <path class="${name}-antenna" d="M12 5V2.5"/>
  <g class="${name}-eyes" fill="currentColor" stroke="none"><circle cx="10" cy="8.5" r="0.9"/><circle cx="14" cy="8.5" r="0.9"/></g>`;

/** @type {Readonly<Record<import('../model/stories.js').Story, string>>} */
const scenes = {
  assembly: `<g class="robots-intro"><g transform="${front}">${robot('intro')}${spark('intro-spark prop')}</g></g>
  <g class="robots-loop">
    <g class="right-walk prop"><g transform="${behind}">${robot('right')}</g></g>
    <g class="left-walk"><g transform="${front}">${robot('left')}</g></g>
    ${spark('pair-spark prop')}
  </g>`,
  mine: `<path class="mine-rock prop" d="M20.6 21.6 21.6 18 23.8 16.7 26.4 17.3 27.6 21.6Z"/>
  <path class="mine-sparks prop" d="M22.1 15.2 21.3 13.9M23.3 14.9 23.6 13.4M21 16.1 19.7 15.6" stroke-width="0.9"/>
  <g fill="currentColor" stroke="none"><ellipse class="mine-coin mine-coin-1" cx="30" cy="21.3" rx="1.7" ry="0.6"/><ellipse class="mine-coin mine-coin-2" cx="30" cy="20.05" rx="1.7" ry="0.6"/><ellipse class="mine-coin mine-coin-3" cx="30" cy="18.8" rx="1.7" ry="0.6"/><ellipse class="mine-coin mine-coin-4" cx="30" cy="17.55" rx="1.7" ry="0.6"/><circle class="mine-nugget" r="0.75"/></g>
  <path class="mine-dollar" d="M31.4 10.3C31 9.7 30.5 9.5 29.9 9.5C29 9.5 28.5 10 28.5 10.7C28.5 12.3 31.5 11.7 31.5 13.4C31.5 14.1 31 14.6 30.1 14.6C29.4 14.6 28.9 14.3 28.6 13.8M30 8.5V15.6" stroke-width="1.1"/>
  <g transform="${front}">${robot('mine', `<g class="mine-pick"><path d="M18 15.5 26 9.5"/><path d="M23.3 7.7Q26.7 8 28.3 11.3" stroke-width="1.6"/></g>`)}</g>`,
  garden: `<path class="garden-pot prop" d="M23 18H31L30.2 21.5H23.8Z"/>
  <path class="garden-stem prop" d="M27 18V8"/>
  <path class="garden-leaf-left prop" d="M27 14Q24.5 12 23 13.5Q25 15 27 14Z"/>
  <path class="garden-leaf-right prop" d="M27 11.5Q29.5 9.5 31 11Q29 12.5 27 11.5Z"/>
  <g class="garden-safe prop"><rect x="17.2" y="18.2" width="4" height="3.4" rx="0.7"/><g class="garden-dial"><circle cx="19.2" cy="20" r="0.8" stroke-width="0.8"/><path d="M19.2 20V19.3" stroke-width="0.7"/></g></g>
  <g fill="currentColor" stroke="none"><circle class="garden-coin garden-coin-1" cx="23.4" cy="10.2" r="1.15"/><circle class="garden-coin garden-coin-2" cx="30.5" cy="8.2" r="1.15"/><circle class="garden-coin garden-coin-3" cx="27" cy="5.6" r="1.15"/></g>
  <g transform="${front}">${robot('garden', `<g class="garden-can"><path d="M18 15.5 21 12.5"/><g class="prop"><rect x="21" y="10" width="5" height="4" rx="1"/><path d="M26 11 29.5 8.5"/></g></g>`)}</g>
  <g class="garden-drops prop" fill="currentColor" stroke="none"><circle class="garden-drop garden-drop-1" cx="22.8" cy="14.9" r="0.75"/><circle class="garden-drop garden-drop-2" cx="22.8" cy="14.9" r="0.75"/><circle class="garden-drop garden-drop-3" cx="22.8" cy="14.9" r="0.75"/></g>`,
  rocket: `<path class="rocket-pad prop" d="M20 17.5H31"/>
  <g class="ship prop">
    <path class="ship-fins" d="M23.6 11.5 22 15.5 23.6 14.6M27.4 11.5 29 15.5 27.4 14.6"/>
    <path class="ship-body" d="M25.5 1.5C27.6 4 27.8 9 27.4 14.5H23.6C23.2 9 23.4 4 25.5 1.5Z"/>
    <circle class="ship-window" cx="25.5" cy="7" r="1.1"/>
    <path class="ship-flame" d="M24.3 15Q25.5 19 26.7 15"/>
  </g>
  <g class="prop" fill="currentColor" stroke="none"><circle class="rocket-count rocket-count-1" cx="30.5" cy="3" r="0.7"/><circle class="rocket-count rocket-count-2" cx="30.5" cy="5.5" r="0.7"/><circle class="rocket-count rocket-count-3" cx="30.5" cy="8" r="0.7"/></g>
  <g transform="${front}">${robot('rocket', `<path class="rocket-arm" d="M18 15.5 21 18.5"/>`)}</g>
  ${spark('ship-spark prop')}`,
  coffee: `<path class="coffee-laptop prop" d="M17 10.5V2a1 1 0 0 1 1-1H30a1 1 0 0 1 1 1V10.5M15.5 12H32"/>
  <path class="coffee-line coffee-line-1 prop" d="M19 3.8H25"/>
  <path class="coffee-line coffee-line-2 prop" d="M19 6H28"/>
  <path class="coffee-line coffee-line-3 prop" d="M21 8.2H25"/>
  <g transform="${front}">${robot('coffee')}</g>
  <g class="coffee-mug"><path d="M16.5 18V21.5H19.5V18ZM19.5 18.8h.9v1.4h-.9"/></g>
  <path class="coffee-steam coffee-steam-1" d="M17.4 17q-.8-1.2 0-2.4" stroke-width="0.9"/>
  <path class="coffee-steam coffee-steam-2" d="M18.7 17q.8-1.2 0-2.4" stroke-width="0.9"/>`,
  pole: `<path class="pole-stage prop" d="M2.5 22.6H29.5" stroke-width="1.4"/>
  <path class="pole-pole prop" d="M16 0.8V22.6" stroke-width="1.2"/>
  <g class="pole-dancer"><g transform="translate(0.25 5.3) scale(0.75)">${robot('pole', `<path class="pole-arm-right" d="M18 15.5 21 11"/>`)}</g></g>
  <path class="pole-front prop" d="M16 0.8V22.6" stroke-width="1.2"/>
  <g class="pole-bill pole-bill-1"><rect x="-2.3" y="-1.3" width="4.6" height="2.6" rx="0.4" stroke-width="0.8"/><circle r="0.65" fill="currentColor" stroke="none"/></g><g class="pole-bill pole-bill-2"><rect x="-2.3" y="-1.3" width="4.6" height="2.6" rx="0.4" stroke-width="0.8"/><circle r="0.65" fill="currentColor" stroke="none"/></g><g class="pole-bill pole-bill-3"><rect x="-2.3" y="-1.3" width="4.6" height="2.6" rx="0.4" stroke-width="0.8"/><circle r="0.65" fill="currentColor" stroke="none"/></g><g class="pole-bill pole-bill-4"><rect x="-2.3" y="-1.3" width="4.6" height="2.6" rx="0.4" stroke-width="0.8"/><circle r="0.65" fill="currentColor" stroke="none"/></g>`,
};

/** Each story parsed once, cloned for each agent. */
const templates = Object.fromEntries(
  Object.entries(scenes).map(([story, scene]) => {
    const holder = document.createElement('span');
    // the markup is this file's constant, not data
    holder.innerHTML = `<svg class="robots story-${story}" viewBox="0 0 32 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${scene}</svg>`.replace(/>\s+</g, '><');
    return [story, holder.firstElementChild];
  }),
);

/**
 * @param {import('../model/stories.js').Story} story — its workspace's (stories.js)
 * @param {number} elapsed — how long it has been at work, in milliseconds: the story goes on from there
 * @returns {Element}
 */
export function workingRobots(story, elapsed) {
  const copy = templates[story]?.cloneNode(true);
  if (!(copy instanceof window.SVGSVGElement)) throw new Error(`No story to draw: ${story}`);
  copy.style.setProperty('--elapsed', `${Math.max(0, Math.round(elapsed))}ms`);
  return copy;
}
