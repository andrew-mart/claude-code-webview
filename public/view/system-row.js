// @ts-check
// How busy the viewer's computer is, as a row of a session's details: on a phone, whose screen has no room for the
// meters in the tabs' row of a wider one (system-meters.js). The row asks the viewer only while it is in view — the
// details open on a narrow screen; a wide one never shows it (style.css) — and the page is in sight (polling.js).
import { h } from './dom.js';
import { pollWhileShown } from './polling.js';
import { createSystemMeters } from './system-meters.js';

/**
 * @typedef {import('./polling.js').PollingPage & { IntersectionObserver: new (seen: (entries: readonly { isIntersecting: boolean }[]) => void) => { observe: (target: Element) => void, disconnect: () => void } }} SystemRowPage
 */

/**
 * @param {{ page: SystemRowPage, read: () => Promise<import('../model/system-usage.js').SystemUsage | undefined>, readProcesses: (by: import('../model/system-usage.js').Resource) => Promise<import('../model/system-usage.js').ProcessUse[] | undefined>, everyMs: number }} options
 *   read — how busy the computer is now, nothing while the viewer does not tell; readProcesses — its processes, a meter
 *   pressed; everyMs — how often it is asked again while the row is in view
 * @returns {{ row: HTMLElement, dispose: () => void }}
 */
export function createSystemRow({ page, read, readProcesses, everyMs }) {
  const meters = createSystemMeters({ readProcesses });
  const name = h('dt', { text: 'Computer' });
  const row = h('div', { className: 'head-system' }, [name, h('dd', {}, [meters.element])]);
  /** @type {{ stop: () => void } | undefined} */
  let poll;
  const observer = new page.IntersectionObserver((entries) => {
    const inView = entries.some((entry) => entry.isIntersecting);
    if (inView && poll === undefined) poll = pollWhileShown(page, { ask: async () => meters.show(await read()), everyMs, first: 'now' });
    if (!inView && poll !== undefined) {
      poll.stop();
      poll = undefined;
    }
  });
  // the row lies in the details' grid with no box of its own (display: contents): its name has one while it shows
  observer.observe(name);
  return {
    row,
    dispose() {
      meters.close();
      observer.disconnect();
      poll?.stop();
      poll = undefined;
    },
  };
}
