// @ts-check
// A finished agent, its answer not seen yet: a goofy robot's face, tilted — its antenna bent and wobbling, one eye a
// little ring with its pupil wandering off, the other big, glowing green and blinking until the answer is seen, a
// lopsided grin with its tongue out and wagging — and beside it, on the right, its workspace's joke (model/stories.js):
// a thumb up, a joint smoking from its grin, a cocktail raised, a party popper going off, notes it hums (style.css,
// .rests). Small, beside its row.
import { jokes } from '../model/stories.js';

const face = `<g transform="rotate(-7 12 12)">
    <g class="rests-antenna"><path d="M12 5.5 11 3.4 13.2 2.2"/><circle cx="13.6" cy="1.9" r="1.1" fill="currentColor" stroke="none"/></g>
    <rect x="4" y="5.5" width="16" height="13" rx="3.5"/>
    <path d="M2.4 10v3.6M21.6 9.4v4.6"/>
    <circle cx="8.6" cy="10.9" r="1.9" stroke-width="1.3"/>
    <circle class="rests-pupil" cx="8.6" cy="10.9" r="0.8" fill="currentColor" stroke="none"/>
    <circle class="rests-halo" cx="15.3" cy="10.5" r="4.1" stroke="none"/>
    <circle class="rests-eye" cx="15.3" cy="10.5" r="2.5" stroke="none"/>
    <path d="M7.6 15.2Q10.5 17.6 15.6 14.6"/>
    <path class="rests-tongue" d="M12.4 16.2Q12.9 18.6 14.3 17.9Q14.9 17.4 14.4 15.6" stroke-width="1.3"/>
  </g>`;

/** @type {Readonly<Record<import('../model/stories.js').Joke, string>>} */
const sides = {
  // Feather's thumbs-up, smaller
  'thumbs-up': `<g class="joke-hand"><path transform="translate(23.4 11.2) scale(0.4)" stroke-width="3.6" d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></g>`,
  joint: `<g class="joke-joint"><path d="M15.9 14.1 24.4 15.7" stroke-width="1.5"/><circle class="joke-ember" cx="24.9" cy="15.8" r="1.05" stroke="none"/></g>
    <path class="joke-smoke joke-smoke-1" d="M25.4 13.8q-1.1-1.3 0-2.6t0-2.6" stroke-width="0.9"/>
    <path class="joke-smoke joke-smoke-2" d="M25.4 13.8q1.1-1.3 0-2.6t0-2.6" stroke-width="0.9"/>`,
  cocktail: `<g class="joke-glass"><path d="M23.8 9.4H31L27.4 13.6Z"/><path d="M27.4 13.6V19.6M25.4 19.8H29.4"/><circle cx="28.9" cy="10.7" r="0.85" fill="currentColor" stroke="none"/><path d="M26.4 10.6 24.8 5.6" stroke-width="1"/>
    <circle class="joke-bubble joke-bubble-1" cx="26.6" cy="8.4" r="0.5" fill="currentColor" stroke="none"/>
    <circle class="joke-bubble joke-bubble-2" cx="28" cy="8.4" r="0.4" fill="currentColor" stroke="none"/></g>`,
  popper: `<path class="joke-cone" d="M24 22.6 26.4 15.8 30.6 19ZM25.2 19.2 27.3 20.8" stroke-width="1.4"/>
    <g stroke="none"><rect class="joke-bit joke-bit-1" x="27.8" y="16.8" width="1.4" height="0.9" rx="0.3"/><rect class="joke-bit joke-bit-2" x="27.8" y="16.8" width="1.2" height="1.2" rx="0.3"/><circle class="joke-bit joke-bit-3" cx="28.4" cy="17.3" r="0.6"/><rect class="joke-bit joke-bit-4" x="27.8" y="16.8" width="0.9" height="1.4" rx="0.3"/><circle class="joke-bit joke-bit-5" cx="28.4" cy="17.3" r="0.55"/></g>
    <path class="joke-streamer" d="M28.4 17.2q1.6-2 .2-3.4t.6-3.6" stroke-width="0.9"/>`,
  notes: `<g class="joke-note joke-note-1"><path d="M27.2 12.2V6.6L30 5.8V7.2" stroke-width="1"/><ellipse cx="26.1" cy="12.4" rx="1.35" ry="1" fill="currentColor" stroke="none"/></g>
    <g class="joke-note joke-note-2"><path d="M27.2 12.2V7.2" stroke-width="1"/><ellipse cx="26.1" cy="12.4" rx="1.2" ry="0.9" fill="currentColor" stroke="none"/></g>`,
};

/** Each face parsed once, with its joke, cloned for each finished agent. */
const templates = Object.fromEntries(
  jokes.map((joke) => {
    const holder = document.createElement('span');
    // the markup is this file's constant, not data
    holder.innerHTML = `<svg class="rests joke-${joke}" viewBox="0 0 32 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${face}${sides[joke]}</svg>`.replace(/>\s+</g, '><');
    return [joke, holder.firstElementChild];
  }),
);

/**
 * @param {import('../model/stories.js').Joke} joke — its workspace's (stories.js)
 * @returns {Element}
 */
export function restingRobot(joke) {
  const copy = templates[joke]?.cloneNode(true);
  if (!(copy instanceof window.SVGSVGElement)) throw new Error(`No face to draw: ${joke}`);
  return copy;
}
