// @ts-check
// The page's diagnostics, while the reader has them on (behind ⋯): what keeps a device's page slow, measured where it
// runs — how busy it was, by how late a clock it keeps ticked: frames asked for one after another to time them made a
// page with lamps lit draw all of itself sixty times a second, the very load it was to measure — a key's wait to be
// handled and drawn, a session switched to and drawn, how much
// the page changes, the requests it makes, how big it is, the device and the view's settings — summed up every so often
// and sent to the viewer, which writes them down (server/diagnostics.js). Nothing of the sessions' text goes.
import { summarizeDelays, summarizeLateness, summarizeRequests } from '../model/diagnostics.js';

/** A session switched to is watched this long: its first frame, and the page's worst standstill while it settles. */
const switchWatchMs = 3000;
/** The page's clock ticks this often: a tick late tells the page was busy meanwhile. */
const tickMs = 100;
/** The requests told, by path, at most. */
const requestPaths = 12;

/**
 * @typedef {{ firstFrameMs: number | undefined, worstGapMs: number, at: number }} Switch
 */

/**
 * @param {{ send: (report: Record<string, unknown>) => void, everyMs: number }} options — send: a report to the viewer;
 *   everyMs: how often one is summed up
 * @returns {{ turn: (on: boolean) => void }}
 */
export function createDiagnostics({ send, everyMs }) {
  /** @type {{ stop: () => void } | undefined} */
  let running;
  return {
    turn(on) {
      if (on && running === undefined) running = start(send, everyMs);
      if (!on && running !== undefined) {
        running.stop();
        running = undefined;
      }
    },
  };
}

/**
 * @param {(report: Record<string, unknown>) => void} send
 * @param {number} everyMs
 * @returns {{ stop: () => void }}
 */
function start(send, everyMs) {
  /** How late each tick of the clock came. */
  /** @type {number[]} */
  let lateness = [];
  /** @type {number[]} */
  let keysHandled = [];
  /** @type {number[]} */
  let keysDrawn = [];
  /** @type {Switch[]} */
  let watched = [];
  /** @type {{ firstFrameMs: number | undefined, worstGapMs: number }[]} */
  let switched = [];
  let mutations = 0;
  let due = performance.now() + tickMs;
  /** @type {ReturnType<typeof setTimeout>} */
  let tick;
  const onTick = () => {
    const now = performance.now();
    const late = Math.max(0, now - due);
    lateness.push(late);
    for (const one of watched) one.worstGapMs = Math.max(one.worstGapMs, Math.round(late));
    const settled = watched.filter((one) => now - one.at >= switchWatchMs);
    watched = watched.filter((one) => now - one.at < switchWatchMs);
    switched.push(...settled.map(({ firstFrameMs, worstGapMs }) => ({ firstFrameMs, worstGapMs })));
    due = now + tickMs;
    tick = setTimeout(onTick, tickMs);
  };
  tick = setTimeout(onTick, tickMs);
  // a page out of sight has its clock slowed by the browser: the time away is no lateness
  const onVisibility = () => {
    due = performance.now() + tickMs;
  };
  /** @param {KeyboardEvent} event */
  const onKey = (event) => {
    keysHandled.push(performance.now() - event.timeStamp);
    requestAnimationFrame((now) => keysDrawn.push(now - event.timeStamp));
  };
  const onSwitch = () => {
    /** @type {Switch} */
    const one = { at: performance.now(), firstFrameMs: undefined, worstGapMs: 0 };
    watched.push(one);
    // the first frame after it, timed as it runs: a frame's own time is when it began, which may be before the switch
    requestAnimationFrame(() => {
      one.firstFrameMs = Math.round(performance.now() - one.at);
    });
  };
  const observer = new MutationObserver((records) => {
    mutations += records.length;
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('hashchange', onSwitch);
  performance.setResourceTimingBufferSize(2000);
  performance.clearResourceTimings();
  // the requests begun since the last report: the page's own loading, kept over from a full buffer, is not one of them
  let since = performance.now();
  const timer = setInterval(() => {
    const requests = performance.getEntriesByType('resource').flatMap((entry) => (entry.startTime >= since ? [{ name: entry.name, duration: entry.duration }] : []));
    since = performance.now();
    performance.clearResourceTimings();
    send({
      seconds: everyMs / 1000,
      hidden: document.visibilityState === 'hidden',
      busy: summarizeLateness(lateness),
      keys: { handled: summarizeDelays(keysHandled), drawn: summarizeDelays(keysDrawn) },
      switches: switched,
      mutationsPerSecond: Math.round(mutations / (everyMs / 1000)),
      requests: summarizeRequests(requests, requestPaths),
      page: {
        // how long the page has lived, and how it was opened: a page the browser threw away and opened again starts
        // anew — the report before it tells what it held then
        upSeconds: Math.round(performance.now() / 1000),
        openedAs: performance.getEntriesByType('navigation').map((entry) => (entry instanceof PerformanceNavigationTiming ? entry.type : 'unknown'))[0] ?? 'unknown',
        elements: document.getElementsByTagName('*').length,
        feeds: [...document.querySelectorAll('.scroller')].map((scroller) => ({ parked: scroller.classList.contains('parked'), elements: scroller.getElementsByTagName('*').length })),
        session: location.hash,
      },
      device: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio, cores: navigator.hardwareConcurrency, touch: window.matchMedia('(pointer: coarse)').matches },
      view: { ...document.documentElement.dataset },
    });
    lateness = [];
    keysHandled = [];
    keysDrawn = [];
    switched = [];
    mutations = 0;
  }, everyMs);
  return {
    stop() {
      clearInterval(timer);
      clearTimeout(tick);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('hashchange', onSwitch);
    },
  };
}
