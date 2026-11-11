// @ts-check
// How busy the viewer's computer is, as /api/system tells it (server/system-usage.js): read once at the page's edge.
import { isRecord } from './narrow.js';

/**
 * @typedef {{ load: number, memoryUsed: number, memoryTotal: number }} GpuUsage — load: percent; memory: MiB
 * @typedef {{ cpu: number, memory: { used: number, total: number }, gpu: GpuUsage | undefined }} SystemUsage — cpu:
 *   percent busy; memory: bytes; gpu: none for a computer with no card nvidia-smi tells of
 * @typedef {'cpu' | 'memory' | 'gpu'} Resource — what the computer's processes are listed by
 * @typedef {{ pid: number, name: string, cpu: number, memory: number, gpu: number | undefined }} ProcessUse — cpu:
 *   percent of all the processors; memory: bytes; gpu: percent of the card's engines, when the list is by them
 */

/**
 * @param {unknown} json — the viewer's reply
 * @returns {SystemUsage | undefined} — none for a reply that is no such thing
 */
export function parseSystemUsage(json) {
  if (!isRecord(json) || typeof json.cpu !== 'number' || !isRecord(json.memory)) return undefined;
  const { used, total } = json.memory;
  if (typeof used !== 'number' || typeof total !== 'number') return undefined;
  const gpu = isRecord(json.gpu) && typeof json.gpu.load === 'number' && typeof json.gpu.memoryUsed === 'number' && typeof json.gpu.memoryTotal === 'number' ? { load: json.gpu.load, memoryUsed: json.gpu.memoryUsed, memoryTotal: json.gpu.memoryTotal } : undefined;
  return { cpu: json.cpu, memory: { used, total }, gpu };
}

/**
 * The viewer's list of the computer's processes, the busiest with a resource first (server/processes.js): read once at
 * the page's edge; a process not told whole is left out.
 * @param {unknown} json — the viewer's reply
 * @returns {ProcessUse[] | undefined} — none for a reply that is no list
 */
export function parseSystemProcesses(json) {
  if (!isRecord(json) || !Array.isArray(json.processes)) return undefined;
  return json.processes.flatMap((one) => {
    if (!isRecord(one) || typeof one.pid !== 'number' || typeof one.name !== 'string' || typeof one.cpu !== 'number' || typeof one.memory !== 'number') return [];
    return [{ pid: one.pid, name: one.name, cpu: one.cpu, memory: one.memory, gpu: typeof one.gpu === 'number' ? one.gpu : undefined }];
  });
}
