// @ts-check
// How busy the viewer's computer is, for the page's corner: its processors since the last look, its memory taken, and
// its NVIDIA cards as nvidia-smi tells them — none on a computer without one, which is not asked again.
import { execFile } from 'node:child_process';
import { cpus, freemem, totalmem } from 'node:os';

/**
 * @typedef {{ load: number, memoryUsed: number, memoryTotal: number }} GpuUsage — load: percent, the busiest card's;
 *   memory: MiB, all the cards' together
 * @typedef {{ cpu: number, memory: { used: number, total: number }, gpu: GpuUsage | undefined }} SystemUsage — cpu:
 *   percent of the processors' time spent working since the last look; memory: bytes
 * @typedef {{ busy: number, total: number }} CpuTimes — the processors' time so far, working and in all, ms
 */

/** nvidia-smi is waited for this long at most. */
const gpuTimeoutMs = 3000;

/**
 * The cards nvidia-smi tells of, a line each: "load, memory used, memory total" (--format=csv,noheader,nounits).
 * @param {string} text
 * @returns {GpuUsage | undefined} — none for no such line
 */
export function parseNvidiaSmi(text) {
  const cards = text
    .split(/\r?\n/)
    .map((line) => line.split(',').map((part) => Number(part.trim())))
    .filter((parts) => parts.length === 3 && parts.every((part) => Number.isFinite(part)));
  if (cards.length === 0) return undefined;
  return {
    load: Math.max(...cards.map(([load = 0]) => load)),
    memoryUsed: cards.reduce((sum, [, used = 0]) => sum + used, 0),
    memoryTotal: cards.reduce((sum, [, , total = 0]) => sum + total, 0),
  };
}

/**
 * @param {{ cpuTimes: () => CpuTimes, memory: () => { total: number, free: number }, gpu: () => Promise<GpuUsage | undefined> }} parts
 *   — the processors' time so far, the memory, the cards
 */
export function createSystemUsage({ cpuTimes, memory, gpu }) {
  let last = cpuTimes();
  /** Percent busy at the last look that saw time go by. */
  let cpu = 0;
  return {
    /** @returns {Promise<SystemUsage>} */
    async read() {
      const now = cpuTimes();
      const spent = now.total - last.total;
      if (spent > 0) {
        cpu = Math.round(((now.busy - last.busy) / spent) * 100);
        last = now;
      }
      const { total, free } = memory();
      return { cpu, memory: { used: total - free, total }, gpu: await gpu() };
    },
  };
}

/** This computer's processors, its memory and its NVIDIA cards. */
export function createLocalSystemUsage() {
  return createSystemUsage({ cpuTimes: localCpuTimes, memory: () => ({ total: totalmem(), free: freemem() }), gpu: createNvidiaGpu() });
}

/** @returns {CpuTimes} */
function localCpuTimes() {
  return cpus().reduce(
    (sum, { times }) => {
      const total = times.user + times.nice + times.sys + times.idle + times.irq;
      return { busy: sum.busy + total - times.idle, total: sum.total + total };
    },
    { busy: 0, total: 0 },
  );
}

/**
 * The NVIDIA cards as nvidia-smi tells them; a computer without it is not asked again.
 * @returns {() => Promise<GpuUsage | undefined>}
 */
function createNvidiaGpu() {
  let missing = false;
  return () =>
    new Promise((resolve) => {
      if (missing) {
        resolve(undefined);
        return;
      }
      execFile('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'], { timeout: gpuTimeoutMs, windowsHide: true }, (error, stdout) => {
        if (error !== null && 'code' in error && error.code === 'ENOENT') missing = true;
        resolve(error === null ? parseNvidiaSmi(stdout) : undefined);
      });
    });
}
