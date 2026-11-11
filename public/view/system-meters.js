// @ts-check
// How busy the viewer's computer is, in the corner of the tabs' row: the processors busy, in a share; the memory and the
// graphics card's memory, in GB taken of all, the card's load in a share after it — each with a short bar of its share
// or memory, red when nearly full — the details on hover; in a narrow row each in a share alone, the card its load, for
// the tabs to have room (style.css). A computer with no card shows none; nothing heard from the viewer, nothing at all;
// and they give way while the side panel shows a document. A meter pressed lists the computer's processes under it, the
// busiest with its resource first, asked for again every few seconds while the list shows; pressed again, Escape or a
// press elsewhere, the list goes.
import { h } from './dom.js';
import { pollWhileShown } from './polling.js';

/** A share at or past this percent is nearly full. */
const fullFrom = 90;
const gib = 1024 ** 3;
const mib = 1024 ** 2;
/** The processes are asked for again this often while their list shows. */
const processesEveryMs = 3000;

/** @param {number} bytes */
const inGb = (bytes) => (bytes / gib).toFixed(1);
/** @param {number} mebibytes */
const mibInGb = (mebibytes) => (mebibytes / 1024).toFixed(1);
/** @param {number} bytes */
const memoryWords = (bytes) => (bytes >= gib ? `${inGb(bytes)} GB` : `${Math.round(bytes / mib)} MB`);

/**
 * @typedef {import('../model/system-usage.js').Resource} Resource
 * @typedef {import('../model/system-usage.js').ProcessUse} ProcessUse
 */

/**
 * @param {{ readProcesses: (by: Resource) => Promise<ProcessUse[] | undefined> }} deps — the computer's processes, the
 *   busiest with a resource first; nothing while the viewer does not tell
 */
export function createSystemMeters({ readProcesses }) {
  /** @param {string} name @param {Resource} resource */
  const meter = (name, resource) => {
    const value = h('span', { className: 'system-meter-value' });
    const short = h('span', { className: 'system-meter-short' });
    const fill = h('span', { className: 'system-meter-fill' });
    const element = h('button', { className: 'system-meter', attrs: { type: 'button', 'aria-expanded': 'false' } }, [h('span', { className: 'system-meter-name', text: name }), h('span', { className: 'system-meter-bar' }, [fill]), value, short]);
    element.addEventListener('click', () => press(resource));
    return {
      element,
      resource,
      /**
       * @param {number} percent — how full its bar is @param {string} words — beside the bar @param {string} details — on
       * hover @param {number} share — in a narrow row, beside the bar in place of the words
       */
      show(percent, words, details, share) {
        const shown = Math.max(0, Math.min(100, Math.round(percent)));
        value.textContent = words;
        short.textContent = `${Math.round(share)}%`;
        fill.style.width = `${shown}%`;
        element.classList.toggle('full', shown >= fullFrom);
        element.title = details;
      },
    };
  };
  const cpu = meter('CPU', 'cpu');
  const ram = meter('RAM', 'memory');
  const gpu = meter('GPU', 'gpu');
  const list = h('div', { className: 'system-processes', attrs: { hidden: '', role: 'dialog', 'aria-label': "The computer's processes" } });
  const element = h('div', { className: 'system-meters', attrs: { hidden: '' } }, [cpu.element, ram.element, gpu.element, list]);
  /** Whether the viewer told how busy the computer is, the last time it was asked. */
  let told = false;
  /** Whether they give way to a document the side panel shows. */
  let away = false;
  /** What the list shows the processes by while it shows, and its asking for them. */
  /** @type {{ by: Resource, poll: { stop: () => void } } | undefined} */
  let listed;

  const place = () => {
    element.hidden = away || !told;
  };
  /**
   * @param {Resource} by
   * @param {ProcessUse[] | undefined} processes
   */
  const draw = (by, processes) => {
    if (listed?.by !== by) return;
    if (processes === undefined) {
      list.replaceChildren(h('div', { className: 'system-processes-note', text: 'The viewer did not tell its processes.' }));
      return;
    }
    list.replaceChildren(
      ...processes.map((one) => {
        const [first, then] = by === 'cpu' ? [`${one.cpu}%`, memoryWords(one.memory)] : by === 'memory' ? [memoryWords(one.memory), `${one.cpu}%`] : [`${one.gpu === undefined ? 0 : one.gpu}%`, memoryWords(one.memory)];
        return h('div', { className: 'system-process', title: `${one.name} — process ${one.pid}` }, [h('span', { className: 'system-process-name', text: one.name }), h('span', { className: 'system-process-value', text: first }), h('span', { className: 'system-process-other', text: then })]);
      }),
    );
  };
  const close = () => {
    listed?.poll.stop();
    listed = undefined;
    list.hidden = true;
    for (const one of [cpu, ram, gpu]) one.element.setAttribute('aria-expanded', 'false');
    window.document.removeEventListener('pointerdown', onPressElsewhere, true);
    window.document.removeEventListener('keydown', onEscape, true);
  };
  /** @param {Event} event */
  const onPressElsewhere = (event) => {
    if (event.target instanceof window.Node && !element.contains(event.target)) close();
  };
  /** @param {KeyboardEvent} event */
  const onEscape = (event) => {
    if (event.key === 'Escape') close();
  };
  /** @param {Resource} by */
  const press = (by) => {
    const again = listed?.by === by;
    close();
    if (again) return;
    for (const one of [cpu, ram, gpu]) one.element.setAttribute('aria-expanded', String(one.resource === by));
    list.replaceChildren(h('div', { className: 'system-processes-note', text: by === 'gpu' ? 'Reading the processes… the card takes a few seconds' : 'Reading the processes…' }));
    list.hidden = false;
    listed = { by, poll: pollWhileShown(window, { ask: async () => draw(by, await readProcesses(by)), everyMs: processesEveryMs, first: 'now' }) };
    window.document.addEventListener('pointerdown', onPressElsewhere, true);
    window.document.addEventListener('keydown', onEscape, true);
  };

  return {
    element,
    /** @param {boolean} documentShown — whether the side panel shows a document, which takes the corner's room */
    giveWay(documentShown) {
      away = documentShown;
      if (away) close();
      place();
    },
    /** @param {import('../model/system-usage.js').SystemUsage | undefined} usage */
    show(usage) {
      told = usage !== undefined;
      place();
      if (usage === undefined) return;
      const busy = Math.round(usage.cpu);
      cpu.show(busy, `${busy}%`, `Processors: ${busy}% busy`, busy);
      const { used, total } = usage.memory;
      const taken = total > 0 ? (used / total) * 100 : 0;
      ram.show(taken, `${inGb(used)}/${inGb(total)} GB`, `Memory: ${inGb(used)} of ${inGb(total)} GB taken`, taken);
      gpu.element.hidden = usage.gpu === undefined;
      if (usage.gpu !== undefined) {
        const { load, memoryUsed, memoryTotal } = usage.gpu;
        gpu.show(memoryTotal > 0 ? (memoryUsed / memoryTotal) * 100 : 0, `${mibInGb(memoryUsed)}/${mibInGb(memoryTotal)} GB · ${Math.round(load)}%`, `Graphics card: ${Math.round(load)}% busy, ${mibInGb(memoryUsed)} of ${mibInGb(memoryTotal)} GB of its memory taken`, load);
      }
    },
    /** The list of processes put away, its asking stopped: the meters let go of. */
    close,
  };
}
