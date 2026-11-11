import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, { window, document: window.document });
const { createSystemMeters } = await import('../public/view/system-meters.js');
const { parseSystemProcesses, parseSystemUsage } = await import('../public/model/system-usage.js');

const gib = 1024 ** 3;
const mib = 1024 ** 2;
/** Meters whose processes the tests do not ask for. */
const noProcesses = { readProcesses: async () => undefined };
/** Lets the processes asked for come. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

// The viewer's reply read: how busy the processors are, the memory taken, the card's load and memory if it has one;
// a reply that is none of it, nothing
test('parseSystemUsage_Should_ReadProcessorsMemoryAndCard_OrNothing', () => {
  assert.deepEqual(
    [
      parseSystemUsage({ cpu: 31, memory: { used: 24 * gib, total: 32 * gib }, gpu: { load: 12, memoryUsed: 1600, memoryTotal: 8192 } }),
      parseSystemUsage({ cpu: 31, memory: { used: 24 * gib, total: 32 * gib } }),
      parseSystemUsage({ cpu: 'busy' }),
      parseSystemUsage(undefined),
    ],
    [
      { cpu: 31, memory: { used: 24 * gib, total: 32 * gib }, gpu: { load: 12, memoryUsed: 1600, memoryTotal: 8192 } },
      { cpu: 31, memory: { used: 24 * gib, total: 32 * gib }, gpu: undefined },
      undefined,
      undefined,
    ],
  );
});

// In the corner: the processors, busy in a share, the memory and the card's memory in GB taken of all — the card's load
// after it, its bar its memory — each bar red when nearly full, the details on hover; in a narrow row, each in a share
// alone — the card its load — for the tabs to have room; a computer with no card shows none, and nothing heard from the
// viewer shows nothing at all
test('systemMeters_Should_ShowProcessorsMemoryAndCard_DetailsOnHover', () => {
  const meters = createSystemMeters(noProcesses);
  /** @param {Element} meter @param {string} part */
  const said = (meter, part) => meter.querySelector(`.system-meter-${part}`)?.textContent;
  /** @param {HTMLElement} element */
  const seen = (element) => [...element.querySelectorAll('.system-meter')].filter((meter) => !(meter instanceof window.HTMLElement && meter.hidden)).map((meter) => ({ words: `${said(meter, 'name')} ${said(meter, 'value')}`, short: said(meter, 'short'), hover: meter.getAttribute('title'), full: meter.classList.contains('full') }));

  meters.show({ cpu: 31, memory: { used: 30 * gib, total: 32 * gib }, gpu: { load: 95, memoryUsed: 1600, memoryTotal: 8192 } });
  const all = seen(meters.element);
  meters.show({ cpu: 8, memory: { used: 12 * gib, total: 64 * gib }, gpu: undefined });
  const noCard = seen(meters.element);
  meters.show(undefined);

  assert.deepEqual(
    { all, noCard, hidden: meters.element.hidden },
    {
      all: [
        { words: 'CPU 31%', short: '31%', hover: 'Processors: 31% busy', full: false },
        { words: 'RAM 30.0/32.0 GB', short: '94%', hover: 'Memory: 30.0 of 32.0 GB taken', full: true },
        { words: 'GPU 1.6/8.0 GB · 95%', short: '95%', hover: 'Graphics card: 95% busy, 1.6 of 8.0 GB of its memory taken', full: false },
      ],
      noCard: [
        { words: 'CPU 8%', short: '8%', hover: 'Processors: 8% busy', full: false },
        { words: 'RAM 12.0/64.0 GB', short: '19%', hover: 'Memory: 12.0 of 64.0 GB taken', full: false },
      ],
      hidden: true,
    },
  );
});

// A document in the side panel takes the corner's room: the meters give way while it is shown — a reading meanwhile
// leaves them away — and come back once it is put away or a list shows in its place
test('systemMeters_Should_GiveWayToDocumentInSidePanel_AndComeBack', () => {
  const meters = createSystemMeters(noProcesses);
  const usage = { cpu: 31, memory: { used: 12 * gib, total: 32 * gib }, gpu: undefined };
  meters.show(usage);

  meters.giveWay(true);
  const away = meters.element.hidden;
  meters.show(usage);
  const readMeanwhile = meters.element.hidden;
  meters.giveWay(false);

  assert.deepEqual({ away, readMeanwhile, back: meters.element.hidden }, { away: true, readMeanwhile: true, back: false });
});

// The viewer's list of processes read: each one's name and id, its share of the processors, its memory, its load of the
// card when the list is by it; a reply that is no list, nothing
test('parseSystemProcesses_Should_ReadEachProcess_OrNothing', () => {
  assert.deepEqual(
    [
      parseSystemProcesses({ by: 'gpu', processes: [{ pid: 41, name: 'node.exe', cpu: 12, memory: 100 * mib, gpu: 3 }, { pid: 'x' }] }),
      parseSystemProcesses({ by: 'cpu', processes: [{ pid: 41, name: 'node.exe', cpu: 12, memory: 100 * mib }] }),
      parseSystemProcesses('Bad resource'),
    ],
    [[{ pid: 41, name: 'node.exe', cpu: 12, memory: 100 * mib, gpu: 3 }], [{ pid: 41, name: 'node.exe', cpu: 12, memory: 100 * mib, gpu: undefined }], undefined],
  );
});

// A meter pressed lists the computer's processes, the busiest with its resource first: its value beside each name, then
// another to compare by; another meter pressed, the list is by its resource; pressed again, the list goes
test('systemMeters_Should_ListTheProcessesByTheMetersResource_WhenPressed', async () => {
  /** @type {string[]} */
  const asked = [];
  const meters = createSystemMeters({
    readProcesses: async (by) => {
      asked.push(by);
      return by === 'cpu'
        ? [
            { pid: 41, name: 'node.exe', cpu: 50, memory: 1.5 * gib, gpu: undefined },
            { pid: 77, name: 'chrome.exe', cpu: 10, memory: 300 * mib, gpu: undefined },
          ]
        : [{ pid: 77, name: 'chrome.exe', cpu: 10, memory: 300 * mib, gpu: undefined }];
    },
  });
  window.document.body.append(meters.element);
  meters.show({ cpu: 31, memory: { used: 24 * gib, total: 32 * gib }, gpu: undefined });
  /** @param {string} name */
  const press = (name) => {
    const meter = [...meters.element.querySelectorAll('.system-meter')].find((one) => one.querySelector('.system-meter-name')?.textContent === name);
    assert.ok(meter instanceof window.HTMLElement, `no meter ${name}`);
    meter.click();
  };
  const listed = () => {
    const list = meters.element.querySelector('.system-processes');
    return list instanceof window.HTMLElement && !list.hidden ? [...list.querySelectorAll('.system-process')].map((row) => [...row.children].map((part) => part.textContent)) : undefined;
  };

  press('CPU');
  await settle();
  const byCpu = listed();
  press('RAM');
  await settle();
  const byMemory = listed();
  press('RAM');
  await settle();
  const pressedAgain = listed();
  meters.element.remove();

  assert.deepEqual(
    { asked, byCpu, byMemory, pressedAgain },
    {
      asked: ['cpu', 'memory'],
      byCpu: [
        ['node.exe', '50%', '1.5 GB'],
        ['chrome.exe', '10%', '300 MB'],
      ],
      byMemory: [['chrome.exe', '300 MB', '10%']],
      pressedAgain: undefined,
    },
  );
});
